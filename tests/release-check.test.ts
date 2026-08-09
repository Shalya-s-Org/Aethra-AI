// Release-readiness harness tests. The harness is env-driven and restores the
// environment after each run, so a single process can exercise pass and fail
// gates deterministically. The local mode runs the full accelerated 48h
// simulation plus the judged API contract through the real route handlers.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-release-test-'));
// The harness overrides AETHRA_DB_PATH with its own scratch dir per run; set
// the scheduler secret here because the local gate requires it.
process.env.AETHRA_CRON_SECRET = 'release-test-secret-123';

import { runLocalReleaseChecks, runProductionReleaseChecks, type ReleaseReport } from './release-check';

after(() => {
  delete process.env.AETHRA_CRON_SECRET;
  delete process.env.AETHRA_STORAGE;
  delete process.env.DATABASE_URL;
  delete process.env.AETHRA_CRON_URL;
  delete process.env.AETHRA_LLM_PROVIDER;
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const LOCAL_CHECK_IDS = [
  'scheduler-configured',
  'init-contract',
  'one-init-only',
  'feed-contract',
  'sim-48h',
  'feed-read-only',
  'restart-persistence',
  'scheduler-recovery',
  'source-failure',
  'llm-failure'
];

describe('release-readiness harness', () => {
  it('local mode passes every gate with a configured scheduler', async () => {
    const report = await runLocalReleaseChecks();
    assert.equal(report.passed, true, JSON.stringify(report.checks, null, 2));
    assert.deepEqual(
      report.checks.map(c => c.id),
      LOCAL_CHECK_IDS,
      'every release gate must be present'
    );
    assert.ok(report.checks.every(c => c.status === 'pass'), 'all checks must pass in a healthy local setup');

    // The accelerated 48h simulation produced posts within the expected band.
    assert.ok(report.meta, 'the report must carry simulation facts');
    assert.equal(report.meta.occurrences, 48);
    assert.equal(report.meta.failedOccurrences, 0);
    assert.ok(
      Number(report.meta.posts) >= 4 && Number(report.meta.posts) <= 8,
      `expected 4..8 posts, got ${report.meta.posts}`
    );
    assert.ok(report.meta.simAgentId, 'the report must identify the simulation agent');
  });

  it('fails when no scheduler is configured (AETHRA_CRON_SECRET unset)', async () => {
    const saved = process.env.AETHRA_CRON_SECRET;
    delete process.env.AETHRA_CRON_SECRET;
    try {
      const report = await runLocalReleaseChecks();
      assert.equal(report.passed, false, 'a missing scheduler secret must fail the gate');
      const scheduler = report.checks.find(c => c.id === 'scheduler-configured');
      assert.equal(scheduler?.status, 'fail');
      assert.match(scheduler?.detail ?? '', /AETHRA_CRON_SECRET/);
    } finally {
      process.env.AETHRA_CRON_SECRET = saved;
    }
  });

  it('production mode fails when no scheduler endpoint or durable DB is configured', async () => {
    // Ensure a clean slate: no cron URL, storage defaults to sqlite.
    delete process.env.AETHRA_CRON_URL;
    delete process.env.AETHRA_STORAGE;
    delete process.env.DATABASE_URL;
    const report = await runProductionReleaseChecks();

    assert.equal(report.passed, false, 'an unconfigured production target must fail the gate');
    const byId = Object.fromEntries(report.checks.map(c => [c.id, c]));
    assert.equal(byId['scheduler-configured'].status, 'fail');
    assert.equal(byId['persistence-durable'].status, 'fail');
    assert.match(byId['persistence-durable'].detail ?? '', /postgres/);
    // Nothing runs against a half-configured deployment.
    for (const id of ['db-connect-migrate', 'http-init-one', 'http-cron-auth']) {
      assert.equal(byId[id].status, 'skip', `${id} must be skipped when configuration gates fail`);
    }
  });

  it('production mode fails when persistence is local in production', async () => {
    process.env.AETHRA_CRON_URL = 'https://aethra.example.com/api/cron/run';
    process.env.AETHRA_CRON_SECRET = 'release-test-secret-123';
    process.env.AETHRA_STORAGE = 'sqlite'; // local file — must fail in production mode
    delete process.env.DATABASE_URL;
    try {
      const report = await runProductionReleaseChecks();
      assert.equal(report.passed, false);
      const persistence = report.checks.find(c => c.id === 'persistence-durable');
      assert.equal(persistence?.status, 'fail');
      assert.match(persistence?.detail ?? '', /local\/ephemeral|sqlite/);
      const scheduler = report.checks.find(c => c.id === 'scheduler-configured');
      assert.equal(scheduler?.status, 'pass', 'a configured cron endpoint must pass the scheduler gate');
    } finally {
      delete process.env.AETHRA_CRON_URL;
      delete process.env.AETHRA_STORAGE;
    }
  });

  it('produces a machine-readable report (plain serializable object)', async () => {
    const report: ReleaseReport = await runLocalReleaseChecks();
    const json = JSON.parse(JSON.stringify(report));
    assert.equal(json.mode, 'local');
    assert.equal(typeof json.producedAt, 'string');
    assert.equal(typeof json.passed, 'boolean');
    assert.ok(Array.isArray(json.checks));
    for (const check of json.checks) {
      assert.ok(['pass', 'fail', 'skip'].includes(check.status));
      assert.equal(typeof check.id, 'string');
      assert.equal(typeof check.name, 'string');
    }
    assert.equal(json.environment.scheduler.includes('deploy'), true);
  });

  it('never touches production data: the local run uses a scratch database under the OS temp dir', async () => {
    const before = process.env.AETHRA_DB_PATH;
    const report = await runLocalReleaseChecks();
    assert.equal(report.passed, true);
    // The harness set a scratch path in the OS temp dir and restored it.
    assert.equal(process.env.AETHRA_DB_PATH, before);
    const scratch = report.environment.storage.match(/\(scratch: ([^)]+)\)/);
    assert.ok(scratch, 'the local mode must report its scratch database');
    assert.ok(scratch![1].startsWith(os.tmpdir()), 'the scratch database must live under the OS temp dir');
  });
});
