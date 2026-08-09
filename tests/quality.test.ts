import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-quality-test-'));
process.env.AETHRA_DB_PATH = path.join(TMP_DIR, 'quality.db');

import { runEditorial } from '../src/lib/editorial/engine';
import { initializeAgentInstance } from '../src/lib/agentEngine';
import { makeCandidate, type SourceType } from '../src/lib/discovery/types';
import { getPersona } from '../src/lib/persona';
import { runQualityGate, type QualityGateInput } from '../src/lib/quality';
import { closeDb, getDiscoveryDecisions, insertDiscoveryCandidate } from '../src/lib/db';
import { gatherMemoryItems } from '../src/lib/memory/memory';
import type { LlmProvider, LlmProviderResult } from '../src/lib/llm/types';
import type { GeneratedPost } from '../src/lib/llm/types';

after(() => {
  closeDb();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const T0 = 1_750_000_000_000;
const HOUR = 3600_000;
const DAY = 25 * 3600_000;
const nowFor = (i: number): number => T0 + i * DAY;
const iso = (ms: number): string => new Date(ms).toISOString();
const NO_LIMITS = { routineIntervalMs: 0, dailyCap: 10_000 };

// The editorial pipeline is per-agent; one agent owns this file's state.
const AGENT_ID = initializeAgentInstance('Quality Test', 'ai-security').agentId;

const persona = getPersona(null);

const CANDIDATE = {
  title: 'Critical prompt injection vulnerability in agent framework allows remote code execution',
  summary:
    'A critical prompt injection bypass in the agent framework tool-calling layer escalates to remote code execution. Patch released. CVE-2026-99999 assigned.',
  canonicalUrl: 'https://github.com/advisories/GHSA-quality-0001',
  sourceName: 'GitHub Security Advisories',
  rawEvidence: JSON.stringify({
    cve_id: 'CVE-2026-99999',
    ghsa_id: 'GHSA-quality-0001',
    severity: 'high',
    summary: 'prompt injection remote code execution in agent framework'
  })
};

const FACT = 'Summary. A critical prompt injection bypass in the agent framework tool-calling layer escalates to remote code execution, tracked as CVE-2026-99999.';
const EXPLOIT = 'Exploitability. The disclosed details describe the attack surface; the available evidence does not include an independent public proof of concept.';
const BLAST = 'Blast radius. The affected component is exposed wherever the framework is deployed; the disclosed details do not quantify reach.';
const MITIGATION = 'Mitigations. The canonical advisory does not disclose a specific mitigation in the available evidence; operators should review the linked advisory for remediation guidance.';
const ARCH = 'Architectural implications. This finding reinforces isolating the affected component behind a trust boundary.';
const VIEW = 'Confidence. high confidence: this assessment is based solely on the canonical record and identifiers in the evidence.';
const RATIONALE =
  'Selected because prompt injection in agent tool-calling is a recurring security theme. It matters now because the advisory is recent. It fits the persona mission of evidence-bound analysis. It beat the competing candidates with the highest score.';

function draft(overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  return {
    title: CANDIDATE.title,
    text: [FACT, EXPLOIT, BLAST, MITIGATION, ARCH, VIEW].join(' '),
    rationale: RATIONALE,
    confidence: 90,
    citedUrls: [CANDIDATE.canonicalUrl],
    relatedPosts: [],
    ...overrides
  };
}

function input(overrides: Partial<QualityGateInput> = {}): QualityGateInput {
  return {
    persona,
    candidate: CANDIDATE,
    draft: draft(),
    recentTitles: [],
    recentOpenings: [],
    sourceQualityScore: 12,
    ...overrides
  };
}

function verdictOf(input: QualityGateInput): string {
  return runQualityGate(input).verdict;
}

describe('quality gate: reject cases (required checks)', () => {
  it('passes a clean evidence-bound draft', () => {
    const report = runQualityGate(input());
    assert.equal(report.verdict, 'pass');
    assert.equal(report.score, 1);
    assert.equal(report.reasons.length, 0);
  });

  it('rejects citations not present in the retrieved source evidence', () => {
    const g = input({ draft: draft({ citedUrls: ['https://evil.example.com/payload'] }) });
    assert.equal(verdictOf(g), 'reject');
    assert.ok(runQualityGate(g).reasons.some(r => /not in the retrieved source evidence/.test(r)));
  });

  it('rejects non-HTTPS or malformed URLs', () => {
    const g = input({ draft: draft({ citedUrls: ['http://insecure.example.com/page'] }) });
    assert.equal(verdictOf(g), 'reject');
  });

  it('rejects unsupported numerical claims (digits not in the evidence)', () => {
    const g = input({
      draft: draft({ text: draft().text.replace('CVE-2026-99999', 'a 97 percent reduction') })
    });
    assert.equal(verdictOf(g), 'reject');
    assert.ok(runQualityGate(g).reasons.some(r => /Unsupported numerical claims/.test(r)));
  });

  it('rejects unsupported claims with no identifier and no calibrated uncertainty', () => {
    const g = input({
      candidate: { ...CANDIDATE, summary: 'A widget had an issue.', rawEvidence: '{}' },
      draft: draft({
        text: 'Summary. A widget had an issue in production. Exploitability. The issue is reachable. Architectural implications. Isolate the widget. Confidence. The widget issue is real.'
      })
    });
    assert.equal(verdictOf(g), 'reject');
    assert.ok(runQualityGate(g).reasons.some(r => /Claims are unsupported/.test(r)));
  });

  it('rejects a title that repeats a recent post framing', () => {
    const g = input({
      recentTitles: ['Critical prompt injection vulnerability in agent framework allows remote code execution'],
      draft: draft()
    });
    assert.equal(verdictOf(g), 'reject');
  });

  it('rejects a boilerplate writer opening that repeats a recent post phrasing', () => {
    const boilerplate = 'In the rapidly evolving landscape of AI security, new disclosures demand attention.';
    const g = input({
      recentOpenings: [boilerplate],
      draft: draft({
        text: [boilerplate, FACT, EXPLOIT, BLAST, MITIGATION, ARCH, VIEW].join(' ')
      })
    });
    assert.equal(verdictOf(g), 'reject');
    assert.ok(runQualityGate(g).reasons.some(r => /Opening repeats/.test(r)));
  });

  it('passes an opening that quotes the candidate fact (not writer phrasing)', () => {
    const g = input({ recentOpenings: ['Summary. A critical prompt injection bypass in the agent framework tool-calling layer escalates to remote code execution.'] });
    assert.equal(verdictOf(g), 'pass');
  });

  it('rejects generic AI-marketing language', () => {
    const g = input({
      draft: draft({
        text: [FACT, 'This revolutionary paradigm shift will completely transform everything!', EXPLOIT, BLAST, MITIGATION, ARCH, VIEW].join(' ')
      })
    });
    assert.equal(verdictOf(g), 'reject');
  });

  it('rejects a draft with no concrete security/architecture recommendation', () => {
    // Analysis but no recommendation: no should/must verb aimed at a concrete
    // action anywhere in the draft.
    const noRecommendation = draft({
      text: [
        FACT,
        EXPLOIT,
        BLAST,
        'Mitigations. The canonical advisory does not disclose a specific mitigation.',
        'Architectural implications. This finding reinforces isolating the affected component behind a trust boundary.',
        VIEW
      ].join(' ')
    });
    const g = input({ draft: noRecommendation });
    assert.equal(verdictOf(g), 'reject');
    assert.ok(runQualityGate(g).reasons.some(r => /recommendation/.test(r)));
  });

  it('rejects a draft that urges action without naming a concrete action', () => {
    // No verb+action pair anywhere: the mitigation sentence names no action,
    // and the implication sentence urges care but no concrete action.
    const vague = draft({
      text: [
        FACT,
        EXPLOIT,
        BLAST,
        'Mitigations. The canonical advisory does not disclose a specific mitigation.',
        'Architectural implications. Operators should carefully evaluate the implications before proceeding.',
        VIEW
      ].join(' ')
    });
    assert.equal(verdictOf(input({ draft: vague })), 'reject');
  });

  it('passes a draft with a concrete recommendation', () => {
    const report = runQualityGate(input());
    const recommendation = report.checks.find(c => c.id === 'recommendation');
    assert.ok(recommendation, 'recommendation check must exist');
    assert.equal(recommendation.passed, true);
    assert.equal(report.verdict, 'pass');
  });

  it('rejects a second draft that repeats the same approved opening', () => {
    // Two drafts opening with the SAME approved-pattern phrasing: the second,
    // evaluated against the first's opening, must be rejected for repetition.
    const opening = 'Start with the fact: the disclosure is concrete and the fix is already shipping.';
    const g = input({
      recentOpenings: [opening],
      draft: draft({
        text: [opening, FACT, EXPLOIT, BLAST, MITIGATION, ARCH, VIEW].join(' ')
      })
    });
    assert.equal(verdictOf(g), 'reject');
    assert.ok(runQualityGate(g).reasons.some(r => /Opening repeats/.test(r)));
  });

  it('rejects a draft violating persona exclusions', () => {
    const g = input({
      draft: draft({ title: 'Celebrity gossip about prompt injection' })
    });
    assert.equal(verdictOf(g), 'reject');
  });

  it('rejects a draft whose structure is out of order', () => {
    const g = input({
      draft: draft({ text: [VIEW, FACT, EXPLOIT, BLAST, MITIGATION, ARCH].join(' ') })
    });
    assert.equal(verdictOf(g), 'reject');
    assert.ok(runQualityGate(g).reasons.some(r => /Structure is out of order/.test(r)));
  });
});

describe('quality gate: hold cases (polish checks)', () => {
  it('rejects a draft lacking the analysis stages (no concrete implication anywhere)', () => {
    // Fact + view only: no exploitability/blast-radius/mitigations/architectural
    // stage means the draft fails the structure check (and the implication
    // check) — it never reaches publication.
    const g = input({
      draft: draft({
        text: [FACT, 'Confidence. high confidence: this assessment is based solely on the canonical record and identifiers in the evidence.'].join(' ')
      })
    });
    const report = runQualityGate(g);
    assert.equal(report.verdict, 'reject');
    assert.ok(report.reasons.some(r => /Structure is out of order/.test(r)));
  });

  it('reports the concrete-implication check as passed for a full draft', () => {
    const report = runQualityGate(input());
    const implication = report.checks.find(c => c.id === 'implication');
    assert.ok(implication);
    assert.equal(implication!.passed, true);
  });

  it('holds a draft with low confidence', () => {
    const g = input({ draft: draft({ confidence: 40 }) });
    assert.equal(verdictOf(g), 'hold');
  });

  it('holds a draft exceeding the concise format', () => {
    const g = input({ draft: draft({ text: draft().text + ' x'.repeat(2200) }) });
    assert.equal(verdictOf(g), 'hold');
  });

  it('holds a draft that ignores relevant prior memory', () => {
    const g = input({
      followUp: { story: 'Earlier advisory on the same framework', relation: 'updates' },
      draft: draft({ relatedPosts: [] })
    });
    assert.equal(verdictOf(g), 'hold');
  });

  it('passes a draft that references the relevant prior story', () => {
    const g = input({
      followUp: { story: 'Earlier advisory on the same framework', relation: 'updates' },
      draft: draft({ relatedPosts: ['Earlier advisory on the same framework'] })
    });
    assert.equal(verdictOf(g), 'pass');
  });
});

function addStrongCandidate(title: string, canonicalUrl: string): string {
  const candidate = makeCandidate({
    title,
    summary:
      'A critical prompt injection bypass in the agent framework tool-calling layer escalates to remote code execution. Patch released. CVE-2026-99999 assigned. GHSA-aaaa-bbbb-cccc.',
    publishedAt: iso(T0 - HOUR),
    canonicalUrl,
    sourceName: 'GitHub Security Advisories',
    sourceType: 'github-advisory' as SourceType,
    rawEvidence: JSON.stringify({ cve_id: 'CVE-2026-99999', ghsa_id: 'GHSA-aaaa-bbbb-cccc', severity: 'high' })
  });
  assert.ok(candidate);
  const inserted = insertDiscoveryCandidate(candidate, T0);
  assert.ok(inserted, `candidate must insert: ${canonicalUrl}`);
  return candidate.id;
}

/** A provider that returns one schema-valid draft, but fails a chosen gate check. */
function draftProvider(post: GeneratedPost): LlmProvider {
  return {
    name: 'crafted',
    async complete(): Promise<LlmProviderResult> {
      return { ok: true, raw: JSON.stringify(post) };
    }
  };
}

/** A schema-valid engine draft that mirrors the ENGINE candidate's own title
 *  and canonical URL (as the local provider would). */
function engineDraft(
  candidate: { title: string; canonicalUrl: string },
  overrides: Partial<GeneratedPost> = {}
): GeneratedPost {
  return {
    title: candidate.title,
    text: [FACT, EXPLOIT, BLAST, MITIGATION, ARCH, VIEW].join(' '),
    rationale: RATIONALE,
    confidence: 90,
    citedUrls: [candidate.canonicalUrl],
    relatedPosts: [],
    ...overrides
  };
}

describe('editorial engine integration', () => {
  it('persists a passed gate verdict and the report for accepted decisions', async () => {
    const id = addStrongCandidate(
      'Critical prompt injection vulnerability in agent framework allows remote code execution',
      'https://github.com/advisories/GHSA-qlty-e2e-0001'
    );
    const run = await runEditorial({ agentId: AGENT_ID, now: nowFor(1), ...NO_LIMITS });
    const decision = run.decisions.find(d => d.candidateId === id);
    assert.ok(decision);
    assert.equal(decision!.kind, 'accepted');

    const row = getDiscoveryDecisions({ limit: 100 }).find(r => r.candidateId === id);
    assert.ok(row);
    assert.equal(row!.qualityStatus, 'passed');
    assert.ok(row!.qualityJson);
    const report = JSON.parse(row!.qualityJson!);
    assert.equal(report.verdict, 'pass');
    assert.equal(row!.title, 'Critical prompt injection vulnerability in agent framework allows remote code execution');
  });

  it('holds the decision when the gate holds the draft (retried next run)', async () => {
    const url = 'https://github.com/advisories/GHSA-qlty-e2e-0002';
    const title = 'Remote code execution in agent sandbox via crafted tool output';
    const id = addStrongCandidate(title, url);
    // Schema-valid and well-structured, but low confidence → polish-only hold.
    const weak = engineDraft({ title, canonicalUrl: url }, { confidence: 40 });
    const run = await runEditorial({ agentId: AGENT_ID,
      now: nowFor(2),
      ...NO_LIMITS,
      provider: draftProvider(weak)
    });
    const decision = run.decisions.find(d => d.candidateId === id);
    assert.ok(decision);
    assert.equal(decision!.kind, 'held');
    assert.match(decision!.explanation, /Quality gate held/);

    const row = getDiscoveryDecisions({ limit: 100 }).find(r => r.candidateId === id);
    assert.ok(row);
    assert.equal(row!.qualityStatus, 'held');
    assert.equal(row!.generationStatus, 'generated');

    // Next run with the clean default provider: the held candidate is retried
    // and passes the gate.
    const run2 = await runEditorial({ agentId: AGENT_ID, now: nowFor(3), ...NO_LIMITS });
    const decision2 = run2.decisions.find(d => d.candidateId === id);
    assert.ok(decision2);
    assert.equal(decision2!.kind, 'accepted');
  });

  it('rejects the decision when the gate rejects the draft, and skips memory', async () => {
    const url = 'https://github.com/advisories/GHSA-qlty-e2e-0003';
    const title = 'Sandbox escape in agent code interpreter grants host access';
    const id = addStrongCandidate(title, url);
    const marketing = engineDraft({ title, canonicalUrl: url }, {
      text: [
        'Summary. A critical prompt injection bypass in the agent framework tool-calling layer escalates to remote code execution, tracked as CVE-2026-99999.',
        'This revolutionary paradigm shift will completely transform everything!',
        'Exploitability. The disclosed details describe the attack surface.',
        'Blast radius. The affected component is exposed wherever the framework is deployed.',
        'Mitigations. The canonical advisory does not disclose a specific mitigation.',
        'Architectural implications. This finding reinforces isolating the affected component behind a trust boundary.',
        'Confidence. high confidence: this assessment is based solely on the canonical record.'
      ].join(' ')
    });
    const before = gatherMemoryItems(null);
    const run = await runEditorial({ agentId: AGENT_ID,
      now: nowFor(4),
      ...NO_LIMITS,
      provider: draftProvider(marketing)
    });
    const decision = run.decisions.find(d => d.candidateId === id);
    assert.ok(decision);
    assert.equal(decision!.kind, 'rejected');
    assert.match(decision!.explanation, /Quality gate rejected/);

    const row = getDiscoveryDecisions({ limit: 100 }).find(r => r.candidateId === id);
    assert.ok(row);
    assert.equal(row!.qualityStatus, 'rejected');
    const report = JSON.parse(row!.qualityJson!) as {
      verdict: string;
      reasons: string[];
    };
    assert.equal(report.verdict, 'reject');
    assert.ok(report.reasons.some(r => /marketing/i.test(r)));

    // No durable memory recorded for the gate-rejected candidate.
    const after = gatherMemoryItems(null);
    const subjectMatch = (items: typeof before) =>
      items.some(i => i.title.includes('sandbox escape in agent code interpreter'));
    assert.equal(subjectMatch(after), subjectMatch(before));
  });
});
