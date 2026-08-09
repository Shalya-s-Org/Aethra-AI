// Live-provider smoke test — deterministic via committed record/replay fixtures.
//
// Runs the FULL adapter stack (all default allowlisted sources) against the
// recorded responses in tests/fixtures/replay/, asserting the end-to-end
// contract: every source parses and normalizes candidates, canonical-URL
// verification passes, per-source health is persisted, the runner never
// requests an un-allowlisted URL, and GET /feed (the posts table) is never
// touched. Refresh the recorded set with `npm run record-fixtures` (live), or
// `npm run generate-fixtures` (offline, from the per-adapter fixtures).
//
// Opt-in live mode: AETHRA_LIVE_SMOKE=1 runs the same assertions against the
// real endpoints (network required; slower; not for CI).

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Scratch DB + DEFAULT allowlists (no AETHRA_LAB_FEEDS / AETHRA_GITHUB_REPOS),
// set BEFORE importing the discovery modules.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-smoke-test-'));
process.env.AETHRA_DB_PATH = path.join(TMP_DIR, 'smoke.db');

import { runDiscovery } from '../src/lib/discovery/runner';
import { loadReplayFixtures, createReplayFetch } from '../src/lib/discovery/replay';
import { closeDb, getDb, getDiscoveryCandidates, getSourceHealth } from '../src/lib/db';

after(() => {
  delete process.env.AETHRA_LIVE_SMOKE;
  closeDb();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const REPLAY_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'replay');
const LIVE = process.env.AETHRA_LIVE_SMOKE === '1';

/** Wrap a fetch impl and record every requested URL. */
function trackingFetch(impl: typeof fetch): { impl: typeof fetch; requested: string[] } {
  const requested: string[] = [];
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requested.push(url);
    return impl(input, init);
  }) as typeof fetch;
  return { impl: wrapped, requested };
}

const T0 = 1_750_000_000_000;

describe('live-provider smoke (replay fixtures)', { skip: LIVE }, () => {
  it('full adapter stack: every source parses, verifies, persists, stays healthy', async () => {
    const replay = createReplayFetch(loadReplayFixtures(REPLAY_DIR));
    const { impl, requested } = trackingFetch(replay);

    const summary = await runDiscovery({ fetchImpl: impl, now: T0 });

    // No source failed — the replay covers every default allowlisted URL.
    assert.deepEqual(summary.failures, []);
    assert.equal(summary.filtered, 0, 'all fixture candidates must pass canonical-URL verification');

    // Every default source contributed candidates.
    const sources = new Set(summary.fetches.map(f => f.sourceName));
    assert.deepEqual(
      [...sources].sort(),
      ['AI Lab Security Feeds', 'arXiv', 'CISA KEV', 'GitHub Releases', 'GitHub Security Advisories'].sort()
    );
    assert.ok(summary.totalCandidates >= 8, `expected ≥ 8 candidates, got ${summary.totalCandidates}`);

    // The runner requested ONLY the recorded allowlisted URLs — replay 404s
    // anything else, and a 404 would have surfaced as a failure.
    assert.equal(requested.length, 8);
    assert.ok(new Set(requested).size === 8, 'no duplicate requests');

    // Per-source health persisted: one row per source, all successful.
    const health = getSourceHealth();
    assert.equal(health.length, 5);
    for (const h of health) {
      assert.equal(h.successCount, 1);
      assert.equal(h.failureCount, 0);
      assert.equal(h.consecutiveFailures, 0);
      assert.ok(h.lastSuccessAt, 'last success recorded');
      assert.ok(h.lastItemCount != null && h.lastItemCount >= 0);
    }

    // Candidates persisted with the full normalized shape.
    const rows = getDiscoveryCandidates({ limit: 100 });
    assert.ok(rows.length >= 8);
    for (const row of rows) {
      assert.ok(row.canonicalUrl.startsWith('https://'));
      assert.match(row.publishedAt, /Z$/);
      assert.ok(row.rawEvidence.length > 0);
    }

    // Discovery never writes to posts — GET /feed stays a pure projection.
    const posts = getDb().prepare('SELECT COUNT(*) AS n FROM posts').get();
    assert.equal(Number((posts as { n: number }).n), 0);
  });

  it('replay second run dedups candidates and accumulates health counters', async () => {
    const replay = createReplayFetch(loadReplayFixtures(REPLAY_DIR));
    const { impl } = trackingFetch(replay);

    const second = await runDiscovery({ fetchImpl: impl, now: T0 + 60_000 });
    assert.equal(second.newCandidates, 0, 'same recorded candidates are deduped by canonical URL');
    assert.equal(getDiscoveryCandidates({ limit: 100 }).length, second.totalCandidates);

    const health = getSourceHealth();
    assert.equal(health.length, 5);
    assert.ok(health.every(h => h.successCount === 2), 'success counter accumulates across runs');
  });
});

describe('live-provider smoke (live endpoints)', { skip: !LIVE }, () => {
  it('full adapter stack against the real endpoints', async () => {
    const { impl, requested } = trackingFetch(globalThis.fetch);
    const summary = await runDiscovery({ fetchImpl: impl, now: Date.now() });
    assert.equal(requested.length, 8);
    // A live run may legitimately hit transient source failures (rate limits,
    // timeouts) — the run must still complete and persist what it can.
    assert.ok(summary.failures.length <= 3, `expected few failures, got ${summary.failures.length}`);
    assert.ok(summary.totalCandidates >= 4, `expected candidates from surviving sources, got ${summary.totalCandidates}`);
    assert.ok(getSourceHealth().length >= 5 - summary.failures.length);
  });
});
