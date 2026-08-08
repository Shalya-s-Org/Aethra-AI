import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-editorial-test-'));
process.env.AETHRA_DB_PATH = path.join(TMP_DIR, 'editorial.db');

import { runEditorial } from '../src/lib/editorial/engine';
import { scoreCandidate } from '../src/lib/editorial/scoring';
import { makeCandidate, type SourceType } from '../src/lib/discovery/types';
import type { EditorialDecision } from '../src/lib/editorial/types';
import { initializeAgentInstance } from '../src/lib/agentEngine';
import {
  closeDb,
  getDiscoveryDecisions,
  insertDiscoveryCandidate,
  insertPost,
  upsertTopicRow
} from '../src/lib/db';

after(() => {
  closeDb();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

// Fixed reference time. Each test uses a now ~25h apart so daily/interval
// windows from earlier tests never leak into later ones.
const T0 = 1_750_000_000_000;
const DAY = 25 * 3600_000;
const nowFor = (i: number): number => T0 + i * DAY;
const iso = (ms: number): string => new Date(ms).toISOString();
const HOUR = 3600_000;

const NO_LIMITS = { routineIntervalMs: 0, dailyCap: 10_000 };

interface CandidateSeed {
  title: string;
  summary?: string;
  publishedAt?: string;
  canonicalUrl: string;
  sourceType: SourceType;
  rawEvidence?: string;
  sourceName?: string;
}

function addCandidate(seed: CandidateSeed): { id: string; title: string; canonicalUrl: string; publishedAt: string } {
  const candidate = makeCandidate({
    title: seed.title,
    summary: seed.summary ?? '',
    publishedAt: seed.publishedAt ?? iso(T0 - 2 * HOUR),
    canonicalUrl: seed.canonicalUrl,
    sourceName: seed.sourceName ?? 'Test Source',
    sourceType: seed.sourceType,
    rawEvidence: seed.rawEvidence ?? JSON.stringify({})
  });
  assert.ok(candidate, `candidate must normalize: ${seed.title}`);
  const inserted = insertDiscoveryCandidate(candidate, T0);
  assert.ok(inserted, `candidate must insert (unique URL): ${seed.canonicalUrl}`);
  return { id: candidate.id, title: candidate.title, canonicalUrl: candidate.canonicalUrl, publishedAt: candidate.publishedAt };
}

function decisionOf(summary: { decisions: EditorialDecision[] }, candidateId: string): EditorialDecision {
  const d = summary.decisions.find(x => x.candidateId === candidateId);
  assert.ok(d, `expected a decision for candidate ${candidateId}`);
  return d;
}

// A strong advisory: clears the publish threshold on its own.
const STRONG_BASE = {
  title: 'Critical prompt injection vulnerability in agent framework allows remote code execution',
  summary:
    'A critical prompt injection bypass in the agent framework tool-calling layer lets an attacker escalate to remote code execution. Proof of concept available. Affects versions below 2.0; patch released. CVE-2026-99999 assigned. GHSA-aaaa-bbbb-cccc.',
  sourceType: 'github-advisory' as SourceType,
  rawEvidence: JSON.stringify({ cve_id: 'CVE-2026-99999', ghsa_id: 'GHSA-aaaa-bbbb-cccc', severity: 'high', summary: 'prompt injection remote code execution' })
};

// Same, without a severity field: still ≥ 78, but NOT breaking-security so the
// routine interval/cap actually applies.
const STRONG_NO_SEV = {
  ...STRONG_BASE,
  rawEvidence: JSON.stringify({ cve_id: 'CVE-2026-99999', ghsa_id: 'GHSA-aaaa-bbbb-cccc', summary: 'prompt injection remote code execution' })
};

const MARKETING = {
  title: 'AI coin bot generator raises $50M funding round',
  summary: 'A consumer app that generates crypto coins raised millions in seed funding and launched on the app store.',
  sourceType: 'github-release' as SourceType,
  rawEvidence: JSON.stringify({ tag_name: 'v1.0.0', body: 'launch announcement' })
};

const MID = {
  title: 'Patch release fixing a security issue in websocket handler',
  summary: 'Fixed a denial of service in the websocket handler. No severity rating published yet. CVE-2026-55555 assigned.',
  sourceType: 'github-release' as SourceType,
  rawEvidence: JSON.stringify({ tag_name: 'v1.0.1', body: 'denial of service fix' })
};

const WEAK_KEV = {
  title: 'Widget product has a known issue affecting deployments',
  summary: 'A known exploited vulnerability in the widget product.',
  sourceType: 'cisa-kev' as SourceType,
  rawEvidence: JSON.stringify({ cveID: 'CVE-2026-31337', vendorProject: 'Widget Co', product: 'Widget', vulnerabilityName: 'Widget issue', dateAdded: '2026-08-01' })
};

describe('thresholds', () => {
  it('accepts ≥78, rejects <60, holds 60-77, with scores in the explanation', async () => {
    const strong = addCandidate({ ...STRONG_BASE, publishedAt: iso(T0 - 2 * HOUR), canonicalUrl: 'https://github.com/advisories/GHSA-thr-1' });
    const marketing = addCandidate({ ...MARKETING, publishedAt: iso(T0 - 2 * HOUR), canonicalUrl: 'https://example.com/coin-bot' });
    const mid = addCandidate({ ...MID, publishedAt: iso(T0 - 2 * HOUR), canonicalUrl: 'https://github.com/example/repo/releases/tag/v1.0.1' });

    const run = await runEditorial({ now: nowFor(1), ...NO_LIMITS });
    assert.equal(run.evaluated, 3);

    const s = decisionOf(run, strong.id);
    assert.equal(s.kind, 'accepted');
    assert.ok(s.totalScore >= 78, `expected >= 78, got ${s.totalScore}`);
    assert.match(s.explanation, /ACCEPTED \(\d+\/100\)/);
    assert.match(s.explanation, /persona relevance \d+\/20; technical impact \d+\/20; source quality \d+\/15; recency \d+\/15; novelty \d+\/15; discussion value \d+\/10; evidence confidence \d+\/5/);
    assert.match(s.explanation, /Reference: CVE-2026-99999/);
    assert.ok(!/override/i.test(s.explanation), 'a threshold-accepted item must not be labeled an override');

    const m = decisionOf(run, marketing.id);
    assert.equal(m.kind, 'rejected');
    assert.ok(m.totalScore < 60, `expected < 60, got ${m.totalScore}`);
    assert.match(m.explanation, /marketing/i);

    const midD = decisionOf(run, mid.id);
    assert.equal(midD.kind, 'held');
    assert.ok(midD.totalScore >= 60 && midD.totalScore < 78, `expected 60-77, got ${midD.totalScore}`);
    assert.match(midD.explanation, /held for review/);
  });
});

describe('duplicates', () => {
  it('rejects a candidate whose title duplicates an accepted one (memory)', async () => {
    addCandidate({ ...STRONG_BASE, publishedAt: iso(T0 - 2 * HOUR), canonicalUrl: 'https://github.com/advisories/GHSA-mem-1' });
    await runEditorial({ now: nowFor(1), ...NO_LIMITS });

    const dup = addCandidate({
      ...STRONG_BASE, // identical title
      canonicalUrl: 'https://example.com/reshared-copy'
    });
    const run = await runEditorial({ now: nowFor(2), ...NO_LIMITS });
    const d = decisionOf(run, dup.id);
    assert.equal(d.kind, 'rejected');
    assert.match(d.explanation, /Duplicate: title matches accepted candidate/);
    assert.equal(d.components.novelty, 0, 'novelty must be zero for a duplicate');
  });

  it('rejects the lower-scoring member of an in-batch duplicate pair', async () => {
    const title = 'RCE in agent plugin loader allows arbitrary code execution';
    const a = addCandidate({
      ...STRONG_BASE,
      title,
      summary: 'A critical deserialization bug in the agent plugin loader lets an attacker run arbitrary code. CVE-2026-42424, GHSA-bbbb-cccc-dddd. Severity high, patch out.',
      canonicalUrl: 'https://github.com/advisories/GHSA-batch-1',
      publishedAt: iso(T0 - 3 * HOUR)
    });
    const b = addCandidate({
      ...STRONG_BASE,
      title,
      summary: 'A critical deserialization bug in the agent plugin loader lets an attacker run arbitrary code. CVE-2026-42424, GHSA-bbbb-cccc-dddd.',
      canonicalUrl: 'https://example.com/second-copy',
      publishedAt: iso(T0 - 1 * HOUR),
      rawEvidence: JSON.stringify({ cve_id: 'CVE-2026-42424', ghsa_id: 'GHSA-bbbb-cccc-dddd', severity: 'medium' })
    });
    const run = await runEditorial({ now: nowFor(3), ...NO_LIMITS });
    const da = decisionOf(run, a.id);
    const db = decisionOf(run, b.id);
    assert.equal(da.kind, 'accepted');
    assert.equal(db.kind, 'rejected');
    assert.match(db.explanation, /Duplicate/);
  });

  it('rejects a candidate whose canonical URL an agent already published', async () => {
    // Seed an agent + a real published post whose topic carries this URL.
    const agent = initializeAgentInstance('URL Test', 'Robotics', undefined, undefined, T0);
    const topicId = upsertTopicRow({
      agentId: agent.agentId,
      title: 'Already published topic',
      canonicalSourceUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-77777',
      category: null,
      sourceName: null,
      credibilityScore: 90,
      trendScore: null,
      noveltyScore: 80,
      importanceScore: 90,
      confidenceScore: 90,
      recommendation: 'Accept',
      rejectionReason: null,
      detailedAnalysis: 'x',
      opinion: 'x',
      freshness: null,
      rawJson: '{}',
      createdAtMs: T0
    });
    insertPost({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FA1',
      agentId: agent.agentId,
      topicId,
      title: 'Already published topic',
      body: 'body',
      opinion: null,
      rationale: null,
      confidenceScore: 90,
      category: null,
      importanceScore: 90,
      noveltyScore: 80,
      publicationId: 'PUB-1',
      publishedAtMs: T0
    });

    const candidate = addCandidate({
      title: 'Same canonical source discovered later',
      summary: 'This candidate points at the same canonical URL an agent already published.',
      canonicalUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-77777',
      sourceType: 'cisa-kev',
      rawEvidence: JSON.stringify({ cveID: 'CVE-2026-77777' })
    });
    const run = await runEditorial({ now: nowFor(4), ...NO_LIMITS });
    const d = decisionOf(run, candidate.id);
    assert.equal(d.kind, 'rejected');
    assert.match(d.explanation, /Duplicate: canonical URL already published/);
  });
});

describe('recency', () => {
  it('rejects stale items (>30 days) and accepts fresh ones', async () => {
    const stale = addCandidate({
      ...STRONG_BASE,
      title: 'Stale entry: critical heap overflow in agent runtime',
      summary: 'A critical heap overflow in the agent runtime lets an attacker execute arbitrary code. CVE-2026-90909, GHSA-cccc-dddd-eeee, severity high, patch released.',
      canonicalUrl: 'https://github.com/advisories/GHSA-stale-1',
      publishedAt: iso(nowFor(5) - 45 * 24 * HOUR)
    });
    const fresh = addCandidate({
      ...STRONG_BASE,
      title: 'Fresh entry: critical heap overflow in agent runtime',
      summary: 'A critical heap overflow in the agent runtime lets an attacker execute arbitrary code. CVE-2026-90909, GHSA-cccc-dddd-eeee, severity high, patch released.',
      canonicalUrl: 'https://github.com/advisories/GHSA-fresh-1',
      publishedAt: iso(nowFor(5) - 2 * HOUR)
    });

    const run = await runEditorial({ now: nowFor(5), ...NO_LIMITS });
    const s = decisionOf(run, stale.id);
    assert.equal(s.kind, 'rejected');
    assert.match(s.explanation, /Stale: published \d+ days ago \(> 30 days\)/);
    assert.equal(s.components.recency, 0);

    const f = decisionOf(run, fresh.id);
    assert.equal(f.kind, 'accepted');
    assert.equal(f.components.recency, 15);
  });
});

describe('tie-breaks', () => {
  it('deterministically picks the older candidate when scores tie and only one slot is free', async () => {
    // Distinctive titles (no overlap with editorial memory) that differ in one
    // neutral word; the score comes from the shared strong summary, so both
    // candidates tie exactly.
    const older = addCandidate({
      ...STRONG_NO_SEV,
      title: 'Tool calling permits unauthorized model access in tie alpha',
      summary: STRONG_BASE.summary,
      canonicalUrl: 'https://github.com/advisories/GHSA-tie-1',
      publishedAt: iso(nowFor(6) - 3 * HOUR)
    });
    const newer = addCandidate({
      ...STRONG_NO_SEV,
      title: 'Tool calling permits unauthorized model access in tie beta',
      summary: STRONG_BASE.summary,
      canonicalUrl: 'https://github.com/advisories/GHSA-tie-2',
      publishedAt: iso(nowFor(6) - 1 * HOUR)
    });

    const opts = { now: nowFor(6), routineIntervalMs: HOUR, dailyCap: 10_000 };
    const run = await runEditorial(opts);
    const d1 = decisionOf(run, older.id);
    const d2 = decisionOf(run, newer.id);
    console.error('TIE-DEBUG d1:', d1.kind, d1.totalScore, '|', d1.explanation);
    console.error('TIE-DEBUG d2:', d2.kind, d2.totalScore, '|', d2.explanation);
    assert.equal(d1.totalScore, d2.totalScore, 'scores must tie');
    assert.equal(d1.kind, 'accepted', 'older candidate wins the slot');
    assert.equal(d2.kind, 'held');
    assert.match(d2.explanation, /Rate-limited: next routine slot/);

    // Re-running is idempotent: the held candidate stays held, and the DB has
    // exactly one row per candidate (upsert, never duplicate rows).
    const rerun = await runEditorial(opts);
    const r2 = decisionOf(rerun, newer.id);
    assert.equal(r2.kind, 'held');
    const rows = getDiscoveryDecisions({ limit: 100 });
    assert.equal(rows.filter(r => r.candidateId === older.id).length, 1);
    assert.equal(rows.filter(r => r.candidateId === newer.id).length, 1);
  });
});

describe('routine interval and daily cap', () => {
  it('holds a second strong candidate within the minimum interval', async () => {
    const first = addCandidate({
      ...STRONG_NO_SEV,
      title: 'Interval alpha: critical deserialization flaw in agent gateway',
      summary: STRONG_BASE.summary,
      canonicalUrl: 'https://github.com/advisories/GHSA-int-1',
      publishedAt: iso(nowFor(7) - 4 * HOUR)
    });
    const second = addCandidate({
      ...STRONG_NO_SEV,
      title: 'Interval beta: critical deserialization flaw in agent gateway',
      summary: STRONG_BASE.summary,
      canonicalUrl: 'https://github.com/advisories/GHSA-int-2',
      publishedAt: iso(nowFor(7) - 3 * HOUR)
    });

    const run = await runEditorial({ now: nowFor(7), routineIntervalMs: 2 * HOUR, dailyCap: 10_000 });
    assert.equal(decisionOf(run, first.id).kind, 'accepted');
    const d2 = decisionOf(run, second.id);
    assert.equal(d2.kind, 'held');
    assert.match(d2.explanation, /Rate-limited/);
  });

  it('enforces the daily cap', async () => {
    const seeds = [
      { title: 'Cap alpha: critical ssrf in model proxy', url: 'https://github.com/advisories/GHSA-cap-1', at: nowFor(8) - 5 * HOUR },
      { title: 'Cap beta: critical ssrf in model proxy', url: 'https://github.com/advisories/GHSA-cap-2', at: nowFor(8) - 4 * HOUR },
      { title: 'Cap gamma: critical ssrf in model proxy', url: 'https://github.com/advisories/GHSA-cap-3', at: nowFor(8) - 3 * HOUR }
    ].map(s =>
      addCandidate({
        ...STRONG_NO_SEV,
        title: s.title,
        summary: STRONG_BASE.summary,
        canonicalUrl: s.url,
        publishedAt: iso(s.at)
      })
    );

    const run = await runEditorial({ now: nowFor(8), routineIntervalMs: 0, dailyCap: 2 });
    assert.equal(decisionOf(run, seeds[0].id).kind, 'accepted');
    assert.equal(decisionOf(run, seeds[1].id).kind, 'accepted');
    const dc = decisionOf(run, seeds[2].id);
    assert.equal(dc.kind, 'held');
    assert.match(dc.explanation, /daily cap of 2/);
  });
});

describe('breaking-security override', () => {
  it('accepts a verified high-severity CISA KEV item despite a low score and a busy interval', async () => {
    // One routine post occupies the interval slot first.
    const routine = addCandidate({
      ...STRONG_NO_SEV,
      title: 'Routine post: critical agent framework flaw allows remote code execution',
      summary: STRONG_BASE.summary,
      canonicalUrl: 'https://github.com/advisories/GHSA-ovr-1',
      publishedAt: iso(nowFor(9) - 4 * HOUR)
    });
    const kev = addCandidate({
      ...WEAK_KEV,
      canonicalUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-31337',
      publishedAt: iso(nowFor(9) - 6 * HOUR)
    });

    const run = await runEditorial({ now: nowFor(9), routineIntervalMs: 6 * HOUR, dailyCap: 10_000 });
    assert.equal(decisionOf(run, routine.id).kind, 'accepted');

    const d = decisionOf(run, kev.id);
    console.error('KEV-DEBUG:', d.kind, d.totalScore, '|', d.explanation);
    assert.equal(d.kind, 'accepted', 'breaking override must accept despite low score + interval');
    assert.ok(d.totalScore < 78, `override must not depend on the threshold (score ${d.totalScore})`);
    assert.match(d.explanation, /Breaking-security override/);
  });

  it('does not override stale items', async () => {
    const staleKev = addCandidate({
      ...WEAK_KEV,
      title: 'Stale KEV entry: router product has a known issue',
      summary: 'A known exploited vulnerability in the router product.',
      publishedAt: iso(nowFor(10) - 40 * 24 * HOUR),
      canonicalUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-41414'
    });
    const run = await runEditorial({ now: nowFor(10), ...NO_LIMITS });
    const d = decisionOf(run, staleKev.id);
    assert.equal(d.kind, 'rejected');
    assert.match(d.explanation, /Stale/);
  });
});

describe('persistence and determinism', () => {
  it('persists every decision with all component columns', async () => {
    const c = addCandidate({
      title: 'Persist test: patch release fixing a denial of service in websocket handler',
      summary: MID.summary,
      sourceType: 'github-release',
      rawEvidence: MID.rawEvidence,
      canonicalUrl: 'https://github.com/example/repo/releases/tag/v1.0.2'
    });
    await runEditorial({ now: nowFor(11), ...NO_LIMITS });

    const rows = getDiscoveryDecisions({ limit: 100 });
    const row = rows.find(r => r.candidateId === c.id);
    assert.ok(row);
    assert.equal(row.decision, 'held');
    for (const key of ['totalScore', 'personaRelevance', 'technicalImpact', 'sourceQuality', 'recency', 'novelty', 'discussionValue', 'evidenceConfidence'] as const) {
      assert.equal(typeof row[key], 'number', `${key} must be persisted`);
    }
    assert.ok(row.explanation.length > 0);
    assert.match(row.decidedAt, /Z$/);

    // Components sum to the total (criteria maxima: 20+20+15+15+15+10+5 = 100).
    assert.equal(
      row.personaRelevance + row.technicalImpact + row.sourceQuality + row.recency + row.novelty + row.discussionValue + row.evidenceConfidence,
      row.totalScore
    );
    assert.ok(row.totalScore <= 100);
  });

  it('is fully deterministic: identical input → identical scores', () => {
    const candidate = makeCandidate({
      title: STRONG_BASE.title,
      summary: STRONG_BASE.summary,
      publishedAt: iso(T0 - 2 * HOUR),
      canonicalUrl: 'https://github.com/advisories/GHSA-det-1',
      sourceName: 'Test',
      sourceType: 'github-advisory',
      rawEvidence: STRONG_BASE.rawEvidence
    });
    assert.ok(candidate);
    const ctx = { now: T0, memoryTitles: [], corroborationCves: new Set<string>() };
    const first = scoreCandidate(candidate, ctx);
    const second = scoreCandidate(candidate, ctx);
    assert.deepEqual(first.components, second.components);
    assert.equal(first.total, second.total);
    // The seven criteria have exactly the required maxima (100 total).
    assert.equal(
      first.components.personaRelevance + first.components.technicalImpact + first.components.sourceQuality +
        first.components.recency + first.components.novelty + first.components.discussionValue + first.components.evidenceConfidence,
      first.total
    );
  });
});
