import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-llm-test-'));
process.env.AETHRA_DB_PATH = path.join(TMP_DIR, 'llm.db');

import { runEditorial } from '../src/lib/editorial/engine';
import { makeCandidate, type SourceType } from '../src/lib/discovery/types';
import { getPersona } from '../src/lib/persona';
import { buildGenerationPrompt } from '../src/lib/persona/prompt';
import {
  generatePost,
  repairJsonString,
  validateGeneratedPost,
  FailingProvider,
  type GenerationContext,
  type LlmProvider,
  type LlmProviderResult
} from '../src/lib/llm';
import type { GeneratedPost } from '../src/lib/llm/types';
import { closeDb, getDiscoveryDecisions, insertDiscoveryCandidate } from '../src/lib/db';
import { gatherMemoryItems } from '../src/lib/memory/memory';

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

const persona = getPersona(null);

const CANDIDATE = {
  title: 'Critical prompt injection vulnerability in agent framework allows remote code execution',
  summary:
    'A critical prompt injection bypass in the agent framework tool-calling layer lets an attacker escalate to remote code execution. Affects versions below 2.0; patch released. CVE-2026-99999 assigned.',
  canonicalUrl: 'https://github.com/advisories/GHSA-llm-test-0001',
  sourceName: 'GitHub Security Advisories',
  rawEvidence: JSON.stringify({
    cve_id: 'CVE-2026-99999',
    ghsa_id: 'GHSA-llm-test-0001',
    severity: 'high',
    summary: 'prompt injection remote code execution in agent framework'
  })
};

function ctx(overrides: Partial<GenerationContext> = {}): GenerationContext {
  return {
    persona,
    candidate: CANDIDATE,
    allowedUrls: [CANDIDATE.canonicalUrl],
    allowedNumbers: new Set(['2026', '99999', '2', '0']),
    knownRelated: [],
    ...overrides
  };
}

const POST_TEXT =
  'Summary. The candidate describes a prompt injection bypass in the agent framework tool-calling layer that escalates to remote code execution, tracked as CVE-2026-99999. ' +
  'Exploitability. The disclosed details describe the attack surface; the available evidence does not include an independent public proof of concept. ' +
  'Blast radius. The affected component is exposed wherever the framework is deployed; the disclosed details do not quantify reach. ' +
  'Mitigations. The canonical advisory does not disclose a specific mitigation in the available evidence; operators should review the linked advisory for remediation guidance. ' +
  'Architectural implications. This finding reinforces isolating the affected component behind a trust boundary. ' +
  'Confidence. high confidence: this assessment is based solely on the canonical record.';

const POST_RATIONALE =
  'Selected because prompt injection in agent tool-calling is a recurring security theme. ' +
  'It matters now because the advisory is recent and the issue is actively being exploited. ' +
  'It fits the persona mission of evidence-bound analysis. ' +
  'It beat 2 competing candidates with the highest score.';

/** A schema-valid generated post, built strictly from the trusted context. */
function validPost(): string {
  return `{
  "title": "${CANDIDATE.title}",
  "text": "${POST_TEXT}",
  "rationale": "${POST_RATIONALE}",
  "confidence": 90,
  "citedUrls": ["${CANDIDATE.canonicalUrl}"],
  "relatedPosts": []
}`;
}

