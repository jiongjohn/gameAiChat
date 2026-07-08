import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { CompanionState } from "@/domain/types";
import { normalizeState } from "./admin-service";
import { createInitialState } from "./companion-service";
import { PostgresCompanionStore } from "./postgres-store";

export type StateUpdater = (state: CompanionState) => CompanionState | Promise<CompanionState>;

export interface CompanionStore {
  read(): Promise<CompanionState>;
  write(state: CompanionState): Promise<CompanionState>;
  update(updater: StateUpdater): Promise<CompanionState>;
}

export class JsonCompanionStore implements CompanionStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  async read(): Promise<CompanionState> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as CompanionState;
      const normalized = normalizeState(parsed);
      if (JSON.stringify(parsed) !== JSON.stringify(normalized)) {
        await this.write(normalized);
      }
      return normalized;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      const initial = normalizeState(createInitialState());
      await this.write(initial);
      return initial;
    }
  }

  async write(state: CompanionState): Promise<CompanionState> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tmp, this.filePath);
    return state;
  }

  async update(updater: StateUpdater): Promise<CompanionState> {
    const run = this.queue.then(async () => {
      const current = await this.read();
      const next = await updater(current);
      return this.write(next);
    });
    this.queue = run.catch(() => undefined);
    return run;
  }
}

function createStore(): CompanionStore {
  if (process.env.AI_CHAT_STORE === "postgres") {
    return new PostgresCompanionStore(process.env.DATABASE_URL ?? "");
  }
  return new JsonCompanionStore(
    process.env.AI_CHAT_STATE_PATH ?? join(process.cwd(), ".data", "companion-state.json")
  );
}

export const companionStore: CompanionStore = createStore();
