import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-diversity-test-'));
process.env.AETHRA_DB_PATH = path.join(TMP_DIR, 'diversity.db');

import { runEditorial } from '../src/lib/editorial/engine';
import { makeCandidate, type SourceType } from '../src/lib/discovery/types';
import type { EditorialDecision } from '../src/lib/editorial/types';
import { initializeAgentInstance } from '../src/lib/agentEngine';
import {
  closeDb,
  getDb,
  getSourceHealth,
  insertDiscoveryCandidate,
  insertPost,
  markDecisionPublished,
  upsertSourceHealth,
  upsertTopicRow
} from '../src/lib/db';
import { ulid } from '../src/lib/ids';

after(() => {
  closeDb();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const T0 = 1_750_000_000_000;
const HOUR = 3600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

// discovery_candidates is a GLOBAL pool (canonical URL unique across agents)
// that fans out to every new agent's pending queue — so each test also wipes
// the pool, otherwise earlier tests' candidates flood later tests' runs.
// (decisions cascade with their candidates via the FK.)
function clearCandidates(): void {
  getDb().prepare('DELETE FROM discovery_candidates').run();
}

// Every test gets a FRESH agent (per-agent memory/decisions) AND a clean
// candidate pool, so no state leaks between tests.
function freshAgent(): string {
  clearCandidates();
  return initializeAgentInstance('Diversity Test', 'ai-security').agentId;
}

const NO_LIMITS = { routineIntervalMs: 0, dailyCap: 10_000 };

// discovery_candidates is GLOBAL (canonical URL unique across all agents), so
// every candidate in this file needs a globally unique URL even though each
// test uses its own agent.
let urlSeq = 0;
const uniqUrl = (slug: string): string => {
  urlSeq += 1;
  return slug.replace('SEQ', String(urlSeq));
};

interface Seed {
  title: string;
  summary: string;
  cve: string;
  canonicalUrl: string;
  sourceType: SourceType;
  severity?: string;
  sourceName?: string;
}

function addCandidate(agentId: string, seed: Seed): { id: string; title: string } {
  const candidate = makeCandidate({
    title: seed.title,
    summary: seed.summary,
    publishedAt: iso(T0 - 2 * HOUR),
    canonicalUrl: seed.canonicalUrl,
    sourceName: seed.sourceName ?? 'Test Source',
    sourceType: seed.sourceType,
    rawEvidence: JSON.stringify({
      cve_id: seed.cve,
      severity: seed.severity, // undefined → field omitted (not breaking-security)
      summary: seed.title
    })
  });
  assert.ok(candidate, `candidate must normalize: ${seed.title}`);
  assert.ok(insertDiscoveryCandidate(candidate, T0), `candidate must insert: ${seed.canonicalUrl}`);
  return { id: candidate.id, title: candidate.title };
}

function decisionOf(summary: { decisions: EditorialDecision[] }, candidateId: string): EditorialDecision {
  const d = summary.decisions.find(x => x.candidateId === candidateId);
  assert.ok(d, `expected a decision for candidate ${candidateId}`);
  return d;
}

/** Publish an accepted decision the way the cycle does (post + ownership-guarded link). */
function publishAccepted(agentId: string, now: number, decision: EditorialDecision, title: string): void {
  const postId = ulid(now);
  const topicId = upsertTopicRow({
    agentId,
    title,
    canonicalSourceUrl: `canon:${decision.candidateId}`,
    category: null,
    sourceName: null,
    credibilityScore: null,
    trendScore: null,
    noveltyScore: null,
    importanceScore: decision.totalScore,
    confidenceScore: decision.totalScore,
    recommendation: 'Accept',
    rejectionReason: null,
    detailedAnalysis: title,
    opinion: null,
    freshness: null,
    rawJson: JSON.stringify({ test: true }),
    createdAtMs: now
  });
  insertPost({
    id: postId,
    agentId,
    topicId,
    title,
    body: title,
    opinion: null,
    rationale: decision.explanation,
    confidenceScore: decision.totalScore,
    category: 'test',
    importanceScore: decision.totalScore,
    noveltyScore: null,
    publicationId: `PUB-TEST-${String(now).slice(-6)}`,
    publishedAtMs: now
  });
  assert.equal(markDecisionPublished(agentId, decision.id, postId), true);
}

const ADVISORY = (i: number): Seed => ({
  title: [
    'Deserialization flaw in the checkpoint loader allows remote code execution',
    'Server-side request forgery in the model proxy gateway exposes internal metadata',
    'Prompt injection in the tool dispatcher leaks credentials to untrusted plugins',
    'Sandbox escape in the code interpreter grants host filesystem access',
    'Insecure deserialization in the vector store client executes arbitrary commands',
    'Authentication bypass in the agent control plane allows session hijacking'
  ][i],
  summary:
    'A critical vulnerability in an AI deployment stack is now patched. Proof of concept available; ' +
    'exploitation requires no authentication. Update before it is weaponized in the wild.',
  cve: `CVE-2026-70${String(i).padStart(2, '0')}1`,
  canonicalUrl: uniqUrl(`https://github.com/advisories/GHSA-diversity-${i}-SEQ`),
  sourceType: 'github-advisory',
  sourceName: 'GitHub Security Advisories'
});

describe('source diversity rules', () => {
  it('intake cap: one flooding source type cannot starve the queue', async () => {
    const agentId = freshAgent();
    // 6 candidates from one source type + 2 from another; cap of 3 per type.
    const advisory = Array.from({ length: 6 }, (_, i) => ADVISORY(i));
    const arxiv: Seed[] = [
      {
        title: 'Novel jailbreak spanning tool-calling turns',
        summary: 'A new attack composes multiple tool-calling turns to bypass safety filters across models.',
        cve: 'CVE-2026-70901',
        canonicalUrl: uniqUrl('https://arxiv.org/abs/2608.91001-SEQ'),
        sourceType: 'arxiv',
        sourceName: 'arXiv'
      },
      {
        title: 'Red-teaming guardrail robustness at scale',
        summary: 'An empirical study of suffix and multi-turn attacks against popular guardrail stacks.',
        cve: 'CVE-2026-70902',
        canonicalUrl: uniqUrl('https://arxiv.org/abs/2608.91002-SEQ'),
        sourceType: 'arxiv',
        sourceName: 'arXiv'
      }
    ];
    const seeded = [...advisory, ...arxiv].map(a => addCandidate(agentId, a));

    const run = await runEditorial({ agentId, now: T0, ...NO_LIMITS, maxPerSourceType: 3 });

    // Only 3 of the 6 advisory candidates were evaluated; BOTH arXiv papers were.
    assert.equal(run.evaluated, 5, '3 advisory + 2 arxiv');
    const arxivIds = seeded.slice(6).map(s => s.id);
    for (const id of arxivIds) decisionOf(run, id);
    const advisoryIds = seeded.slice(0, 6).map(s => s.id);
    const evaluatedAdvisory = advisoryIds.filter(id => run.decisions.some(d => d.candidateId === id));
    assert.equal(evaluatedAdvisory.length, 3);
  });

  it('rolling publication cap: one source type cannot dominate the feed', async () => {
    const agentId = freshAgent();
  // Two published posts from github-advisory, then a third same-type
  // candidate: the third is held by the feed-diversity rule. ADVISORY seeds
  // carry NO severity field, so they are routine (not breaking-security) and
  // the diversity rule actually applies.
  const first = addCandidate(agentId, ADVISORY(0));
  const second = addCandidate(agentId, ADVISORY(1));

  const run1 = await runEditorial({ agentId, now: T0 + HOUR, ...NO_LIMITS, diversityMaxPostsPerType: 2 });
    const d1 = decisionOf(run1, first.id);
    const d2 = decisionOf(run1, second.id);
    assert.equal(d1.kind, 'accepted');
    assert.equal(d2.kind, 'accepted');
    publishAccepted(agentId, T0 + HOUR + 1, d1, first.title);
    publishAccepted(agentId, T0 + HOUR + 2, d2, second.title);

    const third = addCandidate(agentId, ADVISORY(2));
    const run2 = await runEditorial({ agentId, now: T0 + 2 * HOUR, ...NO_LIMITS, diversityMaxPostsPerType: 2 });
    const d3 = decisionOf(run2, third.id);
    assert.equal(d3.kind, 'held');
    assert.match(d3.explanation, /Feed-diversity: source type github-advisory already has 2 post/);
  });

  it('breaking-security overrides are exempt from the diversity rule', async () => {
    const agentId = freshAgent();
    const kev = (i: number, cve: string, title: string): Seed => ({
      title,
      summary: 'A known-exploited vulnerability with a required action. Apply vendor updates immediately.',
      cve,
      canonicalUrl: uniqUrl(`https://nvd.nist.gov/vuln/detail/${cve}-SEQ`),
      sourceType: 'cisa-kev',
      sourceName: 'CISA KEV'
    });
    // Two published CISA KEV posts already; a NEW verified KEV entry still
    // publishes (override-exempt), so a real emergency is never diversity-held.
    const routine1 = addCandidate(agentId, kev(0, 'CVE-2026-71001', 'Exploited flaw in edge router firmware'));
    const routine2 = addCandidate(agentId, kev(1, 'CVE-2026-71002', 'Exploited flaw in VPN gateway appliance'));
    const r1 = await runEditorial({ agentId, now: T0 + 3 * HOUR, ...NO_LIMITS, diversityMaxPostsPerType: 2 });
    publishAccepted(agentId, T0 + 3 * HOUR + 1, decisionOf(r1, routine1.id), routine1.title);
    publishAccepted(agentId, T0 + 3 * HOUR + 2, decisionOf(r1, routine2.id), routine2.title);

    const breaking = addCandidate(agentId, kev(2, 'CVE-2026-71003', 'Actively exploited critical RCE in edge gateway'));
    const r2 = await runEditorial({ agentId, now: T0 + 4 * HOUR, ...NO_LIMITS, diversityMaxPostsPerType: 2 });
    assert.equal(decisionOf(r2, breaking.id).kind, 'accepted');
  });
});

describe('high-impact claims require corroboration or a primary advisory', () => {
  it('holds a secondary-source claim of a critical CVE until corroborated', async () => {
    const agentId = freshAgent();
    // An arXiv paper claiming a CRITICAL CVE with explicit severity — strong
    // enough to clear the publish threshold, but from a secondary source.
    const paper = addCandidate(agentId, {
      title: 'Weaponized prompt injection chain in popular agent runtime',
      summary:
        'Our exploit chains a prompt injection and a deserialization primitive for pre-auth remote code execution in a widely deployed agent runtime.',
      cve: 'CVE-2026-72001',
      canonicalUrl: uniqUrl('https://arxiv.org/abs/2608.92001-SEQ'),
      sourceType: 'arxiv',
      sourceName: 'arXiv',
      severity: 'critical'
    });
    const run = await runEditorial({ agentId, now: T0 + 5 * HOUR, ...NO_LIMITS });
    const d = decisionOf(run, paper.id);
    assert.equal(d.kind, 'held');
    assert.match(d.explanation, /High-impact claim \(CVE-2026-72001\).*without corroboration/);
  });

  it('accepts the same claim once a primary advisory corroborates it in-batch', async () => {
    const agentId = freshAgent();
    const paper = addCandidate(agentId, {
      title: 'Weaponized prompt injection chain in popular agent runtime (round 2)',
      summary:
        'Our exploit chains a prompt injection and a deserialization primitive for pre-auth remote code execution in a widely deployed agent runtime.',
      cve: 'CVE-2026-72002',
      canonicalUrl: uniqUrl('https://arxiv.org/abs/2608.92002-SEQ'),
      sourceType: 'arxiv',
      sourceName: 'arXiv',
      severity: 'critical'
    });
    // Same CVE now appears in a CISA KEV entry — the arXiv paper is
    // corroborated in-batch and may publish if it clears the threshold.
    addCandidate(agentId, {
      title: 'Known exploited command injection in the same agent runtime',
      summary: 'CISA added this actively exploited vulnerability to the KEV catalog; required action is to patch.',
      cve: 'CVE-2026-72002',
      canonicalUrl: uniqUrl('https://nvd.nist.gov/vuln/detail/CVE-2026-72002-SEQ'),
      sourceType: 'cisa-kev',
      sourceName: 'CISA KEV'
    });
    const run = await runEditorial({ agentId, now: T0 + 6 * HOUR, ...NO_LIMITS });
    const d = decisionOf(run, paper.id);
    assert.equal(d.kind, 'accepted', 'corroborated claim may publish');
  });
});

describe('stale-source quality cap', () => {
  it('caps source-quality credit for candidates from a stale source', async () => {
    const agentId = freshAgent();
    // Mark GitHub Security Advisories stale in persisted source health.
    upsertSourceHealth({
      sourceName: 'GitHub Security Advisories',
      sourceType: 'github-advisory',
      url: 'https://api.github.com/advisories',
      succeeded: true,
      error: null,
      itemCount: 1,
      updatedAtMs: T0 - 20 * 24 * 3600_000 // last success 20 days ago
    });

    const candidate = addCandidate(agentId, ADVISORY(3));
    const run = await runEditorial({ agentId, now: T0 + 7 * HOUR, ...NO_LIMITS });
    const d = decisionOf(run, candidate.id);
    assert.equal(d.components.sourceQuality, 10, 'capped below the 11-point base for a healthy source');
    assert.match(d.explanation, /stale or down/);
  });
});

describe('health counters', () => {
  it('consecutive failures accumulate and reset on success', async () => {
    upsertSourceHealth({ sourceName: 'arXiv', sourceType: 'arxiv', url: 'https://export.arxiv.org/api/query', succeeded: false, error: 'HTTP 500', itemCount: 0, updatedAtMs: T0 });
    upsertSourceHealth({ sourceName: 'arXiv', sourceType: 'arxiv', url: 'https://export.arxiv.org/api/query', succeeded: false, error: 'HTTP 500', itemCount: 0, updatedAtMs: T0 + HOUR });
    upsertSourceHealth({ sourceName: 'arXiv', sourceType: 'arxiv', url: 'https://export.arxiv.org/api/query', succeeded: true, error: null, itemCount: 3, updatedAtMs: T0 + 2 * HOUR });

    const health = getSourceHealth().find(h => h.sourceName === 'arXiv');
    assert.ok(health);
    assert.equal(health.failureCount, 2);
    assert.equal(health.consecutiveFailures, 0, 'reset after a success');
    assert.equal(health.successCount, 1);
    assert.equal(health.lastItemCount, 3);
  });
});
