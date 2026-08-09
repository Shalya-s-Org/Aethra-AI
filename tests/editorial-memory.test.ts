import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-editorial-memory-'));
process.env.AETHRA_DB_PATH = path.join(TMP_DIR, 'editorial-memory.db');

import { runEditorial } from '../src/lib/editorial/engine';
import { makeCandidate, type SourceType } from '../src/lib/discovery/types';
import type { EditorialDecision } from '../src/lib/editorial/types';
import { getEditorialStance } from '../src/lib/memory/memory';
import { initializeAgentInstance } from '../src/lib/agentEngine';
import { closeDb, getRecentMemoryEntries, insertDiscoveryCandidate } from '../src/lib/db';

after(() => {
  closeDb();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const T0 = 1_750_000_000_000;
const DAY = 25 * 3600_000;
const HOUR = 3600_000;
const nowFor = (i: number): number => T0 + i * DAY;
const iso = (ms: number): string => new Date(ms).toISOString();
const NO_LIMITS = { routineIntervalMs: 0, dailyCap: 10_000 };

// The editorial pipeline is per-agent; one agent owns this file's state.
const AGENT_ID = initializeAgentInstance('Editorial Memory', 'ai-security').agentId;

interface CandidateSeed {
  title: string;
  summary?: string;
  publishedAt?: string;
  canonicalUrl: string;
  sourceType?: SourceType;
  rawEvidence?: string;
}

function addCandidate(seed: CandidateSeed): { id: string; title: string } {
  const candidate = makeCandidate({
    title: seed.title,
    summary: seed.summary ?? '',
    publishedAt: seed.publishedAt ?? iso(T0 - 2 * HOUR),
    canonicalUrl: seed.canonicalUrl,
    sourceName: 'Test Source',
    sourceType: seed.sourceType ?? 'github-advisory',
    rawEvidence:
      seed.rawEvidence ??
      JSON.stringify({ cve_id: 'CVE-2026-1001', ghsa_id: 'GHSA-aaaa-bbbb-cccc', severity: 'high', summary: 'advisory' })
  });
  assert.ok(candidate, `candidate must normalize: ${seed.title}`);
  const inserted = insertDiscoveryCandidate(candidate, T0);
  assert.ok(inserted, `candidate must insert (unique URL): ${seed.canonicalUrl}`);
  return { id: candidate.id, title: candidate.title };
}

function decisionOf(summary: { decisions: EditorialDecision[] }, candidateId: string): EditorialDecision {
  const d = summary.decisions.find(x => x.candidateId === candidateId);
  assert.ok(d, `expected a decision for candidate ${candidateId}`);
  return d;
}

// The story every test starts from: accepted in run 1, then follow-ups.
const STORY = {
  title: 'Agent sandbox vault bypass permits credential theft',
  summary:
    'A critical bypass in the agent sandbox vault lets an attacker steal stored credentials through a hidden tool-calling channel. Proof of concept available; patch released. CVE-2026-1001 assigned.',
  canonicalUrl: 'https://github.com/advisories/GHSA-story-1'
};

async function seedStory(runAt: number): Promise<{ id: string }> {
  const s = addCandidate({
    title: STORY.title,
    summary: STORY.summary,
    canonicalUrl: STORY.canonicalUrl,
    publishedAt: iso(runAt - 2 * HOUR)
  });
  await runEditorial({ agentId: AGENT_ID, now: runAt, ...NO_LIMITS });
  return s;
}

describe('durable memory in the editorial pipeline', () => {
  it('accepts the seed story first', async () => {
    const s = await seedStory(nowFor(1));
    const stance = getEditorialStance(AGENT_ID, STORY.title);
    assert.ok(stance, 'accepted story must be recorded as editorial memory');
    assert.equal(stance.relation, 'confirms');
    void s;
  });

  it('rejects an exact duplicate: same canonical URL is blocked at intake (ladder level 1)', async () => {
    // discovery_candidates.canonical_url is UNIQUE, so a candidate pointing at
    // an already-seen URL can never enter the pool — level 1 is enforced at
    // intake (and by the ladder for agent posts).
    const candidate = makeCandidate({
      title: 'A completely different title for the same source',
      summary: 'This candidate points at the already-accepted canonical URL.',
      publishedAt: iso(nowFor(2) - 2 * HOUR),
      canonicalUrl: STORY.canonicalUrl,
      sourceName: 'Test Source',
      sourceType: 'github-advisory',
      rawEvidence: JSON.stringify({ cve_id: 'CVE-2026-1001' })
    });
    assert.ok(candidate);
    assert.equal(insertDiscoveryCandidate(candidate, T0), false, 'duplicate canonical URL must be rejected at intake');
  });

  it('rejects an exact duplicate: same normalized title (ladder level 2)', async () => {
    const dup = addCandidate({
      title: 'Agent Sandbox Vault Bypass Permits Credential Theft!', // punctuation-only change
      summary: 'Another copy of the same story.',
      canonicalUrl: 'https://example.com/reshared-copy',
      publishedAt: iso(nowFor(3) - 2 * HOUR)
    });
    const run = await runEditorial({ agentId: AGENT_ID, now: nowFor(3), ...NO_LIMITS });
    const d = decisionOf(run, dup.id);
    assert.equal(d.kind, 'rejected');
    assert.match(d.explanation, /Duplicate: title matches accepted candidate/);
  });

  it('rejects a semantic near-duplicate (slugified title, ladder level 4)', async () => {
    const near = addCandidate({
      title: 'AgentSandboxVaultBypass PermitsCredentialTheft',
      summary: 'Repackaged version of the same story with no new facts.',
      canonicalUrl: 'https://example.com/slug-copy',
      publishedAt: iso(nowFor(4) - 2 * HOUR)
    });
    const run = await runEditorial({ agentId: AGENT_ID, now: nowFor(4), ...NO_LIMITS });
    const d = decisionOf(run, near.id);
    assert.equal(d.kind, 'rejected');
    assert.match(d.explanation, /Near-duplicate|Duplicate/);
  });

  it('rejects a same-story follow-up without meaningful new information', async () => {
    // Title overlaps the story at the follow-up band (0.5–0.84, not a title
    // duplicate), but the content adds no identifiers and no new facts.
    const staleFollowUp = addCandidate({
      title: 'Agent sandbox vault bypass rehash of credential theft story',
      summary: STORY.summary,
      canonicalUrl: 'https://example.com/rehash',
      publishedAt: iso(nowFor(5) - 2 * HOUR),
      rawEvidence: JSON.stringify({ cve_id: 'CVE-2026-1001', ghsa_id: 'GHSA-aaaa-bbbb-cccc', summary: 'rehash' }) // no severity → not breaking
    });
    const run = await runEditorial({ agentId: AGENT_ID, now: nowFor(5), ...NO_LIMITS });
    const d = decisionOf(run, staleFollowUp.id);
    assert.equal(d.kind, 'rejected');
    assert.match(d.explanation, /Follow-up on .* without meaningful new information/);
  });

  it('accepts a legitimate story follow-up with meaningful new information and records the relation', async () => {
    // Fresh title in the follow-up band, a NEW identifier, deep new detail —
    // but explicitly NOT breaking-security (no severity field) so the
    // threshold path (and its follow-up explanation) applies.
    const followUp = addCandidate({
      title: 'Agent sandbox vault bypass now exploited in credential theft wave',
      summary:
        'The agent sandbox vault bypass is now under active exploitation in credential theft campaigns. CISA added CVE-2026-2002 to the Known Exploited Vulnerabilities catalog. Analysis shows the tool-calling channel bypasses the sandbox escape detection, and a proof of concept weaponizes the deserialization path for unauthenticated remote credential exfiltration from the agent vault. Patch urgently recommended; a workaround disables tool calling for untrusted sessions.',
      canonicalUrl: 'https://github.com/advisories/GHSA-story-2',
      publishedAt: iso(nowFor(6) - 2 * HOUR),
      rawEvidence: JSON.stringify({
        cve_id: 'CVE-2026-2002',
        ghsa_id: 'GHSA-eeee-ffff-gggg',
        summary: 'exploitation follow-up',
        description:
          'CISA has added CVE-2026-2002 to the Known Exploited Vulnerabilities catalog based on evidence of active exploitation in credential theft campaigns. The bypass chains the sandbox escape with the tool-calling channel. Patched versions and mitigation guidance are published in the vendor advisory. Organizations using the agent framework should prioritize applying the patch and reviewing access logs for anomalous tool-calling activity.',
        references: ['https://github.com/advisories/GHSA-eeee-ffff-gggg', 'https://nvd.nist.gov/vuln/detail/CVE-2026-2002'],
        cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'
      })
    });
    const run = await runEditorial({ agentId: AGENT_ID, now: nowFor(6), ...NO_LIMITS });
    const d = decisionOf(run, followUp.id);
    assert.equal(d.kind, 'accepted', d.explanation);
    assert.match(d.explanation, /Follow-up on/);
    assert.match(d.explanation, /updates the prior stance/);

    // Editorial memory: the story's stance is now 'updates' (new CVE).
    const stance = getEditorialStance(AGENT_ID, STORY.title);
    assert.ok(stance);
    assert.equal(stance.relation, 'updates');
    assert.ok(stance.occurrences >= 2, `story seen ${stance.occurrences} times`);

    // Long-term memory accumulated on the same story subject.
    const longTerm = getRecentMemoryEntries({ agentId: AGENT_ID, kinds: ['long_term'], limit: 50 });
    const storyEntry = longTerm.find(e => e.subject.includes('agent sandbox vault bypass'));
    assert.ok(storyEntry, 'long-term memory must record the recurring subject');
    assert.ok(storyEntry.occurrences >= 2);
  });

  it('a brand-new story is untouched by memory', async () => {
    const fresh = addCandidate({
      title: 'Heap corruption in agent gateway deserialization path',
      summary:
        'A critical heap corruption bug in the agent gateway deserialization path lets an unauthenticated attacker gain remote code execution. CVE-2026-77701 assigned.',
      canonicalUrl: 'https://github.com/advisories/GHSA-fresh-1',
      publishedAt: iso(nowFor(7) - 2 * HOUR)
    });
    const run = await runEditorial({ agentId: AGENT_ID, now: nowFor(7), ...NO_LIMITS });
    const d = decisionOf(run, fresh.id);
    assert.equal(d.kind, 'accepted');
    assert.doesNotMatch(d.explanation, /Follow-up on/);
  });
});
