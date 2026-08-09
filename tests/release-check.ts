// Release-readiness harness (shared by scripts/release-check.ts and
// tests/release-check.test.ts).
//
// A single gate for the hackathon evaluation:
//
//   Local mode (default) — accelerated 48h simulation through the REAL durable
//   scheduler (DB-backed leases + idempotent occurrences), the real editorial
//   pipeline, memory, and quality gate, plus the judged API contract driven
//   through the actual route handlers. Runs entirely offline on a scratch
//   database and never touches dev/production data.
//
//   Production mode (--mode=production / AETHRA_RELEASE_MODE=production) —
//   integration checks against a real hosted deployment: a shared Postgres
//   database (migrations, schema constraints, transaction semantics) and the
//   deployed cron endpoint (auth gate, duplicate delivery, read-only feed).
//
// Every check returns pass/fail/skip. The report is a plain serializable
// object, so the CLI can emit it as machine-readable JSON. The gate FAILS
// (report.passed === false) when:
//   - no external scheduler is configured, or
//   - persistence is local/ephemeral in production mode, or
//   - any judged API contract assertion fails.
//
// This module is side-effect free at import: everything that touches the DB or
// the routes is imported lazily AFTER the caller's environment is applied.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Type-only: erased at compile time, so the lazy-env pattern above is intact.
import type { LlmProvider, LlmProviderResult } from '../src/lib/llm/types';

export type CheckStatus = 'pass' | 'fail' | 'skip';

export interface CheckResult {
  id: string;
  name: string;
  status: CheckStatus;
  /** Why it failed, or what was verified/skipped. */
  detail?: string;
}

export interface ReleaseReport {
  mode: 'local' | 'production';
  producedAt: string;
  passed: boolean;
  environment: Record<string, string>;
  checks: CheckResult[];
  /** Local-mode simulation facts for the human report. */
  meta?: Record<string, unknown>;
}

const REPO_ROOT = path.resolve(__dirname, '..');
const HOUR = 3600_000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------------------
// Check plumbing
// ---------------------------------------------------------------------------

interface CheckDef {
  id: string;
  name: string;
  run: () => Promise<void> | void;
}

async function runChecks(defs: CheckDef[]): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const def of defs) {
    try {
      await def.run();
      results.push({ id: def.id, name: def.name, status: 'pass' });
    } catch (err) {
      results.push({
        id: def.id,
        name: def.name,
        status: 'fail',
        detail: err instanceof Error ? err.message : String(err)
      });
    }
  }
  return results;
}

function report(mode: 'local' | 'production', environment: Record<string, string>, checks: CheckResult[], meta?: Record<string, unknown>): ReleaseReport {
  return {
    mode,
    producedAt: new Date().toISOString(),
    passed: checks.every(c => c.status === 'pass'),
    environment,
    checks,
    meta
  };
}

// ---------------------------------------------------------------------------
// Local mode
// ---------------------------------------------------------------------------

/**
 * Run the full local release gate. Uses its own scratch SQLite database under
 * the OS temp dir; prior AETHRA_* values are restored afterwards. Requires
 * AETHRA_CRON_SECRET to be set (the external scheduler gate — the committed
 * systemd timer sends it as a Bearer token).
 */
export async function runLocalReleaseChecks(): Promise<ReleaseReport> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-release-'));
  const saved: Record<string, string | undefined> = {
    AETHRA_DB_PATH: process.env.AETHRA_DB_PATH,
    AETHRA_STORAGE: process.env.AETHRA_STORAGE,
    AETHRA_LLM_PROVIDER: process.env.AETHRA_LLM_PROVIDER,
    AETHRA_SIM_ACCELERATION: process.env.AETHRA_SIM_ACCELERATION
  };
  process.env.AETHRA_DB_PATH = path.join(tmp, 'release.db');
  process.env.AETHRA_STORAGE = 'sqlite';
  process.env.AETHRA_LLM_PROVIDER = 'local'; // deterministic offline generation
  delete process.env.AETHRA_SIM_ACCELERATION; // real cadence for init-scheduled jobs

  try {
    const checks = await runChecks([
      { id: 'scheduler-configured', name: 'external scheduler configured', run: checkSchedulerConfigured },
      { id: 'init-contract', name: 'POST /api/agent/init judged contract', run: checkInitContract },
      { id: 'one-init-only', name: 'one init per Idempotency-Key', run: checkOneInitOnly },
      { id: 'feed-contract', name: 'GET /api/agent/feed judged contract', run: checkFeedContract },
      { id: 'sim-48h', name: 'accelerated 48h run (durable scheduler, editorial, memory, quality gate)', run: checkSim48h },
      { id: 'feed-read-only', name: 'GET /feed never triggers work', run: checkFeedReadOnly },
      { id: 'restart-persistence', name: 'posts survive DB close/reopen', run: checkRestartPersistence },
      { id: 'scheduler-recovery', name: 'lease recovery, duplicate delivery, backoff/terminal', run: checkSchedulerRecovery },
      { id: 'source-failure', name: 'source failure isolation + health persistence', run: checkSourceFailure },
      { id: 'llm-failure', name: 'LLM failure records rejected decision, publishes nothing', run: checkLlmFailure }
    ]);

    // Close AND reset the storage singleton: the SqliteStorage instance
    // captures its path at construction, so without resetting it a later run
    // would silently reopen the previous run's scratch file (cross-run
    // contamination in tests that call this more than once per process).
    const { closeDb } = await import('../src/lib/db');
    const { closeSqliteStorage } = await import('../src/lib/storage');
    closeDb();
    await closeSqliteStorage();

    return report(
      'local',
      {
        storage: 'sqlite (scratch: ' + tmp + ')',
        scheduler: deploySchedulerPresent() ? 'systemd (deploy/aethra-cron.timer + .service)' : 'MISSING deploy config',
        llmProvider: 'local (deterministic, offline)',
        cronSecret: process.env.AETHRA_CRON_SECRET ? 'set' : 'UNSET (gate fails)'
      },
      checks,
      simMeta
    );
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // Windows file lock — ignore; the dir is in the OS temp dir.
    }
  }
}

