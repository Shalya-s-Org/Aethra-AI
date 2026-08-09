// SQLite storage driver — the local dev/test implementation.
//
// Owns the node:sqlite connection (WAL, busy timeout, foreign keys), applies
// the shared migration registry, and exposes `raw()` for the synchronous DAO
// layer in src/lib/db.ts (which predates the async interface and runs only on
// SQLite). `close()` releases the connection and resets the singleton so a
// later call reconnects — restart survival is just opening the file again.

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from './migrations';
import type { RunResult, StorageDriver } from './types';

export interface SqliteStorageOptions {
  /** Database file path. Defaults to AETHRA_DB_PATH or .data/aethra.db. */
  dbPath?: string;
}

export class SqliteStorage implements StorageDriver {
  readonly kind = 'sqlite' as const;
  private db: DatabaseSync | null = null;
  private readonly dbPath: string;

  constructor(options: SqliteStorageOptions = {}) {
    this.dbPath =
      options.dbPath ?? (process.env.AETHRA_DB_PATH || path.join(process.cwd(), '.data', 'aethra.db'));
  }

  /** The underlying synchronous handle — used only by the legacy DAO layer. */
  raw(): DatabaseSync {
    if (!this.db) this.connect();
    return this.db as DatabaseSync;
  }

  private connect(): void {
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    const connection = new DatabaseSync(this.dbPath);
    connection.exec('PRAGMA journal_mode = WAL;');
    connection.exec('PRAGMA busy_timeout = 5000;');
    connection.exec('PRAGMA foreign_keys = ON;');
    applyMigrations(connection);
    this.db = connection;
  }

  async all(sql: string, params: readonly SQLInputValue[] = []): Promise<Record<string, unknown>[]> {
    return this.raw().prepare(sql).all(...params) as Record<string, unknown>[];
  }

  async get(sql: string, params: readonly SQLInputValue[] = []): Promise<Record<string, unknown> | undefined> {
    const row = this.raw().prepare(sql).get(...params);
    return row == null ? undefined : (row as Record<string, unknown>);
  }

  async run(sql: string, params: readonly SQLInputValue[] = []): Promise<RunResult> {
    const result = this.raw().prepare(sql).run(...params);
    return { changes: Number(result.changes), lastInsertRowid: result.lastInsertRowid };
  }

  async exec(sql: string): Promise<void> {
    this.raw().exec(sql);
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    const d = this.raw();
    d.exec('BEGIN');
    try {
      const result = await fn();
      d.exec('COMMIT');
      return result;
    } catch (err) {
      d.exec('ROLLBACK');
      throw err;
    }
  }

  /** Synchronous close for the legacy DAO layer (tests reopen the file). */
  closeSync(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  async close(): Promise<void> {
    this.closeSync();
  }
}

function applyMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map(r => String(r.id))
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.sqlite);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        migration.id,
        new Date().toISOString()
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}
