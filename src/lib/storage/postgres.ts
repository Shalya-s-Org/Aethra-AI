// Postgres storage driver — the shared, multi-instance implementation.
//
// Uses node-postgres (pg). A connection pool survives serverless cold starts
// (reconnect on demand) and multiple application instances safely because the
// schema's unique constraints, transactions, and job leases are enforced by
// the database itself — exactly the guarantees the app relies on (feed
// ordering, duplicate-publication prevention, idempotency keys, lease claims).
//
// Migration note: the schema_migrations table tracks applied ids, and every
// statement in the registry is idempotent (IF NOT EXISTS / IF EXISTS), so a
// fresh database migrates itself on first connect.

import { Pool, type PoolClient } from 'pg';
import { MIGRATIONS } from './migrations';
import type { RunResult, StorageDriver } from './types';

export interface PostgresStorageOptions {
  /** Connection string (e.g. postgres://user:pass@host:5432/aethra). */
  connectionString: string;
  /** Max pool size (default 10). */
  max?: number;
}

export class PostgresStorage implements StorageDriver {
  readonly kind = 'postgres' as const;
  private readonly pool: Pool;
  private closed = false;

  constructor(options: PostgresStorageOptions) {
    this.pool = new Pool({ connectionString: options.connectionString, max: options.max ?? 10 });
    this.pool.on('error', err => {
      // Idle-client errors must not crash the process (serverless + long pools).
      console.error('Postgres pool error:', err);
    });
  }

  /** Positional params are translated to pg's $1..$n. */
  private static bind(sql: string, params: readonly unknown[]): { text: string; values: unknown[] } {
    if (params.length === 0) return { text: sql, values: [] };
    let i = 0;
    const text = sql.replace(/\?/g, () => `$${++i}`);
    return { text, values: [...params] };
  }

  private async withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    if (this.closed) throw new Error('Postgres storage is closed');
    const client = await this.pool.connect();
    try {
      return await fn(client);
    } finally {
      client.release();
    }
  }

  async all(sql: string, params: readonly unknown[] = []): Promise<Record<string, unknown>[]> {
    return this.withClient(async client => {
      const { text, values } = PostgresStorage.bind(sql, params);
      const res = await client.query(text, values);
      return res.rows as Record<string, unknown>[];
    });
  }

  async get(sql: string, params: readonly unknown[] = []): Promise<Record<string, unknown> | undefined> {
    const rows = await this.all(sql, params);
    return rows[0];
  }

  async run(sql: string, params: readonly unknown[] = []): Promise<RunResult> {
    return this.withClient(async client => {
      const { text, values } = PostgresStorage.bind(sql, params);
      const res = await client.query(text, values);
      return { changes: res.rowCount ?? 0 };
    });
  }

  async exec(sql: string): Promise<void> {
    await this.withClient(async client => {
      await client.query(sql);
    });
  }

  async transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.withClient(async client => {
      await client.query('BEGIN');
      try {
        const result = await fn();
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.pool.end();
  }

  /** Ensure the schema exists (idempotent). Called by tests and deploy tooling. */
  async migrate(): Promise<void> {
    await this.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id         TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    const applied = new Set(
      (await this.all('SELECT id FROM schema_migrations')).map(r => String(r.id))
    );
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) continue;
      await this.transaction(async () => {
        await this.exec(migration.postgres);
        await this.run('INSERT INTO schema_migrations (id, applied_at) VALUES ($1, $2)', [
          migration.id,
          new Date().toISOString()
        ]);
      });
    }
  }
}