let simMeta: Record<string, unknown> | undefined;

function deploySchedulerPresent(): boolean {
  return (
    fs.existsSync(path.join(REPO_ROOT, 'deploy', 'aethra-cron.timer')) &&
    fs.existsSync(path.join(REPO_ROOT, 'deploy', 'aethra-cron.service'))
  );
}

function checkSchedulerConfigured(): void {
  assert.ok(deploySchedulerPresent(), 'deploy/aethra-cron.timer and deploy/aethra-cron.service must exist (committed scheduler config)');
  assert.ok(
    process.env.AETHRA_CRON_SECRET && process.env.AETHRA_CRON_SECRET.length > 0,
    'AETHRA_CRON_SECRET must be set: the systemd timer (deploy/aethra-cron.service) sends it as Authorization: Bearer, and the cron route rejects requests without it'
  );
}

async function checkInitContract(): Promise<void> {
  const { POST } = await import('../src/app/api/agent/init/route');
  const valid = { persona: { name: 'Ada', domain: 'ai-security' } };
  const isoRe = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  const ok = await POST(jsonRequest('/api/agent/init', valid));
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.deepEqual(
    Object.keys(body).sort(),
    ['agentId', 'message', 'status', 'timestamp'],
    'init response must have exactly the contract keys'
  );
  assert.equal(body.status, 'initialized');
  assert.match(body.timestamp, isoRe);
  assert.ok(
    ok.headers.get('x-agent-ownership-token'),
    'init must return the ownership token header (required to delete the agent)'
  );

  // Validation failures must be useful 4xx responses, never 500.
  for (const bad of [{}, { persona: {} }, { persona: { name: 'Ada' } }, { persona: { name: 'Ada', domain: 'x' }, extra: 1 }]) {
    const res = await POST(jsonRequest('/api/agent/init', bad));
    assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(bad)}`);
  }
  const textPlain = await POST(jsonRequest('/api/agent/init', valid, 'text/plain'));
  assert.equal(textPlain.status, 415, 'non-JSON content-type must be 415');
  const huge = await POST(jsonRequest('/api/agent/init', { persona: { name: 'x', domain: 'y', mission: 'z'.repeat(20 * 1024) } }));
  assert.equal(huge.status, 413, 'oversized bodies must be 413');
}

async function checkOneInitOnly(): Promise<void> {
  const { POST } = await import('../src/app/api/agent/init/route');
  const { getDb } = await import('../src/lib/db');

  const key = 'release-check-init-1';
  const first = await (await POST(jsonRequest('/api/agent/init', { persona: { name: 'Ada', domain: 'ai-security' } }, 'application/json', key))).json();
  const second = await (await POST(jsonRequest('/api/agent/init', { persona: { name: 'Ada', domain: 'ai-security' } }, 'application/json', key))).json();
  assert.equal(first.agentId, second.agentId, 'same Idempotency-Key must return the same agent');
  assert.deepEqual(first, second, 'idempotent replay must be byte-identical');

  const rows = getDb().prepare('SELECT COUNT(*) AS n FROM agents WHERE id = ?').get(first.agentId) as { n: number };
  assert.equal(Number(rows.n), 1, 'one init must create exactly one agent row');

  const other = await (await POST(jsonRequest('/api/agent/init', { persona: { name: 'Ada', domain: 'ai-security' } }, 'application/json', 'release-check-init-2'))).json();
  assert.notEqual(other.agentId, first.agentId, 'a distinct key must create a distinct agent');
}

async function checkFeedContract(): Promise<void> {
  const { GET } = await import('../src/app/api/agent/feed/route');
  const { initializeAgentInstance } = await import('../src/lib/agentEngine');
  const { isUlid } = await import('../src/lib/ids');

  // Invalid/missing agentId → 400; well-formed but unknown → 404.
  for (const bad of [null, '__proto__', 'bad id!', 'a'.repeat(200)]) {
    const url = bad === null ? 'http://localhost/api/agent/feed' : `http://localhost/api/agent/feed?agentId=${encodeURIComponent(String(bad))}`;
    assert.equal((await GET(new Request(url))).status, 400, `expected 400 for agentId=${String(bad)}`);
  }
  assert.equal((await GET(new Request('http://localhost/api/agent/feed?agentId=01ARZ3NDEKTSV4RRFFQ69G5FA0'))).status, 404);

  // A fresh agent serves an empty feed — demo seeds excluded.
  const agent = initializeAgentInstance('Release Feed', 'ai-security', undefined, undefined, 1_700_000_000_000);
  const empty = await (await GET(new Request(`http://localhost/api/agent/feed?agentId=${agent.agentId}`))).json();
  assert.deepEqual(empty, { posts: [] }, 'judged feed must exclude static demo/seed posts');

  // The sim check below verifies the populated shape + reverse-chronology via
  // the route; assert the item contract here against published posts (same
  // known-good path as tests/api.test.ts).
  const T0 = 1_700_000_000_000;
  const { advanceAgentById } = await import('../src/lib/agentEngine');
  advanceAgentById(agent.agentId, T0 + 30_000); // run 1: robot-1 (published)
  advanceAgentById(agent.agentId, T0 + 60_000);
  advanceAgentById(agent.agentId, T0 + 90_000); // run 2: robot-2 (published)
  advanceAgentById(agent.agentId, T0 + 120_000);
  const res = await GET(new Request(`http://localhost/api/agent/feed?agentId=${agent.agentId}`));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.posts.length >= 1);
  for (const post of body.posts) {
    assert.deepEqual(
      Object.keys(post).sort(),
      ['createdAt', 'id', 'rationale', 'sources', 'text'],
      'each feed item must have exactly the contract keys'
    );
    assert.ok(isUlid(post.id));
    assert.match(post.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    assert.ok(post.text.length > 0 && post.rationale.length > 0);
    assert.ok(Array.isArray(post.sources) && post.sources.length > 0);
    assert.ok(post.sources.every((s: string) => s.startsWith('https://')), 'sources must be canonical HTTPS');
  }
  const times = body.posts.map((p: { createdAt: string }) => Date.parse(p.createdAt));
  assert.ok(times.every((t: number, i: number) => i === 0 || t <= times[i - 1]), 'feed must be reverse-chronological');
}

