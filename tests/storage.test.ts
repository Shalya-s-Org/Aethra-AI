import { describe, it, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Scratch database for the SQLite driver tests (isolated per file/process).
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-storage-test-'));
const DB_PATH = path.join(TMP_DIR, 'storage.db');

import { MIGRATIONS } from '../src/lib/storage/migrations';
import { SqliteStorage, resolveSqliteDbPath } from '../src/lib/storage/sqlite';
import { PostgresStorage } from '../src/lib/storage/postgres';
import { createStorage } from '../src/lib/storage';

after(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

describe('migration registry', () => {
  it('carries both dialects for every migration', () => {
    for (const m of MIGRATIONS) {
      assert.ok(m.id.length > 0);
      assert.ok(m.sqlite.includes('CREATE'), `sqlite dialect missing DDL in ${m.id}`);
      assert.ok(m.postgres.includes('CREATE'), `postgres dialect missing DDL in ${m.id}`);
    }
    // All schema concepts the app depends on are covered.
    const all = MIGRATIONS.map(m => m.sqlite + m.postgres).join('\n');
    for (const table of [
      'agents',
      'topics',
      'sources',
      'posts',
      'editorial_decisions',
      'persona_memory',
      'agent_runs',
      'discovery_candidates',
      'discovery_fetches',
      'discovery_decisions',
      'memory_entries',
      'post_links',
      'init_requests',
      'scheduled_jobs'
    ]) {
      assert.ok(all.includes(`CREATE TABLE ${table}`), `missing table ${table}`);
    }
  });
});

describe('SQLite driver', () => {
  it('uses Vercel writable temporary storage instead of the read-only bundle', () => {
    assert.equal(
      resolveSqliteDbPath({ VERCEL: '1', AETHRA_DB_PATH: '.data/aethra.db' }),
      path.join('/tmp', 'aethra.db')
    );
    assert.equal(
      resolveSqliteDbPath({ VERCEL_ENV: 'production', AETHRA_DB_PATH: '/tmp/custom.db' }),
      '/tmp/custom.db'
    );
  });

  it('applies all migrations on first use and is idempotent across reconnects', async () => {
    const driver = new SqliteStorage({ dbPath: DB_PATH });
    // First use: raw connection opens, migrations run.
    const tables = await driver.all(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"
    );
    const names = tables.map(r => String(r.name));
    for (const t of ['agents', 'posts', 'scheduled_jobs', 'schema_migrations']) {
      assert.ok(names.includes(t), `missing table ${t}`);
    }
    const applied = await driver.all('SELECT id FROM schema_migrations ORDER BY id');
    assert.equal(applied.length, MIGRATIONS.length);
    // Reopen: migrations must not re-run or error.
    await driver.close();
    const reopened = new SqliteStorage({ dbPath: DB_PATH });
    await reopened.all('SELECT 1 AS ok');
    await reopened.close();
  });

  it('supports async CRUD through the driver interface', async () => {
    const driver = new SqliteStorage({ dbPath: path.join(TMP_DIR, 'crud.db') });
    await driver.run('INSERT INTO agents (id, name, role, domain, mission, frequency, style, status, state_json, engine_json, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      'agent-1', 'Ada', 'Analyst', 'AI Security', 'm', 'daily', 'calm', 'idle',
      '{}', '{}', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ]);
    const row = await driver.get('SELECT id, name FROM agents WHERE id = ?', ['agent-1']);
    assert.equal(row?.name, 'Ada');
    const { changes } = await driver.run('UPDATE agents SET status = ? WHERE id = ?', ['active', 'agent-1']);
    assert.equal(changes, 1);
    const rows = await driver.all('SELECT id FROM agents');
    assert.equal(rows.length, 1);
    await driver.close();
  });

  it('rolls back a transaction when the body throws', async () => {
    const driver = new SqliteStorage({ dbPath: path.join(TMP_DIR, 'txn.db') });
    await assert.rejects(
      driver.transaction(async () => {
        await driver.run(
          'INSERT INTO agents (id, name, role, domain, mission, frequency, style, status, state_json, engine_json, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          ['txn-agent', 'Ada', 'Analyst', 'AI Security', 'm', 'daily', 'calm', 'idle', '{}', '{}', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
        );
        throw new Error('boom');
      }),
      /boom/
    );
    const count = await driver.get('SELECT COUNT(*) AS n FROM agents');
    assert.equal(count?.n, 0, 'rolled-back insert must not persist');
    await driver.close();
  });

  it('survives a server restart (close + reopen the same file)', async () => {
    const first = new SqliteStorage({ dbPath: DB_PATH });
    await first.run(
      'INSERT INTO agents (id, name, role, domain, mission, frequency, style, status, state_json, engine_json, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['restart-agent', 'Ada', 'Analyst', 'AI Security', 'm', 'daily', 'calm', 'idle', '{}', '{}', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
    );
    await first.close();

    // A fresh driver (new process/instance) reads the same file.
    const second = new SqliteStorage({ dbPath: DB_PATH });
    const row = await second.get('SELECT id, name FROM agents WHERE id = ?', ['restart-agent']);
    assert.ok(row, 'data must survive a close/reopen');
    assert.equal(row.name, 'Ada');
    await second.close();
  });

  it('enforces unique constraints (canonical URL dedup, idempotency)', async () => {
    const driver = new SqliteStorage({ dbPath: path.join(TMP_DIR, 'unique.db') });
    await driver.run(
      'INSERT INTO discovery_candidates (id, canonical_url, title, published_at, source_name, source_type, raw_evidence, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ['c1', 'https://example.com/advisory', 'T', '2026-01-01T00:00:00.000Z', 'src', 'advisory', '{}', '2026-01-01T00:00:00.000Z']
    );
    await assert.rejects(
      driver.run(
        'INSERT INTO discovery_candidates (id, canonical_url, title, published_at, source_name, source_type, raw_evidence, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        ['c2', 'https://example.com/advisory', 'T2', '2026-01-01T00:00:00.000Z', 'src', 'advisory', '{}', '2026-01-01T00:00:00.000Z']
      ),
      /UNIQUE/i
    );
    await driver.close();
  });

  it('lease claim: exactly one worker wins a conditional UPDATE', async () => {
    const driver = new SqliteStorage({ dbPath: path.join(TMP_DIR, 'lease.db') });
    const now = Date.now();
    await driver.run(
      'INSERT INTO agents (id, name, role, domain, mission, frequency, style, status, state_json, engine_json, next_run_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ['agent-1', 'Ada', 'Analyst', 'AI Security', 'm', 'daily', 'calm', 'idle', '{}', '{}', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
    );
    await driver.run(
      `INSERT INTO scheduled_jobs (id, agent_id, job_type, status, schedule_ms, next_run_at, lease_owner, lease_expires_at, created_at, updated_at)
       VALUES (?, ?, 'agent_cycle', 'active', 1800000, ?, NULL, NULL, ?, ?)`,
      ['job-1', 'agent-1', now, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
    );
    // Two workers racing to claim the same occurrence. The conditional UPDATE
    // is atomic, so at most one can flip lease_owner from NULL.
    const claim = (owner: string) =>
      driver.run(
        `UPDATE scheduled_jobs SET lease_owner = ?, lease_expires_at = ? WHERE id = ? AND lease_owner IS NULL`,
        [owner, now + 60_000, 'job-1']
      );
    const results = await Promise.all([claim('worker-a'), claim('worker-b')]);
    assert.equal(results.filter(r => r.changes === 1).length, 1, 'exactly one worker claims the lease');
    const row = await driver.get('SELECT lease_owner FROM scheduled_jobs WHERE id = ?', ['job-1']);
    assert.equal(row?.lease_owner, 'worker-a');
    await driver.close();
  });
});

// ---------------------------------------------------------------------------
// Postgres integration tests — run only when a DATABASE_URL is provided
// (a real shared database, e.g. the 48-hour evaluation host). Skipped
// otherwise so the suite is green without network access.
// ---------------------------------------------------------------------------

const PG_URL = process.env.DATABASE_URL ?? process.env.AETHRA_POSTGRES_URL;
const pgSkip = PG_URL ? false : 'DATABASE_URL not set — skipping Postgres integration tests';

describe('Postgres driver', { skip: pgSkip }, () => {
  it('migrates a fresh schema and supports CRUD', async (t: TestContext) => {
    const driver = new PostgresStorage({ connectionString: PG_URL as string });
    t.after(() => driver.close());
    await driver.migrate();
    const applied = await driver.all('SELECT id FROM schema_migrations ORDER BY id');
    assert.equal(applied.length, MIGRATIONS.length);
    await driver.run(
      'INSERT INTO agents (id, name, role, domain, mission, frequency, style, status, state_json, engine_json, next_run_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
      ['pg-agent', 'Ada', 'Analyst', 'AI Security', 'm', 'daily', 'calm', 'idle', '{}', '{}', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
    );
    const row = await driver.get('SELECT id, name FROM agents WHERE id = $1', ['pg-agent']);
    assert.equal(row?.name, 'Ada');
  });

  it('two instances share one schema (multi-instance visibility)', async (t: TestContext) => {
    const a = new PostgresStorage({ connectionString: PG_URL as string });
    const b = new PostgresStorage({ connectionString: PG_URL as string });
    t.after(() => Promise.all([a.close(), b.close()]));
    await a.migrate();
    await b.migrate(); // idempotent across instances
    await a.run('INSERT INTO agents (id, name, role, domain, mission, frequency, style, status, state_json, engine_json, next_run_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)', [
      'multi-agent', 'Ada', 'Analyst', 'AI Security', 'm', 'daily', 'calm', 'idle', '{}', '{}', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    ]);
    const row = await b.get('SELECT id FROM agents WHERE id = $1', ['multi-agent']);
    assert.ok(row, 'instance B must see instance A write');
  });

  it('lease claim is one-winner across instances', async (t: TestContext) => {
    const a = new PostgresStorage({ connectionString: PG_URL as string });
    const b = new PostgresStorage({ connectionString: PG_URL as string });
    t.after(() => Promise.all([a.close(), b.close()]));
    await a.migrate();
    const now = Date.now();
    await a.run(
      'INSERT INTO agents (id, name, role, domain, mission, frequency, style, status, state_json, engine_json, next_run_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
      ['agent-1', 'Ada', 'Analyst', 'AI Security', 'm', 'daily', 'calm', 'idle', '{}', '{}', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
    );
    await a.run(
      `INSERT INTO scheduled_jobs (id, agent_id, job_type, status, schedule_ms, next_run_at, lease_owner, lease_expires_at, created_at, updated_at)
       VALUES ($1, $2, 'agent_cycle', 'active', 1800000, $3, NULL, NULL, $4, $4)`,
      ['pg-job', 'agent-1', now, '2026-01-01T00:00:00.000Z']
    );
    const claim = (driver: PostgresStorage, owner: string) =>
      driver.run(
        'UPDATE scheduled_jobs SET lease_owner = $1, lease_expires_at = $2 WHERE id = $3 AND lease_owner IS NULL',
        [owner, now + 60_000, 'pg-job']
      );
    const results = await Promise.all([claim(a, 'inst-a'), claim(b, 'inst-b')]);
    assert.equal(results.filter(r => r.changes === 1).length, 1, 'exactly one instance claims the lease');
  });

  it('rolls back a transaction when the body throws', async (t: TestContext) => {
    const driver = new PostgresStorage({ connectionString: PG_URL as string });
    t.after(() => driver.close());
    await driver.migrate();
    await assert.rejects(
      driver.transaction(async () => {
        await driver.run(
          'INSERT INTO agents (id, name, role, domain, mission, frequency, style, status, state_json, engine_json, next_run_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)',
          ['tx-pg', 'Ada', 'Analyst', 'AI Security', 'm', 'daily', 'calm', 'idle', '{}', '{}', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z']
        );
        throw new Error('boom');
      }),
      /boom/
    );
    const count = await driver.get('SELECT COUNT(*) AS n FROM agents WHERE id = $1', ['tx-pg']);
    assert.equal(count?.n, 0);
  });
});

describe('storage factory', () => {
  it('defaults to sqlite and rejects unknown kinds', () => {
    const driver = createStorage({});
    assert.equal(driver.kind, 'sqlite');
    assert.throws(() => createStorage({ AETHRA_STORAGE: 'mysql' }), /Unknown AETHRA_STORAGE/);
    assert.throws(
      () => createStorage({ AETHRA_STORAGE: 'postgres' }),
      /requires DATABASE_URL/
    );
  });
});
