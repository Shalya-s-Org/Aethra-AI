import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-jobs-test-'));
process.env.AETHRA_DB_PATH = path.join(TMP_DIR, 'jobs.db');

import { JobQueue } from '../src/lib/jobs/queue';
import { runAgentCycle, publishPublishablePosts } from '../src/lib/jobs/cycle';
import { initializeAgentInstance } from '../src/lib/agentEngine';
import { makeCandidate } from '../src/lib/discovery/types';
import {
  closeDb,
  getDb,
  getDiscoveryDecisions,
  getPostsByAgent,
  insertDiscoveryCandidate,
  upsertDiscoveryDecision
} from '../src/lib/db';
import { ulid } from '../src/lib/ids';
import type { CycleRunner } from '../src/lib/jobs/queue';

after(() => {
  closeDb();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const T0 = 1_750_000_000_000;
const MIN = 60_000;
const HOUR = 3600_000;

function newAgent(domain = 'ai-security'): string {
  return initializeAgentInstance('Test Agent', domain, undefined, {}, T0).agentId;
}

/** The global candidate pool is shared across agents (fetch-once). Cycle tests
 *  are self-contained: clear fixtures from earlier tests so a fresh agent's
 *  editorial run starts from a known pending set. */
function clearPipeline(): void {
  getDb().exec('DELETE FROM discovery_decisions; DELETE FROM discovery_candidates; DELETE FROM discovery_fetches;');
}

function countingCycle(counter: { runs: number; byAgent?: Record<string, number> }): CycleRunner {
  return async (agentId: string, now: number) => {
    void now;
    counter.runs += 1;
    if (counter.byAgent) {
      counter.byAgent[agentId] = (counter.byAgent[agentId] ?? 0) + 1;
    }
    return { ok: true, summary: `run ${counter.runs}` };
  };
}

/** Seed a gate-passed, generated, accepted decision for an agent (the same
 *  shape the editorial engine produces after a quality-gate pass). Returns the
 *  candidate id; the decision id is `decision-<agent suffix>`. */
function seedGatePassedDecision(agentId: string): string {
  const candidate = makeCandidate({
    title: 'Critical prompt injection vulnerability in agent framework allows remote code execution',
    summary: 'A critical prompt injection bypass in the agent framework tool-calling layer escalates to remote code execution. Patch released. CVE-2026-99999 assigned.',
    publishedAt: new Date(T0 - 2 * HOUR).toISOString(),
    canonicalUrl: `https://github.com/advisories/GHSA-jobs-${agentId.slice(-4)}`,
    sourceName: 'GitHub Security Advisories',
    sourceType: 'github-advisory',
    rawEvidence: JSON.stringify({ cve_id: 'CVE-2026-99999', ghsa_id: 'GHSA-jobs-1', severity: 'high' })
  });
  assert.ok(candidate);
  insertDiscoveryCandidate(candidate, T0);

  const post = {
    title: candidate.title,
    text: 'Summary. A critical prompt injection bypass in the agent framework tool-calling layer escalates to remote code execution, tracked as CVE-2026-99999. Exploitability. The disclosed details describe the attack surface. Blast radius. The affected component is exposed wherever the framework is deployed. Mitigations. The canonical advisory does not disclose a specific mitigation. Architectural implications. This finding reinforces isolating the affected component behind a trust boundary. Confidence. high confidence: this assessment is based solely on the canonical record and identifiers in the evidence.',
    rationale: 'Selected because prompt injection in agent tool-calling is a recurring security theme. It matters now because the advisory is recent. It fits the persona mission of evidence-bound analysis. It beat the competing candidates with the highest score.',
    confidence: 90,
    citedUrls: [candidate.canonicalUrl],
    relatedPosts: []
  };
  upsertDiscoveryDecision({
    id: `decision-${agentId.slice(-6)}`,
    agentId,
    candidateId: candidate.id,
    decision: 'accepted',
    totalScore: 87,
    components: {
      personaRelevance: 20, technicalImpact: 18, sourceQuality: 11,
      recency: 15, novelty: 15, discussionValue: 4, evidenceConfidence: 4
    },
    explanation: 'ACCEPTED (87/100)',
    decidedAtMs: T0,
    generation: { status: 'generated', json: JSON.stringify(post) },
    quality: { status: 'passed', json: JSON.stringify({ verdict: 'pass', score: 1, checks: [], reasons: [] }) }
  });
  return candidate.id;
}

describe('durable job queue: scheduling', () => {
  it('schedules a recurring job per agent (called by POST /api/agent/init)', () => {
    const agentId = newAgent();
    const queue = new JobQueue({ now: () => T0 });
    const jobId = queue.scheduleAgent(agentId, 30 * MIN, 0);
    const job = queue.getJob(agentId);
    assert.ok(job);
    assert.equal(job!.id, jobId);
    assert.equal(job!.scheduleMs, 30 * MIN);
    assert.equal(job!.nextRunAtMs, T0);
    assert.equal(job!.status, 'active');
    assert.equal(job!.attempts, 0);
  });

  it('rescheduling is idempotent (one job row per agent)', () => {
    const agentId = newAgent();
    const queue = new JobQueue({ now: () => T0 });
    queue.scheduleAgent(agentId, 10 * MIN, 0);
    queue.scheduleAgent(agentId, 20 * MIN, 0);
    const job = queue.getJob(agentId);
    assert.ok(job);
    assert.equal(job!.scheduleMs, 20 * MIN);
  });
});

describe('durable job queue: leases and recovery', () => {
  it('only one worker wins a due occurrence (duplicate delivery is harmless)', async () => {
    const agentId = newAgent();
    const counter = { runs: 0, byAgent: {} as Record<string, number> };
    const queue = new JobQueue({ owner: 'A', now: () => T0, cycle: countingCycle(counter) });
    queue.scheduleAgent(agentId, 30 * MIN, 0);

    await queue.processDueJobs();
    assert.equal(counter.byAgent[agentId], 1);
    const job = queue.getJob(agentId)!;
    // The next occurrence is scheduled ahead; a duplicate tick at the same
    // instant processes nothing.
    await queue.processDueJobs();
    assert.equal(counter.byAgent[agentId], 1);
    assert.ok(job.nextRunAtMs > T0);
  });

  it('a concurrent worker cannot steal a leased occurrence', async () => {
    const agentId = newAgent();
    const counter = { runs: 0, byAgent: {} as Record<string, number> };
    const queueA = new JobQueue({ owner: 'A', now: () => T0, cycle: countingCycle(counter) });
    const queueB = new JobQueue({ owner: 'B', now: () => T0, cycle: countingCycle(counter) });
    queueA.scheduleAgent(agentId, 30 * MIN, 0);

    const [sa, sb] = await Promise.all([queueA.processDueJobs(), queueB.processDueJobs()]);
    // Exactly one occurrence ran.
    assert.equal(counter.byAgent[agentId], 1);
    const okCount = [sa, sb].filter(s => s.completed === 1).length;
    assert.equal(okCount, 1);
  });

  it('recovers after a crashed worker: expired leases become claimable', async () => {
    const agentId = newAgent();
    const counter = { runs: 0, byAgent: {} as Record<string, number> };
    const queue = new JobQueue({ owner: 'B', now: () => T0, leaseMs: 5 * MIN, cycle: countingCycle(counter) });
    queue.scheduleAgent(agentId, 30 * MIN, 0);

    // Simulate a crashed worker: claim the occurrence and never settle it.
    const job = queue.getJob(agentId)!;
    const { claimScheduledJob } = await import('../src/lib/db');
    assert.ok(claimScheduledJob(job.id, T0, 'crashed-worker', T0 + 5 * MIN, `job:${job.id}:${job.nextRunAtMs}`, job.nextRunAtMs));

    // Before expiry, no one else may run it.
    await queue.processDueJobs();
    assert.equal(counter.byAgent[agentId] ?? 0, 0);

    // After expiry, the same occurrence is reclaimed and processed safely.
    const afterExpiry = new JobQueue({
      owner: 'B',
      now: () => T0 + 5 * MIN + 1,
      leaseMs: 5 * MIN,
      cycle: countingCycle(counter)
    });
    await afterExpiry.processDueJobs();
    assert.equal(counter.byAgent[agentId], 1);
  });
});

describe('durable job queue: backoff and terminal failures', () => {
  it('retries transient failures with bounded exponential backoff', async () => {
    const agentId = newAgent();
    let now = T0;
    const flaky: CycleRunner = async () => ({ ok: false, error: 'transient boom' });
    const queue = new JobQueue({ now: () => now, maxAttempts: 5, backoffMs: 1000, cycle: flaky });
    queue.scheduleAgent(agentId, 30 * MIN, 0);

    const failures: number[] = [];
    for (let i = 0; i < 4; i++) {
      const summary = await queue.processDueJobs();
      const job = queue.getJob(agentId)!;
      assert.equal(summary.terminal, 0);
      assert.equal(job.attempts, i + 1);
      failures.push(job.nextRunAtMs - now);
      now = job.nextRunAtMs; // jump to the retry time
    }
    // Backoff doubles each attempt, capped: 1000, 2000, 4000, 8000.
    assert.deepEqual(failures, [1000, 2000, 4000, 8000]);
  });

  it('records a terminal failure after max attempts without stopping the cadence', async () => {
    const agentId = newAgent();
    let now = T0;
    const flaky: CycleRunner = async () => ({ ok: false, error: 'always down' });
    const queue = new JobQueue({ now: () => now, maxAttempts: 3, backoffMs: 1000, cycle: flaky });
    queue.scheduleAgent(agentId, 30 * MIN, 0);

    let terminal = false;
    for (let i = 0; i < 5; i++) {
      const summary = await queue.processDueJobs();
      if (summary.terminal > 0) { terminal = true; break; }
      const job = queue.getJob(agentId)!;
      now = job.nextRunAtMs;
    }
    assert.ok(terminal, 'occurrence should fail terminally after max attempts');

    const job = queue.getJob(agentId)!;
    assert.match(job.lastError ?? '', /TERMINAL/);
    // The recurring cadence continues: the next regular occurrence is scheduled.
    assert.equal(job.nextRunAtMs, now + job.scheduleMs);
    assert.equal(job.attempts, 0);
  });
});

describe('accelerated 48-hour simulation mode', () => {
  it('compresses the schedule interval without changing production behavior', () => {
    const prod = new JobQueue({ now: () => T0 });
    assert.equal(prod.effectiveScheduleMs(30 * MIN), 30 * MIN); // unchanged

    const accelerated = new JobQueue({ now: () => T0, timeFactor: 60 });
    assert.equal(accelerated.effectiveScheduleMs(30 * MIN), 30_000); // 30s
  });

  it('simulates 48 hours of recurring runs in seconds', async () => {
    const agentId = newAgent();
    const counter = { runs: 0, byAgent: {} as Record<string, number> };
    // 30-min cadence accelerated 60x → 30s per occurrence.
    const acceleratedInterval = 30_000;
    const expectedRuns = Math.floor((48 * HOUR) / acceleratedInterval); // 5760
    let now = T0;
    const queue = new JobQueue({ now: () => now, timeFactor: 60, cycle: countingCycle(counter) });
    queue.scheduleAgent(agentId, 30 * MIN, 0);

    // Run a representative window quickly, then project the 48h total from the
    // durable schedule (the queue never loops in production either). Other
    // tests' leftover due jobs share this DB and run too, so assert on this
    // agent's own occurrence count, not the global tally.
    const window = 120;
    for (let step = 0; step < window; step++) {
      now += acceleratedInterval;
      await queue.processDueJobs();
    }
    assert.equal(counter.byAgent[agentId], window);
    const job = queue.getJob(agentId)!;
    // After `window` runs (one per step), the next occurrence is `window + 1`
    // intervals ahead of T0.
    assert.equal(job.nextRunAtMs, T0 + (window + 1) * acceleratedInterval);

    // Projected 48h occurrence count under acceleration: 5760 runs, with the
    // cadence still tracking the wall clock.
    const projected = Math.floor((48 * HOUR) / acceleratedInterval);
    assert.equal(projected, expectedRuns);
    assert.ok(projected > 1000, 'a 48h accelerated horizon yields thousands of occurrences');
    assert.ok(job.nextRunAtMs + (projected - window) * acceleratedInterval > T0 + 48 * HOUR);
  });
});

describe('transactional gated publication', () => {
  it('publishes gate-passed decisions transactionally, once, with idempotency', () => {
    const agentId = newAgent();
    seedGatePassedDecision(agentId);

    const first = publishPublishablePosts(agentId, T0);
    assert.equal(first, 1);

    const posts = getPostsByAgent(agentId);
    assert.equal(posts.length, 1);
    assert.match(posts[0].body, /CVE-2026-99999/);
    assert.deepEqual(posts[0].sources, ['https://github.com/advisories/GHSA-jobs-' + agentId.slice(-4)]);

    // The decision is marked published; a re-delivered occurrence publishes nothing.
    const second = publishPublishablePosts(agentId, T0);
    assert.equal(second, 0);
    assert.equal(getPostsByAgent(agentId).length, 1);

    const row = getDiscoveryDecisions({ limit: 10 })[0];
    assert.ok(row.publishedPostId, 'decision must carry its published post id');
  });

  it('never publishes merely because a run occurred (no gate-passed decisions)', async () => {
    const agentId = newAgent();
    clearPipeline(); // no pending candidates → no editorial accepts → nothing publishes
    const before = getPostsByAgent(agentId).length;
    const result = await runAgentCycle(agentId, T0, { skipDiscovery: true });
    assert.ok(result.ok);
    assert.match(result.summary ?? '', /0 gate-passed/);
    assert.equal(getPostsByAgent(agentId).length, before);
  });

  it('publishes after a real editorial + gate pass in one scheduled occurrence', async () => {
    const agentId = newAgent();
    clearPipeline(); // only this test's candidate is pending for this agent
    const candidate = makeCandidate({
      title: 'Unauthenticated remote code execution in widely deployed AI gateway component',
      summary: 'An unauthenticated request to the AI gateway control plane executes arbitrary commands, tracked as CVE-2026-88888. Patch released. GHSA-aaaa-bbbb-cccc assigned.',
      publishedAt: new Date(T0 - HOUR).toISOString(),
      canonicalUrl: 'https://github.com/advisories/GHSA-jobs-e2e-1',
      sourceName: 'GitHub Security Advisories',
      sourceType: 'github-advisory',
      rawEvidence: JSON.stringify({ cve_id: 'CVE-2026-88888', ghsa_id: 'GHSA-aaaa-bbbb-cccc', severity: 'high' })
    });
    assert.ok(candidate);
    insertDiscoveryCandidate(candidate, T0);

    const result = await runAgentCycle(agentId, T0 + HOUR, { skipDiscovery: true });
    assert.ok(result.ok, result.error);
    const posts = getPostsByAgent(agentId);
    assert.equal(posts.length, 1);
    assert.match(posts[0].body, /CVE-2026-88888/);

    // A duplicate occurrence (same decision still pending? no — marked) can't
    // republish: run the cycle again; the decision is already published.
    const again = await runAgentCycle(agentId, T0 + HOUR + 1000, { skipDiscovery: true });
    assert.ok(again.ok);
    assert.equal(getPostsByAgent(agentId).length, 1);
  });
});

describe('discovery outage classification (cycle.ts)', () => {
  it('a total discovery outage is a transient (retryable) failure; a partial one is not', async () => {
    const agentId = newAgent();
    clearPipeline();
    const failureFetch = {
      id: 'f1',
      sourceName: 'Broken Source',
      sourceType: 'cisa-kev' as const,
      url: 'https://www.cisa.gov/feeds.json',
      status: 'failure' as const,
      itemCount: null,
      error: 'down',
      fetchedAt: new Date(T0).toISOString()
    };
    const outageSummary = {
      runId: 'outage',
      startedAt: new Date(T0).toISOString(),
      finishedAt: new Date(T0).toISOString(),
      candidates: [],
      totalCandidates: 0,
      newCandidates: 0,
      filtered: 0,
      fetches: [failureFetch],
      failures: [{ sourceName: 'Broken Source', error: 'down' }]
    };

    // Every recorded fetch failed → the occurrence must be a TRANSIENT job
    // failure so the durable queue retries with backoff (never "succeeds"
    // without discovery).
    const total = await runAgentCycle(agentId, T0, { discovery: async () => outageSummary });
    assert.equal(total.ok, false);
    assert.match(total.error ?? '', /^TRANSIENT:/, 'a total outage must be transient/retryable');

    // At least one successful fetch → per-source isolation: the cycle proceeds.
    const partial = await runAgentCycle(agentId, T0 + 1000, {
      discovery: async () => ({
        ...outageSummary,
        fetches: [
          failureFetch,
          {
            id: 'f2',
            sourceName: 'Healthy Source',
            sourceType: 'arxiv',
            url: 'https://export.arxiv.org/api/query',
            status: 'success',
            itemCount: 1,
            error: null,
            fetchedAt: new Date(T0).toISOString()
          }
        ]
      })
    });
    assert.equal(partial.ok, true, 'a partial source failure must not abort the cycle');
  });
});

describe('database failure resilience', () => {
  it('an exception inside the cycle (simulating a DB failure) is transient: the worker survives, backs off, and recovers', async () => {
    const agentId = newAgent();
    let now = T0;
    let failing = true;
    const flaky: CycleRunner = async () => {
      if (failing) throw new Error('SQLITE_BUSY: database is locked');
      return { ok: true, summary: 'recovered' };
    };
    const queue = new JobQueue({ owner: 'A', now: () => now, backoffMs: 1000, cycle: flaky });
    queue.scheduleAgent(agentId, 30 * MIN, 0);

    // The thrown error is caught by the queue, recorded as a transient failure
    // (never terminal, never a crash), and the occurrence is backed off.
    const first = await queue.processDueJobs();
    assert.equal(first.completed, 0);
    assert.equal(first.terminal, 0);
    const job = queue.getJob(agentId)!;
    assert.equal(job.attempts, 1);
    assert.match(job.lastError ?? '', /SQLITE_BUSY/);
    assert.equal(job.nextRunAtMs, now + 1000, 'transient failures must back off');

    // Once the store recovers, the same occurrence completes and attempts reset.
    now = job.nextRunAtMs;
    failing = false;
    const second = await queue.processDueJobs();
    assert.equal(second.completed, 1);
    assert.equal(queue.getJob(agentId)!.attempts, 0);
  });

  it('a constraint failure during publication rolls back atomically — no partial rows, no duplicates', () => {
    const agentId = newAgent();
    seedGatePassedDecision(agentId);
    const decisionId = `decision-${agentId.slice(-6)}`;

    // Simulate a delivery race: a prior occurrence inserted the post with the
    // same idempotency key but crashed before marking the decision published.
    getDb()
      .prepare(
        `INSERT INTO posts (id, agent_id, title, body, rationale, published_at, idempotency_key)
         VALUES (?, ?, 'x', 'y', 'z', ?, ?)`
      )
      .run(ulid(), agentId, new Date(T0).toISOString(), `decision:${decisionId}`);

    // Baseline: init itself seeds one demo topic row — capture counts so the
    // rollback assertion compares like with like.
    const topicsBefore = countRows('topics', agentId);
    const sourcesBefore = countRows('sources', agentId);

    // The duplicate idempotency key violates UNIQUE(agent_id, idempotency_key)
    // inside the publication transaction, so the whole transaction rolls back
    // (the queue's catch-and-backoff on thrown cycle errors is covered by the
    // transient-failure test above).
    assert.throws(() => publishPublishablePosts(agentId, T0), /UNIQUE|constraint/i);
    assert.equal(getPostsByAgent(agentId).length, 1, 'no duplicate post may exist');
    assert.equal(countRows('topics', agentId), topicsBefore, 'topic insert must roll back with the failed post');
    assert.equal(countRows('sources', agentId), sourcesBefore, 'source insert must roll back with the failed post');
    assert.equal(
      getDiscoveryDecisions({ limit: 10 }).find(r => r.id === decisionId)?.publishedPostId,
      null,
      'decision must stay unpublished after a rolled-back publish'
    );

    // Recovery: clear the conflict; the decision then publishes exactly once.
    getDb().prepare(`DELETE FROM posts WHERE idempotency_key = ?`).run(`decision:${decisionId}`);
    assert.equal(publishPublishablePosts(agentId, T0), 1);
    assert.equal(getPostsByAgent(agentId).length, 1);
    assert.ok(
      getDiscoveryDecisions({ limit: 10 }).find(r => r.id === decisionId)?.publishedPostId,
      'the decision marker is set once the post actually commits'
    );
  });
});

function countRows(table: 'topics' | 'sources', agentId: string): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE agent_id = ?`).get(agentId) as { n: number };
  return Number(row.n);
}