async function checkSim48h(): Promise<void> {
  const { initializeAgentInstance } = await import('../src/lib/agentEngine');
  const { runEvaluationSim, TEMPLATES } = await import('./evaluation-harness');
  const { closeDb, getDb, getPostsByAgent } = await import('../src/lib/db');
  const { GET } = await import('../src/app/api/agent/feed/route');

  const T0 = 1_750_000_000_000;
  const agentId = initializeAgentInstance('Release Ada', 'ai-security', undefined, {}, T0).agentId;
  const result = await runEvaluationSim({ agentId, startMs: T0, scheduleMs: 6 * HOUR, horizonMs: 48 * HOUR });

  // Every scheduled occurrence ran exactly once; none failed or lost its lease.
  assert.equal(result.steps, 48);
  assert.deepEqual(result.summaries.filter(s => !s.ok), [], 'every occurrence must complete without error');

  // Publication: bounded by template count, ≥6h routine interval, ≤4 per 24h cap.
  const posts = getPostsByAgent(agentId);
  assert.ok(posts.length >= 4 && posts.length <= TEMPLATES.length, `expected 4..8 posts, got ${posts.length}`);
  const times = posts.map(p => Date.parse(p.createdAt)).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i] - times[i - 1] >= 6 * HOUR, 'routine posting interval violated');
  }
  for (let i = 0; i < times.length; i++) {
    const inWindow = times.filter(t => t > times[i] - DAY && t <= times[i]).length;
    assert.ok(inWindow <= 4, 'daily post cap (4/24h) violated');
  }

  // No duplicate posts: unique canonical URLs, unique idempotency keys, HTTPS only, no demo content.
  const urls = posts.flatMap(p => p.sources);
  assert.equal(new Set(urls).size, urls.length, 'canonical source URLs must be unique across posts');
  assert.ok(urls.every(u => u.startsWith('https://')), 'all sources must be canonical HTTPS');
  assert.ok(posts.every(p => !p.isDemo), 'judged feed must contain no demo/seed posts');
  const keys = getDb()
    .prepare(`SELECT idempotency_key FROM posts WHERE agent_id = ? AND idempotency_key IS NOT NULL`)
    .all(agentId) as Array<{ idempotency_key: string }>;
  assert.equal(new Set(keys.map(k => k.idempotency_key)).size, keys.length, 'idempotency keys must be unique');

  // Decisions persisted with scores + explanations; accepted == published;
  // every published post passed the quality gate.
  const counts = getDb()
    .prepare(`SELECT decision, COUNT(*) AS n FROM discovery_decisions GROUP BY decision`)
    .all() as Array<{ decision: string; n: number }>;
  const byKind = Object.fromEntries(counts.map(c => [c.decision, c.n]));
  assert.equal(byKind.accepted, posts.length, 'accepted decisions must all have been published');
  assert.ok((byKind.rejected ?? 0) > 100, 'duplicate/stale candidates must be rejected, not published');
  const rows = getDb()
    .prepare(`SELECT decision, total_score, explanation, quality_status FROM discovery_decisions`)
    .all() as Array<{ decision: string; total_score: number; explanation: string; quality_status: string | null }>;
  assert.ok(rows.length > 0);
  assert.ok(rows.every(r => typeof r.total_score === 'number' && r.explanation.length > 0), 'scores + explanations persisted');
  const acceptedRows = rows.filter(r => r.decision === 'accepted');
  assert.ok(
    acceptedRows.length >= posts.length && acceptedRows.every(r => r.quality_status === 'passed'),
    'published decisions must all have passed the quality gate'
  );

  // The judged feed over the route: exactly the persisted posts, newest first.
  const feedRes = await GET(new Request(`http://localhost/api/agent/feed?agentId=${agentId}`));
  assert.equal(feedRes.status, 200);
  const feed = await feedRes.json();
  assert.equal(feed.posts.length, posts.length);
  const feedTimes = feed.posts.map((p: { createdAt: string }) => Date.parse(p.createdAt));
  assert.ok(feedTimes.every((t: number, i: number) => i === 0 || t <= feedTimes[i - 1]), 'feed must be reverse-chronological');

  // Leave the store closed for the restart check to reopen, and record facts
  // for the human report.
  simMeta = {
    occurrences: result.steps,
    failedOccurrences: result.summaries.filter(s => !s.ok).length,
    posts: posts.length,
    accepted: byKind.accepted ?? 0,
    held: byKind.held ?? 0,
    rejected: byKind.rejected ?? 0,
    simAgentId: agentId
  };
  closeDb();
}