describe('schema validation', () => {
  it('accepts a fully valid post and trims fields', () => {
    const result = validateGeneratedPost(validPost(), ctx());
    assert.ok(result.ok, result.ok ? '' : result.errors.join('; '));
    if (!result.ok) return;
    assert.equal(result.post.title, CANDIDATE.title);
    assert.equal(result.post.citedUrls[0], CANDIDATE.canonicalUrl);
  });

  it('rejects fabricated citations not in the trusted source set', () => {
    const raw = validPost().replace(CANDIDATE.canonicalUrl, 'https://evil.example.com/payload');
    const result = validateGeneratedPost(raw, ctx());
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => /fabricated citation/.test(e)));
  });

  it('rejects unsupported numerical claims (digits not in the evidence)', () => {
    const raw = validPost().replace('CVE-2026-99999', 'a 97 percent reduction');
    const result = validateGeneratedPost(raw, ctx());
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => /Unsupported numerical claim: "97"/.test(e)));
  });

  it('rejects references to unknown related posts', () => {
    const raw = validPost().replace('"relatedPosts": []', '"relatedPosts": ["A post that never existed"]');
    const result = validateGeneratedPost(raw, ctx());
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => /fabricated reference/.test(e)));
  });

  it('rejects a rationale missing the required markers', () => {
    const raw = validPost().replace(
      /Selected because .*?score\./,
      'This paragraph explains the reasoning behind the decision at considerable length, describing the background of the item and the surrounding circumstances with great care and precision.'
    );
    const result = validateGeneratedPost(raw, ctx());
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => /rationale must explain/.test(e)));
  });

  it('rejects non-object / short-text / out-of-range outputs', () => {
    assert.ok(!validateGeneratedPost('"just a string"', ctx()).ok);
    const short = validPost().replace(/Summary\..*?record\./, 'tiny');
    const result = validateGeneratedPost(short, ctx());
    assert.ok(!result.ok);
    assert.ok(result.errors.some(e => /at least 300/.test(e)));
  });
});

describe('repair path', () => {
  it('repairs trailing commas', () => {
    const broken = validPost().replace(/"relatedPosts": \[\]/, '"relatedPosts": [],');
    assert.equal(repairJsonString(broken), broken.replace(/,\s*([}\]])/g, '$1'));
    assert.ok(validateGeneratedPost(repairJsonString(broken)!, ctx()).ok);
  });

  it('strips markdown fences and surrounding prose', () => {
    const raw = 'Here is the JSON:\n```json\n' + validPost() + '\n```\nThanks!';
    const repaired = repairJsonString(raw);
    assert.ok(repaired);
    assert.ok(validateGeneratedPost(repaired, ctx()).ok);
  });

  it('returns null when no repair helps', () => {
    assert.equal(repairJsonString('definitely not json'), null);
  });
});

describe('local deterministic provider', () => {
  it('produces schema-valid output with citations and numbers drawn only from evidence', async () => {
    const outcome = await generatePost({
      persona,
      candidate: CANDIDATE,
      themes: ['prompt injection'],
      competing: [
        { title: CANDIDATE.title, score: 86, kind: 'accepted' },
        { title: 'Another candidate', score: 40, kind: 'rejected' }
      ]
    });
    assert.ok(outcome.ok, outcome.ok ? '' : outcome.error);
    if (!outcome.ok) return;
    assert.equal(outcome.post.title, CANDIDATE.title);
    assert.deepEqual(outcome.post.citedUrls, [CANDIDATE.canonicalUrl]);
    assert.equal(outcome.post.relatedPosts.length, 0);
    // Every digit in the generated text comes from the evidence corpus.
    const allowed = new Set(['2026', '99999', '2', '0']);
    for (const token of outcome.post.text.match(/\d+/g) ?? []) {
      assert.ok(allowed.has(token), `unexpected number token "${token}" in generated text`);
    }
  });

  it('echoes the follow-up story as a related-post reference', async () => {
    const outcome = await generatePost({
      persona,
      candidate: CANDIDATE,
      followUp: { story: 'Earlier advisory on the same framework', relation: 'updates' },
      themes: [],
      competing: []
    });
    assert.ok(outcome.ok, outcome.ok ? '' : outcome.error);
    if (!outcome.ok) return;
    assert.deepEqual(outcome.post.relatedPosts, ['Earlier advisory on the same framework']);
  });

  it('is deterministic: identical input yields identical output', async () => {
    const a = await generatePost({ persona, candidate: CANDIDATE, themes: [], competing: [] });
    const b = await generatePost({ persona, candidate: CANDIDATE, themes: [], competing: [] });
    assert.ok(a.ok && b.ok);
    if (!(a.ok && b.ok)) return;
    assert.equal(a.raw, b.raw);
  });

  it('reports a transport failure without retrying', async () => {
    const failing = new FailingProvider('boom');
    const outcome = await generatePost({ persona, candidate: CANDIDATE, themes: [], competing: [], provider: failing });
    assert.ok(!outcome.ok);
    assert.match(outcome.error, /Provider error: boom/);
  });
});

