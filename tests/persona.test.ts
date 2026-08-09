import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-persona-test-'));
process.env.AETHRA_DB_PATH = path.join(TMP_DIR, 'persona.db');

import {
  ADA,
  buildPostPrompt,
  buildSystemPrompt,
  getPersona,
  validatePost
} from '../src/lib/persona';
import { scoreCandidate } from '../src/lib/editorial/scoring';
import { runEditorial } from '../src/lib/editorial/engine';
import { initializeAgentInstance } from '../src/lib/agentEngine';
import { makeCandidate, type SourceType } from '../src/lib/discovery/types';
import { getRelevantMemory, personaAffinityOf } from '../src/lib/memory/memory';
import type { MemoryItem } from '../src/lib/memory/dedup';
import type { EditorialDecision } from '../src/lib/editorial/types';
import { closeDb, insertDiscoveryCandidate } from '../src/lib/db';

after(() => {
  closeDb();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const T0 = 1_750_000_000_000;
const HOUR = 3600_000;
const iso = (ms: number): string => new Date(ms).toISOString();

// The editorial pipeline is per-agent; one agent owns this file's state.
const AGENT_ID = initializeAgentInstance('Persona Test', 'ai-security').agentId;

function candidate(seed: {
  title: string;
  summary?: string;
  canonicalUrl: string;
  sourceType: SourceType;
  rawEvidence?: string;
  publishedAt?: string;
}) {
  const c = makeCandidate({
    title: seed.title,
    summary: seed.summary ?? '',
    publishedAt: seed.publishedAt ?? iso(T0 - 2 * HOUR),
    canonicalUrl: seed.canonicalUrl,
    sourceName: 'Test Source',
    sourceType: seed.sourceType,
    rawEvidence: seed.rawEvidence ?? '{}'
  });
  assert.ok(c, `candidate must normalize: ${seed.title}`);
  return c;
}

function addCandidate(seed: Parameters<typeof candidate>[0]): { id: string } {
  const c = candidate(seed);
  const ok = insertDiscoveryCandidate(c, T0);
  assert.ok(ok, `candidate must insert (unique URL): ${seed.canonicalUrl}`);
  return { id: c.id };
}

function decisionOf(summary: { decisions: EditorialDecision[] }, candidateId: string): EditorialDecision {
  const d = summary.decisions.find(x => x.candidateId === candidateId);
  assert.ok(d, `expected a decision for candidate ${candidateId}`);
  return d;
}

describe('Ada persona definition', () => {
  it('has every required structured field populated', () => {
    assert.ok(ADA.identity.length > 50, 'identity');
    assert.ok(ADA.mission.length > 50, 'mission');
    assert.ok(ADA.expertise.length >= 5, 'expertise');
    assert.ok(ADA.targetAudience.length >= 3, 'target audience');
    assert.ok(ADA.editorialPillars.length >= 4, 'editorial pillars');
    assert.ok(ADA.recurringThemes.length >= 5, 'recurring themes');
    assert.ok(ADA.strongOpinions.length >= 3, 'strong opinions');
    assert.ok(ADA.topicsToAvoid.length >= 4, 'topics to avoid');
    assert.ok(ADA.styleRules.length >= 4, 'style rules');
    assert.ok(ADA.confidenceRules.uncertaintyPhrases.length >= 3, 'uncertainty phrases');
  });

  it('post structure contains the four core sections + confidence', () => {
    const ids = ADA.postStructure.map(s => s.id);
    for (const id of [
      'title',
      'summary',
      'exploitability',
      'blast-radius',
      'mitigations',
      'architectural-implications',
      'confidence'
    ]) {
      assert.ok(ids.includes(id), `missing section ${id}`);
    }
  });

  it('vocabulary categories are populated', () => {
    assert.ok(ADA.vocabulary.securityTerms.length > 30, 'security terms');
    assert.ok(ADA.vocabulary.aiTerms.length > 15, 'ai terms');
    assert.ok(ADA.vocabulary.technicalTerms.length > 20, 'technical terms');
    assert.ok(ADA.vocabulary.marketingTerms.length > 20, 'marketing terms');
    assert.ok(ADA.vocabulary.avoidTerms.length >= 5, 'avoid terms');
    assert.ok(ADA.vocabulary.styleAvoid.length >= 5, 'style-avoid terms');
  });

  it('registry resolves Ada for AI/security and a neutral persona otherwise', () => {
    assert.equal(getPersona(null).id, 'ada');
    assert.equal(getPersona('AI Security').id, 'ada');
    assert.equal(getPersona('Robotics').id, 'generic');
  });
});

describe('persona-driven topic relevance scoring', () => {
  it('scores an on-theme security candidate high on persona relevance', () => {
    const c = candidate({
      title: 'Prompt injection in agent toolchains allows credential exfiltration',
      summary:
        'A prompt injection bypass in the agent tool-calling layer lets an attacker steal stored credentials through a hidden channel. CVE-2026-1234, GHSA-xxxx-yyyy-zzzz.',
      canonicalUrl: 'https://github.com/advisories/GHSA-rel-1',
      sourceType: 'github-advisory',
      rawEvidence: '{}'
    });
    const s = scoreCandidate(c, { now: T0, memoryTitles: [], corroborationCves: new Set() });
    assert.ok(s.components.personaRelevance >= 14, `got ${s.components.personaRelevance}`);
    assert.equal(s.flags.offPersona, undefined);
  });

  it('flags unrelated lifestyle content as off-persona with a matched term', () => {
    const c = candidate({
      title: 'Celebrity fitness influencer launches NFT presale',
      summary: 'A celebrity influencer is promoting an NFT presale and a lifestyle fitness app with viral challenges.',
      canonicalUrl: 'https://example.com/celebrity',
      sourceType: 'github-release',
      rawEvidence: '{}'
    });
    const s = scoreCandidate(c, { now: T0, memoryTitles: [], corroborationCves: new Set() });
    assert.equal(s.components.personaRelevance, 0);
    assert.ok(s.flags.offPersona, 'off-persona flag must fire for unrelated content');
  });

  it('a pure web bug without AI/security framing still carries partial relevance via security terms', () => {
    const c = candidate({
      title: 'Buffer overflow in network daemon allows privilege escalation',
      summary: 'A buffer overflow in the daemon lets a local attacker escalate privileges. CVE-2026-5555.',
      canonicalUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-5555',
      sourceType: 'cisa-kev',
      rawEvidence: JSON.stringify({ cveID: 'CVE-2026-5555' })
    });
    const s = scoreCandidate(c, { now: T0, memoryTitles: [], corroborationCves: new Set() });
    assert.ok(s.components.personaRelevance >= 8, `got ${s.components.personaRelevance}`);
  });
});

describe('persona-driven candidate rejection', () => {
  it('runEditorial rejects unrelated topics with an off-persona reason and accepts on-theme ones', async () => {
    const unrelated = addCandidate({
      title: 'Celebrity meme coin presale raises millions in seed funding',
      summary: 'A celebrity-endorsed meme coin presale raised millions and launched a viral challenge.',
      canonicalUrl: 'https://example.com/meme-coin',
      sourceType: 'github-release',
      rawEvidence: JSON.stringify({ tag_name: 'v1.0.0' })
    });
    const onTheme = addCandidate({
      title: 'Critical prompt injection vulnerability in agent framework allows remote code execution',
      summary:
        'A critical prompt injection bypass in the agent framework tool-calling layer lets an attacker escalate to remote code execution. Proof of concept available. CVE-2026-99999 assigned. GHSA-aaaa-bbbb-cccc.',
      canonicalUrl: 'https://github.com/advisories/GHSA-per-1',
      sourceType: 'github-advisory',
      rawEvidence: JSON.stringify({ cve_id: 'CVE-2026-99999', ghsa_id: 'GHSA-aaaa-bbbb-cccc', summary: 'prompt injection rce' }) // no severity → threshold path
    });

    const run = await runEditorial({ agentId: AGENT_ID, now: T0 + HOUR, routineIntervalMs: 0, dailyCap: 10_000 });

    const u = decisionOf(run, unrelated.id);
    assert.equal(u.kind, 'rejected');
    assert.match(u.explanation, /Off-persona/);
    assert.match(u.explanation, /topics to avoid/);

    const t = decisionOf(run, onTheme.id);
    assert.equal(t.kind, 'accepted', t.explanation);
    assert.match(t.explanation, /On-theme for Ada/);
  });

  it('marketing-heavy content is rejected with Ada\'s hype stance', async () => {
    const m = addCandidate({
      title: 'AI startup raises $50M seed round to launch consumer app',
      summary: 'The startup announced a funding round and press release about a new consumer app launch.',
      canonicalUrl: 'https://example.com/funding',
      sourceType: 'github-release',
      rawEvidence: JSON.stringify({ tag_name: 'v1.0.0' })
    });
    const run = await runEditorial({ agentId: AGENT_ID, now: T0 + 2 * HOUR, routineIntervalMs: 0, dailyCap: 10_000 });
    const d = decisionOf(run, m.id);
    assert.equal(d.kind, 'rejected');
    assert.match(d.explanation, /marketing/);
    assert.match(d.explanation, /Ada's stance/);
  });
});

describe('persona-driven prompt construction', () => {
  it('buildSystemPrompt embeds identity, mission, voice, structure, and confidence rules', () => {
    const prompt = buildSystemPrompt(ADA);
    assert.ok(prompt.includes(ADA.identity.slice(0, 40)));
    assert.ok(prompt.includes(ADA.mission.slice(0, 40)));
    assert.ok(prompt.includes('Exploitability first'));
    assert.ok(prompt.includes('Blast radius'));
    assert.ok(prompt.includes('Required post structure'));
    assert.ok(prompt.includes('Confidence and uncertainty rules'));
    assert.ok(prompt.includes('Calm and measured'));
    assert.ok(prompt.includes('Evidence-bound'));
    assert.ok(prompt.includes('Topics you never cover'));
  });

  it('buildPostPrompt includes the candidate and memory context', () => {
    const { system, user } = buildPostPrompt(ADA, {
      title: 'Prompt injection in agent toolchains',
      summary: 'Credential exfiltration via guardrail bypass.',
      canonicalUrl: 'https://github.com/advisories/GHSA-p-1',
      sourceName: 'GitHub Security Advisories',
      followUp: { story: 'Agent sandbox vault bypass', relation: 'updates' },
      themes: ['prompt injection']
    });
    assert.ok(system.includes('Ada'));
    assert.ok(user.includes('Prompt injection in agent toolchains'));
    assert.ok(user.includes('Agent sandbox vault bypass'));
    assert.ok(user.includes('updates'));
    assert.ok(user.includes('prompt injection'));
    assert.ok(user.includes('required structure'));
  });
});

describe('persona-driven final post quality validation', () => {
  const structuredPost = {
    title: 'Prompt injection in agent toolchains allows credential exfiltration',
    text:
      'A prompt injection bypass in the agent tool-calling layer (CVE-2026-1234, GHSA-xxxx-yyyy-zzzz) allows unauthenticated credential exfiltration. ' +
      'Exploitability: a single crafted message triggers the path; a proof of concept exists. ' +
      'Blast radius: all tenants using the tool-calling channel are affected and stored credentials are exposed; compromise propagates to downstream systems. ' +
      'Mitigations: upgrade to 2.1, disable tool calling for untrusted sessions, and rotate credentials. ' +
      'Architectural implications: the trust boundary between model output and tool execution must be isolated and tools gated behind allowlists. ' +
      'We assess with high confidence based on the disclosed reproduction.',
    rationale: 'Selected for high relevance to AI Security.',
    opinion: 'No specific editorial notes.'
  };

  it('a structured, evidence-bound Ada-style post passes', () => {
    const report = validatePost(ADA, structuredPost);
    assert.equal(report.valid, true, JSON.stringify(report.checks.filter(c => !c.passed), null, 1));
    assert.ok(report.score >= 0.8, `score ${report.score}`);
  });

  it('a hype-y, unstructured post fails with the specific reasons', () => {
    const report = validatePost(ADA, {
      title: 'INSANE!!!',
      text: 'This is HUGE NEWS!!! Mind-blowing revolutionary game-changing announcement.',
      rationale: '',
      opinion: ''
    });
    assert.equal(report.valid, false);
    const failed = report.checks.filter(c => c.required && !c.passed).map(c => c.id);
    assert.ok(failed.includes('title'), `title missing from ${failed.join(',')}`);
    assert.ok(failed.includes('depth'), 'depth');
    assert.ok(failed.includes('evidence'), 'evidence');
    assert.ok(failed.includes('style'), 'style');
    assert.ok(failed.includes('section:summary'), 'summary section (needs an identifier)');
  });

  it('a confident post without any identifier or uncertainty statement fails the evidence check', () => {
    const report = validatePost(ADA, {
      title: 'Agent sandbox escape in the wild',
      text:
        'The agent sandbox escape is definitely real and definitely being exploited everywhere right now. Everyone should panic. It is completely confirmed with zero doubt and affects all systems without exception across the entire industry including every vendor.',
      rationale: '',
      opinion: ''
    });
    assert.equal(report.valid, false);
    const evidence = report.checks.find(c => c.id === 'evidence');
    assert.ok(evidence && !evidence.passed);
  });
});

describe('persona-aware memory retrieval', () => {
  const items: MemoryItem[] = [
    { id: 'a', title: 'Agent sandbox escape runtime', summary: '', canonicalUrl: 'https://a', kind: 'post' },
    { id: 'b', title: 'Agent sandbox escape exfiltration', summary: '', canonicalUrl: 'https://b', kind: 'post' }
  ];
  const candidateLike = {
    id: 'c',
    title: 'Agent sandbox escape alert',
    summary: '',
    canonicalUrl: 'https://c',
    sourceType: 'github-advisory' as const
  };

  it('persona themes tie-break the follow-up story match', () => {
    const withPersona = getRelevantMemory(null, candidateLike, { items, persona: ADA });
    assert.equal(withPersona.duplicate.level, 3);
    assert.equal(withPersona.followUp?.item.id, 'b', 'exfiltration matches Ada themes over runtime');
    assert.ok(withPersona.personaAffinity > 0, 'persona affinity must be reported');

    const withoutPersona = getRelevantMemory(null, candidateLike, { items });
    assert.equal(withoutPersona.followUp?.item.id, 'a', 'first max-sim item wins without persona');
  });

  it('personaAffinityOf ranks security content above lifestyle content', () => {
    const onTheme = { id: '1', title: 'Prompt injection in agent toolchains', summary: 'credential exfiltration via guardrail bypass', canonicalUrl: 'u', sourceType: 'x' };
    const offTheme = { id: '2', title: 'Fitness influencer launches new app', summary: 'lifestyle marketing content', canonicalUrl: 'u2', sourceType: 'x' };
    assert.ok(personaAffinityOf(ADA, onTheme) > personaAffinityOf(ADA, offTheme));
  });
});
