import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-isolation-test-'));
process.env.AETHRA_DB_PATH = path.join(TMP_DIR, 'isolation.db');

import { initializeAgentInstance } from '../src/lib/agentEngine';
import { runEditorial } from '../src/lib/editorial/engine';
import { publishPublishablePosts } from '../src/lib/jobs/cycle';
import { makeCandidate } from '../src/lib/discovery/types';
import {
  closeDb,
  countAcceptedSinceMs,
  getAcceptedDecisionCandidates,
  getDb,
  getDiscoveryCandidates,
  getDiscoveryDecisions,
  getLatestAcceptedAtMs,
  getPendingDecisionCandidates,
  getPostsByAgent,
  getPublishableDecisions,
  getRecentMemoryEntries,
  hasPublishedCanonicalUrl,
  insertDiscoveryCandidate,
  markDecisionPublished
} from '../src/lib/db';
import { getEditorialStance, gatherMemoryItems } from '../src/lib/memory/memory';

after(() => {
  closeDb();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const T0 = 1_750_000_000_000;
const HOUR = 3600_000;
const DAY = 24 * 3600_000;
const NO_LIMITS = { routineIntervalMs: 0, dailyCap: 10_000 };

function newAgent(name: string, domain = 'ai-security'): string {
  return initializeAgentInstance(name, domain, undefined, {}, T0).agentId;
}

/** The global candidate pool is shared across agents (fetch-once). Each test
 *  clears it so its agents start from a known pending set. */
function clearPipeline(): void {
  getDb().exec('DELETE FROM discovery_decisions; DELETE FROM discovery_candidates; DELETE FROM discovery_fetches;');
}

function seedCandidate(title: string, canonicalUrl: string, opts: { summary?: string; publishedAt?: string } = {}): string {
  const candidate = makeCandidate({
    title,
    summary:
      opts.summary ??
      'A critical prompt injection bypass in the agent framework tool-calling layer escalates to remote code execution. Patch released. CVE-2026-42421 assigned.',
    publishedAt: opts.publishedAt ?? new Date(T0 - 2 * HOUR).toISOString(),
    canonicalUrl,
    sourceName: 'GitHub Security Advisories',
    sourceType: 'github-advisory',
    rawEvidence: JSON.stringify({ cve_id: 'CVE-2026-42421', ghsa_id: 'GHSA-isolation-1', severity: 'high' })
  });
  assert.ok(candidate);
  const inserted = insertDiscoveryCandidate(candidate, T0);
  assert.ok(inserted, `candidate must insert (unique URL): ${canonicalUrl}`);
  return candidate.id;
}

describe('per-agent isolation of the discovery/editorial pipeline', () => {
  it('fans out the shared candidate pool into independent per-agent decisions', async () => {
    const a = newAgent('Isolation A');
    const b = newAgent('Isolation B');
    const cid = seedCandidate('Critical prompt injection bypass in agent tool-calling layer', 'https://github.com/advisories/GHSA-isolation-fanout');

    // Both agents see the SAME global candidate (fetch-once, no per-agent copy).
    assert.deepEqual(
      getPendingDecisionCandidates(a, 50).map(c => c.id),
      getPendingDecisionCandidates(b, 50).map(c => c.id)
    );
    assert.ok(getPendingDecisionCandidates(a, 50).some(c => c.id === cid));

    // Each agent decides it independently: two rows, one per (agent, candidate).
    await runEditorial({ agentId: a, now: T0, ...NO_LIMITS });
    await runEditorial({ agentId: b, now: T0, ...NO_LIMITS });

    const decisionsA = getDiscoveryDecisions({ agentId: a, limit: 50 });
    const decisionsB = getDiscoveryDecisions({ agentId: b, limit: 50 });
    assert.equal(decisionsA.length, 1);
    assert.equal(decisionsB.length, 1);
    assert.equal(decisionsA[0].candidateId, cid);
    assert.equal(decisionsB[0].candidateId, cid);
    assert.equal(decisionsA[0].agentId, a);
    assert.equal(decisionsB[0].agentId, b);
    assert.notEqual(decisionsA[0].id, decisionsB[0].id, 'each agent owns its own decision row');
    assert.equal(decisionsA[0].decision, 'accepted');
    assert.equal(decisionsB[0].decision, 'accepted');

    // The pool itself stays shared — exactly one candidate row.
    assert.equal(getDiscoveryCandidates({ limit: 50 }).length, 1);
  });

  it('never lets one agent publish another agent\'s decision', async () => {
    clearPipeline();
    const a = newAgent('Isolation A2');
    const b = newAgent('Isolation B2');
    const cid = seedCandidate('Unauthenticated RCE in AI gateway deserialization path', 'https://github.com/advisories/GHSA-isolation-theft');
    await runEditorial({ agentId: a, now: T0, ...NO_LIMITS });

    // A's decision is gate-passed and publishable — for A only.
    const decisionA = getDiscoveryDecisions({ agentId: a, limit: 10 }).find(d => d.candidateId === cid);
    assert.ok(decisionA && decisionA.qualityStatus === 'passed');
    assert.equal(getPublishableDecisions(a, 10).length, 1);
    assert.equal(getPublishableDecisions(b, 10).length, 0, 'B sees none of A\'s decisions');

    // B attempting to publish A's decision: the ownership guard refuses it.
    assert.equal(
      markDecisionPublished(b, decisionA.id, 'post-by-b'),
      false,
      'B must not be able to mark A\'s decision as published'
    );
    assert.equal(publishPublishablePosts(b, T0), 0, 'B\'s publication pass publishes nothing of A\'s');
    assert.equal(getPostsByAgent(b).length, 0);

    // A's own cycle publishes it once; B's feed stays empty.
    assert.equal(publishPublishablePosts(a, T0), 1);
    assert.equal(getPostsByAgent(a).length, 1);
    assert.equal(getPostsByAgent(b).length, 0, 'no cross-agent post appears in B\'s feed');
    const afterA = getDiscoveryDecisions({ agentId: a, limit: 10 }).find(d => d.candidateId === cid);
    assert.ok(afterA && afterA.publishedPostId, 'A\'s decision is marked with its own post id');
  });

  it('keeps editorial memory strictly per agent (no leakage)', async () => {
    clearPipeline();
    const a = newAgent('Isolation A3');
    const b = newAgent('Isolation B3');
    seedCandidate('Agent sandbox vault bypass permits credential theft', 'https://github.com/advisories/GHSA-isolation-memory');
    await runEditorial({ agentId: a, now: T0, ...NO_LIMITS });

    // The accepted story became A's durable memory — not B's.
    assert.equal(getAcceptedDecisionCandidates(a).length, 1);
    assert.equal(getAcceptedDecisionCandidates(b).length, 0);
    assert.ok(getEditorialStance(a, 'Agent sandbox vault bypass permits credential theft'));
    assert.equal(getEditorialStance(b, 'Agent sandbox vault bypass permits credential theft'), null);

    const memoryA = getRecentMemoryEntries({ agentId: a, kinds: ['long_term', 'editorial'], limit: 50 });
    const memoryB = getRecentMemoryEntries({ agentId: b, kinds: ['long_term', 'editorial'], limit: 50 });
    assert.ok(memoryA.length >= 2, 'A recorded long-term + editorial memory');
    assert.equal(memoryB.length, 0, 'B has no memory rows at all');

    // The duplicate ladder's memory base is A's own accepted set (the exact
    // count includes A's accepted decision + its long-term/editorial entries;
    // the isolation proof is that B's set is empty).
    assert.ok(gatherMemoryItems(a, { source: 'decisions' }).length > 0);
    assert.equal(gatherMemoryItems(b, { source: 'decisions' }).length, 0);
  });

  it('isolates dedup scope and rate-limit counters per agent', async () => {
    clearPipeline();
    const a = newAgent('Isolation A4');
    const b = newAgent('Isolation B4');
    const urlA = 'https://github.com/advisories/GHSA-isolation-url-a';
    const cidA = seedCandidate('Critical prompt injection bypass in agent framework', urlA);
    await runEditorial({ agentId: a, now: T0, ...NO_LIMITS });
    assert.equal(publishPublishablePosts(a, T0), 1);

    // A's publication is invisible to B's dedup scope and rate-limit windows.
    assert.equal(hasPublishedCanonicalUrl(a, urlA), true);
    assert.equal(hasPublishedCanonicalUrl(b, urlA), false, 'B\'s dedup scope does not see A\'s post');
    assert.equal(getLatestAcceptedAtMs(a, T0 - DAY), T0);
    assert.equal(getLatestAcceptedAtMs(b, T0 - DAY), null);
    assert.equal(countAcceptedSinceMs(a, T0 - DAY), 1);
    assert.equal(countAcceptedSinceMs(b, T0 - DAY), 0);

    // B re-evaluates the SAME candidate independently: with per-agent dedup,
    // A's publication does not block B from accepting the same canonical URL.
    const urlB = 'https://github.com/advisories/GHSA-isolation-url-b';
    seedCandidate('Heap corruption in agent gateway deserialization layer', urlB);
    await runEditorial({ agentId: b, now: T0 + HOUR, ...NO_LIMITS });
    const bOnUrlA = getDiscoveryDecisions({ agentId: b, limit: 10 }).find(d => d.candidateId === cidA);
    assert.ok(bOnUrlA, 'B decides A\'s candidate too');
    assert.equal(bOnUrlA.decision, 'accepted');
    assert.doesNotMatch(bOnUrlA.explanation, /canonical URL already published/);
    assert.equal(publishPublishablePosts(b, T0 + HOUR), 2, 'B publishes both of its own decisions');
    assert.equal(getPostsByAgent(a).length, 1);
    assert.equal(getPostsByAgent(b).length, 2);
    assert.equal(getLatestAcceptedAtMs(b, T0 - DAY), T0 + HOUR);
    assert.equal(countAcceptedSinceMs(b, T0 - DAY), 2);
  });
});