class RetryThenSuccessProvider implements LlmProvider {
  readonly name = 'retry-then-success';
  calls = 0;
  /** First output is schema-invalid (fabricated citation); second is valid. */
  async complete(): Promise<LlmProviderResult> {
    this.calls += 1;
    if (this.calls === 1) {
      return { ok: true, raw: validPost().replace(CANDIDATE.canonicalUrl, 'https://evil.example.com/payload') };
    }
    return { ok: true, raw: validPost() };
  }
}

class GarbageProvider implements LlmProvider {
  readonly name = 'garbage';
  calls = 0;
  async complete(): Promise<LlmProviderResult> {
    this.calls += 1;
    return { ok: true, raw: '{"title":"fake","text":"short"}' };
  }
}

describe('corrective retry', () => {
  it('retries once with corrective feedback after a validation failure, then succeeds', async () => {
    const provider = new RetryThenSuccessProvider();
    const outcome = await generatePost({
      persona,
      candidate: CANDIDATE,
      themes: [],
      competing: [],
      provider
    });
    assert.ok(outcome.ok, outcome.ok ? '' : outcome.error);
    assert.equal(provider.calls, 2);
  });

  it('fails without publishing when output never validates', async () => {
    const provider = new GarbageProvider();
    const outcome = await generatePost({
      persona,
      candidate: CANDIDATE,
      themes: [],
      competing: [],
      provider
    });
    assert.ok(!outcome.ok);
    assert.match(outcome.error, /failed schema validation after 2 attempt/);
    assert.equal(provider.calls, 2);
  });
});

describe('prompt construction', () => {
  it('labels evidence as untrusted data and never as instructions', () => {
    const { system, user } = buildGenerationPrompt(persona, {
      candidate: CANDIDATE,
      themes: ['prompt injection'],
      competing: []
    });
    assert.match(system, /untrusted DATA/);
    assert.match(user, /Evidence \(untrusted DATA/);
    // A prompt-injection attempt inside the evidence must not become a directive.
    assert.ok(!/ignore previous/.test(system));
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

describe('editorial engine integration', () => {
  it('persists schema-validated generated output for accepted decisions', async () => {
    const id = addStrongCandidate(
      'Critical prompt injection vulnerability in agent framework allows remote code execution',
      'https://github.com/advisories/GHSA-llm-e2e-0001'
    );
    const run = await runEditorial({ now: nowFor(1), ...NO_LIMITS });
    const decision = run.decisions.find(d => d.candidateId === id);
    assert.ok(decision, 'expected an accepted decision');
    assert.equal(decision!.kind, 'accepted');

    const row = getDiscoveryDecisions({ limit: 100 }).find(r => r.candidateId === id);
    assert.ok(row);
    assert.equal(row!.generationStatus, 'generated');
    assert.ok(row!.generatedJson);
    const post = JSON.parse(row!.generatedJson!) as GeneratedPost;
    assert.equal(post.title, 'Critical prompt injection vulnerability in agent framework allows remote code execution');
    assert.ok(post.text.length >= 300);
    assert.ok(post.rationale.length >= 80);
  });

  it('flips accepted to rejected when generation fails, records the failure, and skips memory', async () => {
    const id = addStrongCandidate(
      'Remote code execution in agent sandbox via crafted tool output',
      'https://github.com/advisories/GHSA-llm-e2e-0002'
    );
    const before = gatherMemoryItems(null);
    const run = await runEditorial({
      now: nowFor(2),
      ...NO_LIMITS,
      provider: new GarbageProvider()
    });
    const decision = run.decisions.find(d => d.candidateId === id);
    assert.ok(decision);
    assert.equal(decision!.kind, 'rejected');
    assert.match(decision!.explanation, /Generation failed/);

    const row = getDiscoveryDecisions({ limit: 100 }).find(r => r.candidateId === id);
    assert.ok(row);
    assert.equal(row!.generationStatus, 'failed');
    assert.ok(row!.generationFailure);
    assert.equal(row!.generatedJson, null);

    // No durable memory was recorded for the failed candidate.
    const after = gatherMemoryItems(null);
    const subjectMatch = (items: typeof before) => items.some(i => i.title.includes('remote code execution in agent sandbox'));
    assert.equal(subjectMatch(after), subjectMatch(before), 'failed generation must not record memory');
  });
});