async function checkFeedReadOnly(): Promise<void> {
  const { GET } = await import('../src/app/api/agent/feed/route');
  const { getDb, getPostsByAgent, getScheduledJobByAgent } = await import('../src/lib/db');
  const agentId = simMeta?.simAgentId as string | undefined;
  assert.ok(agentId, 'sim-48h must have run first');

  const count = (table: string, agentCol: string | null) => {
    const sql = agentCol ? `SELECT COUNT(*) AS n FROM ${table} WHERE ${agentCol} = ?` : `SELECT COUNT(*) AS n FROM ${table}`;
    const row = getDb().prepare(sql).get(...(agentCol ? [agentId] : [])) as { n: number };
    return Number(row.n);
  };
  const snapshot = () => ({
    posts: getPostsByAgent(agentId).length,
    runs: count('agent_runs', 'agent_id'),
    candidates: count('discovery_candidates', null),
    decisions: count('discovery_decisions', null),
    job: getScheduledJobByAgent(agentId) === null ? 0 : 1
  });
  const before = snapshot();

  for (let i = 0; i < 5; i++) {
    const res = await GET(new Request(`http://localhost/api/agent/feed?agentId=${agentId}`));
    assert.equal(res.status, 200);
    assert.equal((await res.json()).posts.length, getPostsByAgent(agentId).length);
  }
  assert.deepEqual(snapshot(), before, 'GET /feed must be side-effect free (no publish/discover/schedule/runs)');
}

async function checkRestartPersistence(): Promise<void> {
  const { closeDb, getDb, getPostsByAgent, getScheduledJobByAgent } = await import('../src/lib/db');
  const agentId = simMeta?.simAgentId as string | undefined;
  assert.ok(agentId, 'sim-48h must have run first');

  const before = {
    posts: getPostsByAgent(agentId).length,
    job: getScheduledJobByAgent(agentId) === null ? 0 : 1,
    agents: (getDb().prepare(`SELECT COUNT(*) AS n FROM agents WHERE id = ?`).get(agentId) as { n: number }).n
  };
  assert.ok(before.posts > 0, 'restart check requires published posts');

  // Close and reopen the same file — the durable store must retain everything.
  closeDb();
  const after = {
    posts: getPostsByAgent(agentId).length,
    job: getScheduledJobByAgent(agentId) === null ? 0 : 1,
    agents: (getDb().prepare(`SELECT COUNT(*) AS n FROM agents WHERE id = ?`).get(agentId) as { n: number }).n
  };
  assert.deepEqual(after, before, 'posts, job, and agent row must survive DB close/reopen');
}

