import { Pool } from "pg";
import type { CompanionState } from "@/domain/types";
import { normalizeState } from "./admin-service";
import { createInitialState } from "./companion-service";
import type { CompanionStore, StateUpdater } from "./store";

const stateRowId = "global";

const schemaDdl = `
CREATE TABLE IF NOT EXISTS companion_state (
  id text PRIMARY KEY DEFAULT 'global',
  state jsonb NOT NULL,
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);
`;

interface PoolCache {
  pool?: Pool;
  ready?: Promise<void>;
}

const globalCache = globalThis as unknown as { __companionPgCache?: Record<string, PoolCache> };
globalCache.__companionPgCache ??= {};

export class PostgresCompanionStore implements CompanionStore {
  private readonly cacheKey: string;

  constructor(private readonly connectionString: string) {
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for the postgres store.");
    }
    this.cacheKey = connectionString;
  }

  private cache(): PoolCache {
    const cache = globalCache.__companionPgCache!;
    cache[this.cacheKey] ??= {};
    return cache[this.cacheKey];
  }

  private pool(): Pool {
    const cache = this.cache();
    if (!cache.pool) {
      cache.pool = new Pool({ connectionString: this.connectionString, max: 10 });
    }
    return cache.pool;
  }

  private async ensureSchema(): Promise<void> {
    const cache = this.cache();
    cache.ready ??= this.pool()
      .query(schemaDdl)
      .then(() => undefined)
      .catch((error) => {
        cache.ready = undefined;
        throw error;
      });
    return cache.ready;
  }

  async read(): Promise<CompanionState> {
    await this.ensureSchema();
    const pool = this.pool();
    const seed = JSON.stringify(normalizeState(createInitialState()));
    await pool.query(
      `INSERT INTO companion_state (id, state) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING`,
      [stateRowId, seed]
    );
    const result = await pool.query<{ state: CompanionState }>(
      `SELECT state FROM companion_state WHERE id = $1`,
      [stateRowId]
    );
    return normalizeState(result.rows[0].state);
  }

  async write(state: CompanionState): Promise<CompanionState> {
    await this.ensureSchema();
    await this.pool().query(
      `INSERT INTO companion_state (id, state, version, updated_at)
       VALUES ($1, $2::jsonb, 0, now())
       ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, version = companion_state.version + 1, updated_at = now()`,
      [stateRowId, JSON.stringify(state)]
    );
    return state;
  }

  async update(updater: StateUpdater): Promise<CompanionState> {
    await this.ensureSchema();
    const seed = JSON.stringify(normalizeState(createInitialState()));
    const client = await this.pool().connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `INSERT INTO companion_state (id, state) VALUES ($1, $2::jsonb) ON CONFLICT (id) DO NOTHING`,
        [stateRowId, seed]
      );
      const locked = await client.query<{ state: CompanionState }>(
        `SELECT state FROM companion_state WHERE id = $1 FOR UPDATE`,
        [stateRowId]
      );
      const current = normalizeState(locked.rows[0].state);
      const next = await updater(current);
      await client.query(
        `UPDATE companion_state SET state = $2::jsonb, version = version + 1, updated_at = now() WHERE id = $1`,
        [stateRowId, JSON.stringify(next)]
      );
      await client.query("COMMIT");
      return next;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
}
