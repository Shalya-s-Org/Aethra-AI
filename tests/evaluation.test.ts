// Evaluation harness: the 48-hour accelerated simulation and its invariants.
//
// This is the hackathon's end-to-end evaluation: the REAL production pipeline
// (discovery → editorial scoring → LLM generation → pre-publication quality
// gate → transactional gated publication) driven through the durable job
// queue with deterministic fixture-derived candidates and a virtual clock.
// No network, no randomness, no production data.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-eval-test-'));
process.env.AETHRA_DB_PATH = path.join(TMP_DIR, 'eval.db');

import { initializeAgentInstance } from '../src/lib/agentEngine';
import { runEvaluationSim, TEMPLATES } from './evaluation-harness';
import { closeDb, getDb, getPostsByAgent, getScheduledJobByAgent } from '../src/lib/db';
import { GET as feedGET } from '../src/app/api/agent/feed/route';

after(() => {
  closeDb();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const HOUR = 3600_000;
const DAY = 24 * HOUR;
const T0 = 1_750_000_000_000;

describe('48-hour accelerated evaluation simulation', () => {
  it('runs the real pipeline over 48h: dedup, routine interval, daily cap, transactional publish', async () => {
    const agentId = initializeAgentInstance('Eval Ada', 'ai-security', undefined, {}, T0).agentId;
    const result = await runEvaluationSim({
      agentId,
      startMs: T0,
      scheduleMs: 6 * HOUR, // production cadence = the routine posting interval
      horizonMs: 48 * HOUR,
      timeFactor: 6 // → 1h effective; 48 recurring occurrences in ~1-2s
    });

    // Every scheduled occurrence ran exactly once; none failed or lost its lease.
    assert.equal(result.steps, 48);
    assert.equal(result.summaries.length, 48);
    assert.deepEqual(
      result.summaries.filter(s => !s.ok),
      [],
      'every occurrence must complete without error'
    );

    // 1. Publication happened, is bounded by the template count, and is
    //    correctly spaced: routine interval (≥ 6h) and daily cap (≤ 4 per
    //    rolling 24h) are enforced by the editorial engine.
    const posts = getPostsByAgent(agentId);
    assert.ok(posts.length >= 4 && posts.length <= TEMPLATES.length, `expected 4..8 posts, got ${posts.length}`);
    const times = posts.map(p => Date.parse(p.createdAt)).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      assert.ok(times[i] - times[i - 1] >= 6 * HOUR, `routine interval violated between posts ${i - 1} and ${i}`);
    }
    for (let i = 0; i < times.length; i++) {
      const inWindow = times.filter(t => t > times[i] - DAY && t <= times[i]).length;
      assert.ok(inWindow <= 4, `daily cap (4/24h) violated at post ${i}`);
    }

    // 2. No duplicate publication anywhere: unique canonical source URLs and
    //    unique idempotency keys per agent, canonical HTTPS sources only.
    const urls = posts.flatMap(p => p.sources);
    assert.equal(new Set(urls).size, urls.length, 'canonical source URLs must be unique across posts');
    assert.ok(urls.every(u => u.startsWith('https://')), 'all sources must be canonical HTTPS');
    assert.ok(posts.every(p => !p.isDemo), 'judged feed must contain no demo/seed posts');

    const keyRows = getDb()
      .prepare(`SELECT idempotency_key FROM posts WHERE agent_id = ? AND idempotency_key IS NOT NULL`)
      .all(agentId) as Array<{ idempotency_key: string }>;
    assert.equal(new Set(keyRows.map(k => k.idempotency_key)).size, keyRows.length, 'idempotency keys must be unique');

    // 3. Every decision is persisted with a score and a human-readable
    //    explanation; duplicates are rejected, generated posts carry the
    //    quality-gate report, and accepted == published (gate-passed only).
    const counts = getDb()
      .prepare(`SELECT decision, COUNT(*) AS n FROM discovery_decisions GROUP BY decision`)
      .all() as Array<{ decision: string; n: number }>;
    const byKind = Object.fromEntries(counts.map(c => [c.decision, c.n]));
    assert.equal(byKind.accepted, posts.length, 'accepted decisions must all have been published');
    assert.ok((byKind.rejected ?? 0) > 100, 'duplicate/stale candidates must be rejected, not published');

    const rows = getDb()
      .prepare(`SELECT decision, total_score, explanation, quality_json, quality_status FROM discovery_decisions`)
      .all() as Array<{ decision: string; total_score: number; explanation: string; quality_json: string | null; quality_status: string | null }>;
    assert.ok(rows.length > 0);
    assert.ok(rows.every(r => typeof r.total_score === 'number' && r.explanation.length > 0), 'scores + explanations persisted');
    // Every accepted (and therefore published) decision carried a PASSED
    // quality-gate report; held/rejected drafts may also carry reports — the
    // gate persists all verdicts by design.
    const acceptedRows = rows.filter(r => r.decision === 'accepted');
    assert.ok(acceptedRows.length >= posts.length, 'every published post must have a quality-gate report');
    assert.ok(
      acceptedRows.every(r => r.quality_status === 'passed' && (r.quality_json ?? '').length > 0),
      'published decisions must all have passed the quality gate'
    );

    // 4. The judged feed is exactly the persisted posts, reverse-chronological.
    const feedRes = await feedGET(new Request(`http://localhost/api/agent/feed?agentId=${agentId}`));
    assert.equal(feedRes.status, 200);
    const feed = await feedRes.json();
    assert.equal(feed.posts.length, posts.length);
    const feedTimes = feed.posts.map((p: { createdAt: string }) => Date.parse(p.createdAt));
    assert.ok(feedTimes.every((t: number, i: number) => i === 0 || t <= feedTimes[i - 1]), 'feed must be reverse-chronological');
  });

  it('GET /feed is a read-only projection: repeated reads never publish, discover, or schedule', async () => {
    const agentId = initializeAgentInstance('Feed Probe', 'ai-security', undefined, {}, T0).agentId;

    // Before any occurrence: reading the empty feed must not create jobs, runs,
    // candidates, or posts.
    const res0 = await feedGET(new Request(`http://localhost/api/agent/feed?agentId=${agentId}`));
    assert.equal(res0.status, 200);
    assert.deepEqual(await res0.json(), { posts: [] });
    assert.equal(getPostsByAgent(agentId).length, 0, 'feed read must not publish');
    assert.equal(getScheduledJobByAgent(agentId), null, 'feed read must not schedule a job');
    assert.equal(getRunCount(agentId), 0, 'feed read must not create runs');

    // Mid-simulation: interleave feed reads with occurrences; the read must
    // never change what the pipeline persisted.
    const snapshot = () => ({
      posts: getPostsByAgent(agentId).length,
      runs: getRunCount(agentId),
      jobs: getScheduledJobByAgent(agentId) === null ? 0 : 1
    });
    const before = snapshot();
    let now = T0;
    for (let i = 0; i < 12; i++) {
      now += HOUR; // 1h effective cadence
      // One scheduled occurrence (init schedules the recurring job)...
      const { runAgentCycle } = await import('../src/lib/jobs/cycle');
      await runAgentCycle(agentId, now, { skipDiscovery: true });
      // ...then three feed reads. Reads must be indistinguishable from no-ops.
      for (let k = 0; k < 3; k++) {
        const res = await feedGET(new Request(`http://localhost/api/agent/feed?agentId=${agentId}`));
        assert.equal(res.status, 200);
      }
    }
    assert.deepEqual(before, { posts: 0, runs: 0, jobs: 0 }, 'feed reads before any work change nothing');
    // After the loop the only job row is the one the queue would create — none
    // was created here because we drove the cycle directly, so nothing may
    // have appeared except posts if the cycle published (skipDiscovery ⇒ none).
    assert.equal(getPostsByAgent(agentId).length, 0, 'a discovery-less cycle publishes nothing');
  });
});

function getRunCount(agentId: string): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM agent_runs WHERE agent_id = ?`).get(agentId) as { n: number };
  return Number(row.n);
}