async function checkSchedulerRecovery(): Promise<void> {
  const { JobQueue } = await import('../src/lib/jobs/queue');
  const { initializeAgentInstance } = await import('../src/lib/agentEngine');
  const { claimScheduledJob } = await import('../src/lib/db');
  type CycleRunner = (agentId: string, now: number) => Promise<{ ok: boolean; summary?: string; error?: string }>;

  // A virtual clock far in the future so no other check's job is due here.
  const T0 = 2_000_000_000_000;
  const MIN = 60_000;

  function counting(byAgent: Record<string, number>): CycleRunner {
    return async (agentId: string) => {
      byAgent[agentId] = (byAgent[agentId] ?? 0) + 1;
      return { ok: true, summary: `run ${byAgent[agentId]}` };
    };
  }

  // Duplicate delivery: two workers racing the same due occurrence — exactly one wins.
  {
    const agentId = initializeAgentInstance('Release Race', 'ai-security', undefined, {}, T0).agentId;
    const ran: Record<string, number> = {};
    const a = new JobQueue({ owner: 'A', now: () => T0, cycle: counting(ran) });
    const b = new JobQueue({ owner: 'B', now: () => T0, cycle: counting(ran) });
    a.scheduleAgent(agentId, 30 * MIN, 0);
    await Promise.all([a.processDueJobs(), b.processDueJobs()]);
    assert.equal(ran[agentId] ?? 0, 1, 'a duplicate cron delivery must process the occurrence exactly once');
    // A re-delivery of the same instant claims nothing.
    await b.processDueJobs();
    assert.equal(ran[agentId] ?? 0, 1);
  }

  // Crash recovery: a leased occurrence is locked until expiry, then reclaimed.
  {
    const agentId = initializeAgentInstance('Release Crash', 'ai-security', undefined, {}, T0).agentId;
    const ran: Record<string, number> = {};
    const queue = new JobQueue({ owner: 'B', now: () => T0, leaseMs: 5 * MIN, cycle: counting(ran) });
    queue.scheduleAgent(agentId, 30 * MIN, 0);
    const job = queue.getJob(agentId)!;
    assert.ok(
      claimScheduledJob(job.id, T0, 'crashed-worker', T0 + 5 * MIN, `job:${job.id}:${job.nextRunAtMs}`, job.nextRunAtMs),
      'the crashed worker must be able to claim the occurrence'
    );
    // Before expiry the occurrence is locked.
    await queue.processDueJobs();
    assert.equal(ran[agentId] ?? 0, 0);
    // After expiry a fresh worker reclaims and completes it (restart recovery).
    const recovered = new JobQueue({ owner: 'B', now: () => T0 + 5 * MIN + 1, leaseMs: 5 * MIN, cycle: counting(ran) });
    await recovered.processDueJobs();
    assert.equal(ran[agentId] ?? 0, 1, 'expired leases must be reclaimed after a worker crash/restart');
  }

  // Bounded exponential backoff → terminal failure → cadence continues.
  {
    const agentId = initializeAgentInstance('Release Flaky', 'ai-security', undefined, {}, T0).agentId;
    let now = T0;
    const flaky: CycleRunner = async () => ({ ok: false, error: 'transient outage' });
    const queue = new JobQueue({ now: () => now, maxAttempts: 3, backoffMs: 1000, cycle: flaky });
    queue.scheduleAgent(agentId, 30 * MIN, 0);

    const backoffs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const summary = await queue.processDueJobs();
      if (summary.terminal > 0) break;
      const job = queue.getJob(agentId)!;
      backoffs.push(job.nextRunAtMs - now);
      now = job.nextRunAtMs;
    }
    assert.deepEqual(backoffs, [1000, 2000], 'transient failures must back off exponentially');
    const job = queue.getJob(agentId)!;
    assert.match(job.lastError ?? '', /TERMINAL/, 'exhausting attempts must record a terminal failure');
    assert.equal(job.attempts, 0, 'the recurring cadence must continue after a terminal failure');
    assert.equal(job.nextRunAtMs, now + job.scheduleMs);
  }
}

async function checkSourceFailure(): Promise<void> {
  const { runDiscovery } = await import('../src/lib/discovery/runner');
  const { runAgentCycle } = await import('../src/lib/jobs/cycle');
  const { initializeAgentInstance } = await import('../src/lib/agentEngine');
  const { getSourceHealth } = await import('../src/lib/db');

  const T0 = 1_750_000_000_000;
  const agentId = initializeAgentInstance('Release Sources', 'ai-security', undefined, {}, T0).agentId;

  // One source down, the rest fine: the cycle must complete (per-source
  // isolation), and the failure must be persisted to source health.
  {
    const failing = await runDiscovery({
      sources: ['GitHub Security Advisories'],
      fetchImpl: async () => {
        throw new Error('simulated network outage for release check');
      }
    });
    assert.ok(failing.failures.length >= 1, 'the failed source must be reported');
    assert.ok(failing.fetches.every(f => f.status === 'failure'), 'all fetches for the dead source must be failures');

    // Partial failure: cycle proceeds (fetches non-empty).
    const partial = await runAgentCycle(agentId, T0, {
      discovery: async () => ({ ...failing, fetches: [...failing.fetches, { id: 'x', sourceName: 'CISA KEV', sourceType: 'cisa-kev', url: 'https://www.cisa.gov/feeds.json', status: 'success' as const, itemCount: 1, error: null, fetchedAt: new Date(T0).toISOString() }] })
    });
    assert.ok(partial.ok, `partial source failure must not abort the cycle: ${partial.error ?? ''}`);

    const health = getSourceHealth().find(h => h.sourceName === 'GitHub Security Advisories');
    assert.ok(health, 'source health row must exist after a failure');
    assert.ok(health.consecutiveFailures >= 1, 'consecutive failures must be recorded');
    assert.match(health.lastError ?? '', /simulated network outage/, 'the persisted failure reason must survive');
  }

  // Total outage: every allowlisted source down → transient job failure, so the
  // durable queue retries with backoff instead of publishing anything.
  {
    const outage = await runDiscovery({
      sources: ['GitHub Security Advisories'],
      fetchImpl: async () => {
        throw new Error('total outage for release check');
      }
    });
    const result = await runAgentCycle(agentId, T0 + 1000, { discovery: async () => outage });
    assert.equal(result.ok, false, 'a total source outage must fail the occurrence');
    assert.match(result.error ?? '', /^TRANSIENT:/, 'a total outage must be a transient (retryable) failure');
  }
}

