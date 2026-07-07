import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { JsonCompanionStore, type CompanionStore } from "./store";

interface Backend {
  name: string;
  create: () => Promise<CompanionStore>;
  cleanup: () => Promise<void>;
  concurrencySafe: boolean;
}

const backends: Backend[] = [];

let tempDir: string | undefined;
backends.push({
  name: "json",
  concurrencySafe: true,
  create: async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ai-chat-contract-"));
    return new JsonCompanionStore(join(tempDir, "state.json"));
  },
  cleanup: async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  }
});

if (process.env.DATABASE_URL) {
  backends.push({
    name: "postgres",
    concurrencySafe: true,
    create: async () => {
      const { PostgresCompanionStore } = await import("./postgres-store");
      const store = new PostgresCompanionStore(process.env.DATABASE_URL!);
      await store.write({ ...(await store.read()), auditLogs: [] });
      return store;
    },
    cleanup: async () => undefined
  });
}

describe.each(backends)("CompanionStore contract: $name", (backend) => {
  let store: CompanionStore;

  afterEach(async () => {
    await backend.cleanup();
  });

  test("seeds initial state on first read", async () => {
    store = await backend.create();
    const state = await store.read();
    expect(state.users[0].id).toBe("u_demo");
    expect(state.characters.length).toBeGreaterThan(0);
  });

  test("persists writes and reads them back", async () => {
    store = await backend.create();
    const first = await store.read();
    await store.write({
      ...first,
      auditLogs: [
        { id: "a1", scene: "test", contentRef: "x", providerResult: "ok", action: "recorded", createdAt: "2026-07-06T00:00:00.000Z" }
      ]
    });
    const second = await store.read();
    expect(second.auditLogs.map((log) => log.id)).toContain("a1");
  });

  test("update applies the passed state atomically", async () => {
    store = await backend.create();
    await store.write({ ...(await store.read()), auditLogs: [] });
    const next = await store.update((state) => ({
      ...state,
      auditLogs: [
        ...state.auditLogs,
        { id: "u1", scene: "test", contentRef: "y", providerResult: "ok", action: "recorded", createdAt: "2026-07-06T00:00:00.000Z" }
      ]
    }));
    expect(next.auditLogs.some((log) => log.id === "u1")).toBe(true);
  });

  test("concurrent updates do not lose writes", async () => {
    if (!backend.concurrencySafe) {
      return;
    }
    store = await backend.create();
    await store.write({ ...(await store.read()), auditLogs: [] });

    const count = 20;
    await Promise.all(
      Array.from({ length: count }, (_unused, index) =>
        store.update((state) => ({
          ...state,
          auditLogs: [
            ...state.auditLogs,
            {
              id: `c${index}`,
              scene: "test",
              contentRef: String(index),
              providerResult: "ok",
              action: "recorded",
              createdAt: "2026-07-06T00:00:00.000Z"
            }
          ]
        }))
      )
    );

    const final = await store.read();
    expect(final.auditLogs).toHaveLength(count);
  });
});
