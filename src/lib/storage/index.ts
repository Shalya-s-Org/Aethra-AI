// Storage factory — select the durable store from the environment.
//
//   AETHRA_STORAGE=sqlite     (default) local SQLite file; survives restarts on
//                             a single host; also the test driver.
//   AETHRA_STORAGE=postgres   shared Postgres (DATABASE_URL); survives cold
//                             starts and multiple application instances.
//
// The synchronous DAO layer (src/lib/db.ts) runs on the SQLite driver today;
// see the storage module docs for the async-conversion follow-up.

import { PostgresStorage } from './postgres';
import { SqliteStorage } from './sqlite';
import type { StorageDriver } from './types';

export type { StorageDriver, RunResult } from './types';
export { MIGRATIONS } from './migrations';
export { SqliteStorage } from './sqlite';
export { PostgresStorage } from './postgres';

/** Build the driver selected by the environment. Throws on misconfiguration. */
export function createStorage(env: Record<string, string | undefined> = process.env): StorageDriver {
  const kind = (env.AETHRA_STORAGE ?? 'sqlite').toLowerCase();
  if (kind === 'postgres') {
    const connectionString = env.DATABASE_URL ?? env.AETHRA_POSTGRES_URL;
    if (!connectionString) {
      throw new Error('AETHRA_STORAGE=postgres requires DATABASE_URL (or AETHRA_POSTGRES_URL).');
    }
    return new PostgresStorage({ connectionString });
  }
  if (kind !== 'sqlite') {
    throw new Error(`Unknown AETHRA_STORAGE "${kind}" (expected "sqlite" or "postgres").`);
  }
  return new SqliteStorage({ dbPath: env.AETHRA_DB_PATH });
}

// The process-wide SQLite singleton the synchronous DAO layer uses. Lazy and
// resettable via close() (restart tests reopen the same file).
let sqlite: SqliteStorage | null = null;

export function sqliteStorage(): SqliteStorage {
  if (!sqlite) sqlite = new SqliteStorage({ dbPath: process.env.AETHRA_DB_PATH });
  return sqlite;
}

/** Release the shared SQLite connection (tests, shutdown hooks). */
export async function closeSqliteStorage(): Promise<void> {
  if (sqlite) {
    await sqlite.close();
    sqlite = null;
  }
}