async function checkLlmFailure(): Promise<void> {
  const { runEditorial } = await import('../src/lib/editorial/engine');
  const { publishPublishablePosts } = await import('../src/lib/jobs/cycle');
  const { initializeAgentInstance } = await import('../src/lib/agentEngine');
  const { makeCandidate } = await import('../src/lib/discovery/types');
  const { getDb, getPostsByAgent, insertDiscoveryCandidate } = await import('../src/lib/db');

  const T0 = 1_750_000_000_000;
  const agentId = initializeAgentInstance('Release LLM', 'ai-security', undefined, {}, T0).agentId;

  const candidate = makeCandidate({
    title: 'Critical prompt injection bypass in agent tool-calling layer allows remote code execution',
    summary:
      'A critical prompt injection bypass in the agent tool-calling layer escalates to remote code execution. Patch released. CVE-2026-42421 assigned. GHSA-release-llm assigned.',
    publishedAt: new Date(T0 - HOUR).toISOString(),
    canonicalUrl: 'https://github.com/advisories/GHSA-release-llm',
    sourceName: 'GitHub Security Advisories',
    sourceType: 'github-advisory',
    rawEvidence: JSON.stringify({ cve_id: 'CVE-2026-42421', ghsa_id: 'GHSA-release-llm', severity: 'high' })
  });
  assert.ok(candidate, 'fixture candidate must validate');
  insertDiscoveryCandidate(candidate, T0);

  const failingProvider: LlmProvider = {
    name: 'release-check-failing',
    async complete(): Promise<LlmProviderResult> {
      return { ok: false, error: 'simulated LLM outage for release check' };
    }
  };

  await runEditorial({ agentId, now: T0, provider: failingProvider });

  // The failed generation flips the accepted candidate to rejected, with the
  // failure recorded — never weak content.
  const rows = getDb()
    .prepare(
      `SELECT decision, generation_status, generation_failure FROM discovery_decisions WHERE agent_id = ? ORDER BY decided_at DESC LIMIT 10`
    )
    .all(agentId) as Array<{ decision: string; generation_status: string | null; generation_failure: string | null }>;
  assert.ok(rows.length > 0, 'a decision must be recorded for the candidate');
  const failed = rows.find(r => r.decision === 'rejected' && r.generation_status === 'failed');
  assert.ok(failed, 'the generation failure must be recorded as a rejected decision');
  assert.match(failed!.generation_failure ?? '', /simulated LLM outage/);

  assert.equal(publishPublishablePosts(agentId, T0), 0, 'nothing may publish when generation failed');
  assert.equal(getPostsByAgent(agentId).length, 0, 'no post may exist for the failed candidate');
}

// ---------------------------------------------------------------------------
// Production-like integration mode
// ---------------------------------------------------------------------------

/**
 * Integration checks against a real hosted deployment. Requires:
 *   AETHRA_CRON_URL + AETHRA_CRON_SECRET  (the external scheduler webhook)
 *   AETHRA_STORAGE=postgres + DATABASE_URL (shared durable database)
 * Without those the config gates FAIL (never silently skip) — that is the
 * release gate's purpose.
 */
