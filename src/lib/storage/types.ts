// Storage driver interface.
//
// The seam between the app and its durable store. Two implementations exist:
//   - SqliteStorage  (local file, node:sqlite) — the default; survives server
//                     restarts on a single host.
//   - PostgresStorage (shared networked database, pg) — survives restarts,
//                     serverless cold starts, and multiple application
//                     instances pointing at the same schema.
//
// Both drivers apply the shared migration registry (see migrations.ts) and
// track applied ids in `schema_migrations`. Transactions, unique constraints
// (feed ordering, duplicate publication, idempotency), and job leases are
// expressed in the schema and enforced by the store itself, so the guarantees
// hold regardless of driver.
//
// The driver is intentionally async (Postgres cannot be synchronous). The
// current synchronous DAO layer (src/lib/db.ts) runs on the SQLite driver and
// is the documented follow-up to convert to this interface.

export interface RunResult {
  /** Number of rows changed by the statement. */
  changes: number;
  /** Last inserted row id when the store provides one. */
  lastInsertRowid?: number | bigint;
}

export interface StorageDriver {
  readonly kind: 'sqlite' | 'postgres';

  /** Run a query returning all rows (records keyed by column name). */
  all(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  /** Run a query returning the first row, or undefined when none match. */
  get(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown> | undefined>;
  /** Run a write statement, returning the change count. */
  run(sql: string, params?: readonly unknown[]): Promise<RunResult>;
  /** Run one or more statements (migrations). */
  exec(sql: string): Promise<void>;

  /**
   * Run `fn` inside a transaction. Drivers guarantee atomicity (BEGIN/COMMIT/
   * ROLLBACK); a throw rolls back. Note the SQLite driver's transaction is for
   * single-flight use — the underlying store is synchronous, so a transaction
   * must not interleave awaits from concurrent callers.
   */
  transaction<T>(fn: () => Promise<T>): Promise<T>;

  /** Close the connection/pool. Safe to call multiple times. */
  close(): Promise<void>;
}
