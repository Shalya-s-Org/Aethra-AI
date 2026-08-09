// Health + scheduler-trigger tests: GET /api/health reports the last
// successful cron run and the next due job from the durable scheduled_jobs
// table, and POST /api/cron/run rejects unauthenticated invocations.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-health-test-'));
process.env.AETHRA_DB_PATH = path.join(TMP_DIR, 'health.db');

import { GET as healthGET } from '../src/app/api/health/route';
import { POST as cronPOST } from '../src/app/api/cron/run/route';
import { initializeAgentInstance } from '../src/lib/agentEngine';
import { JobQueue } from '../src/lib/jobs/queue';
import { closeDb, getDb, getSchedulerHealth } from '../src/lib/db';

after(() => {
  delete process.env.AETHRA_CRON_SECRET;
  closeDb();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const T0 = 1_750_000_000_000;
const MIN = 60_000;

describe('GET /api/health', () => {
  it('reports an empty scheduler for a fresh database', async () => {
    const res = await healthGET();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.db, 'ok');
    assert.equal(body.agents, 0);
    assert.deepEqual(body.jobs, { active: 0, degraded: 0 });
    assert.equal(body.lastCronRunAt, null);
    assert.equal(body.nextDueAt, null);
    assert.equal(body.cron.mode, 'vercel-header', 'no secret configured in this process');
  });

  it('reports the last successful cron run and the next due job after a tick', async () => {
    const agentId = initializeAgentInstance('Health Agent', 'ai-security', undefined, {}, T0).agentId;
    // POST /api/agent/init schedules the recurring job; replicate it here with
    // a no-op cycle so no live discovery runs in this test.
    const queue = new JobQueue({ now: () => T0, cycle: async () => ({ ok: true, summary: 'tick ok' }) });
    queue.scheduleAgent(agentId, 30 * MIN, 0);

    // Before any run the job is due at its firstRunAtMs (T0).
    let health = getSchedulerHealth();
    assert.equal(health.agents, 1);
    assert.equal(health.activeJobs, 1);
    assert.equal(health.lastRunAtMs, null);
    assert.equal(health.nextDueAtMs, T0);

    const tick = await queue.processDueJobs();
    assert.equal(tick.completed, 1);

    // After the run: last_run_at set, next occurrence advanced by the cadence.
    health = getSchedulerHealth();
    assert.equal(health.lastRunAtMs, T0);
    assert.equal(health.nextDueAtMs, T0 + 30 * MIN);

    const res = await healthGET();
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.lastCronRunAt, new Date(T0).toISOString());
    assert.equal(body.nextDueAt, new Date(T0 + 30 * MIN).toISOString());
    assert.equal(body.agents, 1);
    assert.equal(body.jobs.active, 1);

    // Clean up so the cron-auth tests below run against an empty, no-network DB.
    getDb().prepare('DELETE FROM agents WHERE id = ?').run(agentId);
  });
});

describe('POST /api/cron/run authentication', () => {
  it('rejects an unauthenticated POST with 401', async () => {
    delete process.env.AETHRA_CRON_SECRET;
    const res = await cronPOST(new Request('http://localhost/api/cron/run', { method: 'POST' }));
    assert.equal(res.status, 401);
  });

  it('accepts the Vercel Cron header when no secret is configured (local dev)', async () => {
    delete process.env.AETHRA_CRON_SECRET;
    const res = await cronPOST(
      new Request('http://localhost/api/cron/run', { method: 'POST', headers: { 'x-vercel-cron': '1' } })
    );
    assert.equal(res.status, 200);
  });

  it('requires the configured Bearer secret and rejects wrong tokens', async () => {
    process.env.AETHRA_CRON_SECRET = 'topsecret';

    const missing = await cronPOST(new Request('http://localhost/api/cron/run', { method: 'POST' }));
    assert.equal(missing.status, 401);

    const wrong = await cronPOST(
      new Request('http://localhost/api/cron/run', { method: 'POST', headers: { authorization: 'Bearer wrong' } })
    );
    assert.equal(wrong.status, 401);

    const good = await cronPOST(
      new Request('http://localhost/api/cron/run', { method: 'POST', headers: { authorization: 'Bearer topsecret' } })
    );
    assert.equal(good.status, 200);
  });
});