export async function runProductionReleaseChecks(): Promise<ReleaseReport> {
  const env = process.env;
  const cronUrl = env.AETHRA_CRON_URL?.trim() ?? '';
  const secret = env.AETHRA_CRON_SECRET?.trim() ?? '';
  const storage = (env.AETHRA_STORAGE ?? 'sqlite').toLowerCase();
  const dbUrl = env.DATABASE_URL?.trim() ?? '';
  const llmProvider = (env.AETHRA_LLM_PROVIDER ?? 'auto').toLowerCase();
  const baseUrl = cronUrl ? new URL(cronUrl).origin : '';

  const configChecks = await runChecks([
    {
      id: 'scheduler-configured',
      name: 'external scheduler endpoint configured',
      run: () => {
        assert.ok(cronUrl, 'AETHRA_CRON_URL is required (the external scheduler invoking POST /api/cron/run)');
        assert.ok(secret.length > 0, 'AETHRA_CRON_SECRET is required (the scheduler authenticates with it)');
      }
    },
    {
      id: 'persistence-durable',
      name: 'shared durable database configured',
      run: () => {
        assert.equal(storage, 'postgres', 'production mode requires AETHRA_STORAGE=postgres (sqlite is local/ephemeral)');
        assert.ok(dbUrl.length > 0, 'production mode requires DATABASE_URL (a shared hosted database)');
      }
    },
    {
      id: 'llm-provider-production',
      name: 'production LLM provider configured',
      run: () => {
        assert.notEqual(
          llmProvider,
          'local',
          'AETHRA_LLM_PROVIDER=local (deterministic template output) must never be deployed; set AETHRA_LLM_PROVIDER=openai with AETHRA_LLM_API_KEY'
        );
      }
    }
  ]);

  const gatesPassed = configChecks.every(c => c.status === 'pass');
  const skipDetail = 'skipped: a configuration gate failed';
  const checks: CheckResult[] = [...configChecks];

  if (!gatesPassed) {
    // Do not touch a half-configured deployment.
    checks.push(
      { id: 'db-connect-migrate', name: 'hosted DB connect + migrations', status: 'skip', detail: skipDetail },
      { id: 'db-schema-constraints', name: 'hosted DB schema + uniqueness constraints', status: 'skip', detail: skipDetail },
      { id: 'db-probe-transaction', name: 'hosted DB write + rollback probe', status: 'skip', detail: skipDetail },
      { id: 'http-init-one', name: 'deployed POST /api/agent/init (one init only)', status: 'skip', detail: skipDetail },
      { id: 'http-cron-auth', name: 'deployed cron endpoint auth gate', status: 'skip', detail: skipDetail },
      { id: 'http-feed-no-work', name: 'deployed GET /feed never triggers work', status: 'skip', detail: skipDetail },
      { id: 'http-no-duplicate-posts', name: 'deployed duplicate cron delivery publishes nothing twice', status: 'skip', detail: skipDetail }
    );
    return report(
      'production',
      { baseUrl: baseUrl || '(not configured)', storage, db: dbUrl ? new URL(dbUrl).host : '(not configured)', llmProvider, scheduler: cronUrl ? 'remote cron' : 'NONE' },
      checks
    );
  }

  // --- Database checks (the hosted Postgres behind the deployment) ---
  const db = await (async () => {
    const { Pool } = await import('pg');
    return new Pool({ connectionString: dbUrl, max: 4 });
  })();
  const dbChecks = await runChecks([
    {
      id: 'db-connect-migrate',
      name: 'hosted DB connect + migrations',
      run: async () => {
        const { PostgresStorage } = await import('../src/lib/storage/postgres');
        const driver = new PostgresStorage({ connectionString: dbUrl });
        try {
          await driver.migrate();
          const applied = await driver.all('SELECT id FROM schema_migrations ORDER BY id');
          assert.ok(applied.length >= 1, 'schema_migrations must be populated');
        } finally {
          await driver.close();
        }
      }
    },
    {
      id: 'db-schema-constraints',
      name: 'hosted DB schema + uniqueness constraints',
      run: async () => {
        const tables = ['agents', 'posts', 'discovery_candidates', 'discovery_decisions', 'memory_entries', 'scheduled_jobs', 'source_health', 'agent_runs', 'post_links'];
        for (const table of tables) {
          const row = await db.query(
            `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
            [table]
          );
          assert.ok(row.rowCount === 1, `required table ${table} must exist`);
        }
        const unique = await db.query(
          `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'posts' AND indexname = 'idx_posts_idempotency'`
        );
        assert.equal(unique.rowCount, 1, 'unique index idx_posts_idempotency (posts.agent_id, idempotency_key) must exist');
        const feed = await db.query(
          `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'posts' AND indexdef ILIKE '%published_at%'`
        );
        assert.ok((feed.rowCount ?? 0) >= 1, 'a feed-ordering index on posts.published_at must exist');
      }
    },
    {
      id: 'db-probe-transaction',
      name: 'hosted DB write + rollback probe',
      run: async () => {
        const probeId = `release-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await db.query(`CREATE TABLE IF NOT EXISTS aethra_release_probe (id TEXT PRIMARY KEY)`);
        try {
          await db.query(`INSERT INTO aethra_release_probe (id) VALUES ($1)`, [probeId]);
          const found = await db.query(`SELECT 1 FROM aethra_release_probe WHERE id = $1`, [probeId]);
          assert.equal(found.rowCount, 1, 'committed write must be visible');
          // A rolled-back delete must not persist.
          const client = await db.connect();
          try {
            await client.query('BEGIN');
            await client.query(`DELETE FROM aethra_release_probe WHERE id = $1`, [probeId]);
            await client.query('ROLLBACK');
          } finally {
            client.release();
          }
          const afterRollback = await db.query(`SELECT 1 FROM aethra_release_probe WHERE id = $1`, [probeId]);
          assert.equal(afterRollback.rowCount, 1, 'rollback must restore the row');
        } finally {
          await db.query(`DELETE FROM aethra_release_probe WHERE id = $1`, [probeId]);
        }
      }
    }
  ]);
  checks.push(...dbChecks);

  const dbPassed = dbChecks.every(c => c.status === 'pass');

  // --- HTTP checks against the deployed instance ---
  const httpChecks = await runChecks([
    {
      id: 'http-init-one',
      name: 'deployed POST /api/agent/init (one init only)',
      run: async () => {
        const body = { persona: { name: 'Ada', domain: 'ai-security' } };
        const key = `release-${Date.now()}`;
        const post = () =>
          fetch(`${baseUrl}/api/agent/init`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'idempotency-key': key },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(15_000)
          });
        const first = await (await post()).json();
        const second = await (await post()).json();
        assert.deepEqual(first, second, 'idempotent replay must return the identical response');
        assert.deepEqual(
          Object.keys(first).sort(),
          ['agentId', 'message', 'status', 'timestamp'],
          'init response must have exactly the contract keys'
        );
        const rows = await db.query(`SELECT COUNT(*) AS n FROM agents WHERE id = $1`, [first.agentId]);
        assert.equal(Number(rows.rows[0].n), 1, 'one init must create exactly one agent row');
        (httpChecksState.agentId = first.agentId);
      }
    },
    {
      id: 'http-cron-auth',
      name: 'deployed cron endpoint auth gate',
      run: async () => {
        const tick = (auth: string | null) =>
          fetch(`${cronUrl}`, {
            method: 'POST',
            headers: auth ? { authorization: auth } : {},
            signal: AbortSignal.timeout(30_000)
          });
        assert.equal((await tick(null)).status, 401, 'cron without a secret must be rejected');
        assert.equal((await tick(`Bearer ${'wrong-'.repeat(8)}`)).status, 401, 'cron with a wrong secret must be rejected');
        const ok = await tick(`Bearer ${secret}`);
        assert.equal(ok.status, 200);
        const summary = await ok.json();
        for (const key of ['claimed', 'completed', 'retried', 'terminal']) {
          assert.equal(typeof summary[key], 'number', `cron tick summary must include ${key}`);
        }
      }
    },
    {
      id: 'http-feed-no-work',
      name: 'deployed GET /feed never triggers work',
      run: async () => {
        assert.ok(httpChecksState.agentId, 'init check must run first');
        const agentId = httpChecksState.agentId;
        const feed = async () =>
          (await fetch(`${baseUrl}/api/agent/feed?agentId=${agentId}`, { signal: AbortSignal.timeout(15_000) })).json();
        const posts = async () =>
          Number((await db.query(`SELECT COUNT(*) AS n FROM posts WHERE agent_id = $1`, [agentId])).rows[0].n);
        const runs = async () =>
          Number((await db.query(`SELECT COUNT(*) AS n FROM agent_runs WHERE agent_id = $1`, [agentId])).rows[0].n);

        const first = await feed();
        assert.ok(Array.isArray(first.posts), 'feed must return { posts: [...] }');
        const before = { posts: await posts(), runs: await runs() };
        for (let i = 0; i < 3; i++) {
          const body = await feed();
          assert.equal(body.posts.length, before.posts, 'GET /feed must not publish');
        }
        assert.deepEqual({ posts: await posts(), runs: await runs() }, before, 'GET /feed must be side-effect free');
      }
    },
    {
      id: 'http-no-duplicate-posts',
      name: 'deployed duplicate cron delivery publishes nothing twice',
      run: async () => {
        const tick = () =>
          fetch(`${cronUrl}`, {
            method: 'POST',
            headers: { authorization: `Bearer ${secret}` },
            signal: AbortSignal.timeout(30_000)
          });
        const agentId = httpChecksState.agentId;
        const counts = async () => {
          const res = await db.query(
            `SELECT COUNT(*) AS n, COUNT(DISTINCT idempotency_key) AS keys FROM posts WHERE agent_id = $1 AND idempotency_key IS NOT NULL`,
            [agentId]
          );
          return { posts: Number(res.rows[0].n), keys: Number(res.rows[0].keys) };
        };
        const before = await counts();
        assert.equal((await tick()).status, 200);
        assert.equal((await tick()).status, 200, 'a duplicate delivery must be accepted and deduplicated');
        const after = await counts();
        assert.equal(after.posts, before.posts, 'no duplicate post may be created by a second delivery');
        assert.equal(after.keys, after.posts, 'every post must carry a distinct idempotency key');
      }
    }
  ]);
  checks.push(...httpChecks);

  await db.end();
  return report(
    'production',
    { baseUrl, storage, db: new URL(dbUrl).host, llmProvider, scheduler: 'remote cron' },
    checks,
    { dbChecksPassed: dbPassed }
  );
}

const httpChecksState: { agentId?: string } = {};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonRequest(url: string, body: unknown, contentType = 'application/json', idempotencyKey?: string): Request {
  const headers: Record<string, string> = { 'content-type': contentType };
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  return new Request(`http://localhost${url}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
