import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-memory-test-'));
process.env.AETHRA_DB_PATH = path.join(TMP_DIR, 'memory.db');

import {
  charBigrams,
  createSimilarityProvider,
  dice,
  jaccard,
  normalizeTitle,
  titleHash,
  tokenize,
  type SimilarityProvider
} from '../src/lib/memory/similarity';
import {
  detectDuplicate,
  evidenceRelation,
  hasMeaningfulNewInfo,
  identifiersOf,
  type MemoryItem
} from '../src/lib/memory/dedup';
import {
  gatherMemoryItems,
  getEditorialStance,
  getRelevantMemory,
  linkRelatedPosts,
  recordMemoryForAccepted
} from '../src/lib/memory/memory';
import {
  closeDb,
  getPostLinks,
  getRecentMemoryEntries,
  insertPost,
  upsertMemoryEntry,
  upsertTopicRow
} from '../src/lib/db';
import { initializeAgentInstance } from '../src/lib/agentEngine';

after(() => {
  closeDb();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const NOW = 1_750_000_000_000;
const HOUR = 3600_000;

function item(partial: Partial<MemoryItem> & { title: string }): MemoryItem {
  return {
    id: `item-${partial.title}`,
    summary: '',
    canonicalUrl: `https://example.com/${partial.title}`,
    kind: 'accepted',
    ...partial
  };
}

describe('title normalization + hash', () => {
  it('normalizes case, punctuation, and whitespace', () => {
    assert.equal(normalizeTitle('Prompt Injection: In Agent! Sandbox'), 'prompt injection in agent sandbox');
    assert.equal(normalizeTitle('  Agent   Sandbox\nVault  '), 'agent sandbox vault');
  });

  it('hashes equal for equivalent titles, different for distinct ones', () => {
    assert.equal(titleHash('Prompt Injection: In Agent! Sandbox'), titleHash('prompt injection in agent sandbox'));
    assert.notEqual(titleHash('Agent sandbox vault'), titleHash('Agent sandbox gateway'));
  });

  it('is deterministic', () => {
    assert.equal(titleHash('Agent sandbox vault bypass'), titleHash('Agent sandbox vault bypass'));
  });
});

describe('similarity primitives', () => {
  it('jaccard: identical sets → 1, disjoint → 0', () => {
    const a = tokenize('agent sandbox vault bypass');
    assert.equal(jaccard(a, new Set(a)), 1);
    assert.equal(jaccard(a, tokenize('crypto coin generator funding')), 0);
  });

  it('char bigram dice: word order does not matter', () => {
    const a = charBigrams('agent sandbox vault bypass');
    const b = charBigrams('bypass vault sandbox agent');
    assert.ok(dice(a, b) >= 0.9);
  });

  it('lexical provider is deterministic and symmetric', () => {
    const p = createSimilarityProvider();
    assert.equal(p.name, 'lexical');
    const x = { title: 'Agent sandbox vault bypass permits credential theft' };
    const y = { title: 'Agent sandbox vault bypass permits credential theft' };
    assert.equal(p.compare(x, y), 1);
    assert.equal(p.compare(x, y), p.compare(y, x));
  });
});

describe('duplicate ladder', () => {
  const candidate = {
    title: 'Agent sandbox vault bypass permits credential theft',
    summary: 'A new bypass lets an attacker steal credentials. CVE-2026-1001.',
    canonicalUrl: 'https://github.com/advisories/GHSA-new-1'
  };
  const provider = createSimilarityProvider();

  it('level 1: canonical source URL match', () => {
    const r = detectDuplicate(candidate, [item({ title: 'Unrelated title', canonicalUrl: candidate.canonicalUrl })], provider);
    assert.equal(r.level, 1);
    assert.equal(r.match?.title, 'Unrelated title');
  });

  it('level 2: normalized title / hash match (different URL)', () => {
    const r = detectDuplicate(
      candidate,
      [item({ title: 'Agent Sandbox Vault Bypass Permits Credential Theft!', canonicalUrl: 'https://example.com/other' })],
      provider
    );
    assert.equal(r.level, 2);
    assert.equal(r.similarity, 1);
  });

  it('level 3: keyword / topic overlap on titles = same story', () => {
    const r = detectDuplicate(
      candidate,
      [
        item({
          title: 'Agent sandbox vault bypass exploited in credential theft wave',
          canonicalUrl: 'https://example.com/follow-up'
        })
      ],
      provider
    );
    assert.equal(r.level, 3);
    assert.ok(r.similarity >= 0.5, `overlap ${r.similarity}`);
  });

  it('level 3 does NOT fire on shared generic summary prose', () => {
    // Same boilerplate summary, completely different topic title.
    const r = detectDuplicate(
      { title: 'Tool calling permits unauthorized model access', summary: 'A critical advisory about widgets.', canonicalUrl: 'https://github.com/advisories/GHSA-x' },
      [item({ title: 'Widget product has a known issue', summary: 'A critical advisory about widgets.', canonicalUrl: 'https://example.com/y' })],
      provider
    );
    assert.equal(r.level, 0);
  });

  it('level 4: semantic near-duplicate via the provider seam', () => {
    // Slugified/compound title shares almost all bigrams but few tokens, so
    // the lexical provider classifies it as a near-duplicate (level 3's
    // title-token overlap is below the keyword threshold).
    const slug = {
      title: 'AgentSandboxVaultBypass CredentialTheft',
      summary: candidate.summary,
      canonicalUrl: 'https://example.com/slug'
    };
    const r = detectDuplicate(slug, [item({ title: 'Agent Sandbox Vault Bypass Credential Theft', summary: candidate.summary, canonicalUrl: 'https://example.com/spaced' })], provider);
    assert.equal(r.level, 4, `expected level 4, got ${r.level} (sim ${r.similarity})`);
  });

  it('a mock embeddings provider is honored behind the interface', () => {
    class FakeEmbeddings implements SimilarityProvider {
      readonly name = 'fake-embeddings';
      compare(): number {
        return 0.95;
      }
    }
    const r = detectDuplicate(
      { title: 'Alpha bravo charlie delta', summary: '', canonicalUrl: 'https://a.example/1' },
      [item({ title: 'Echo foxtrot golf hotel', summary: '', canonicalUrl: 'https://b.example/2' })],
      new FakeEmbeddings()
    );
    assert.equal(r.level, 4);
  });

  it('no match returns level 0', () => {
    const r = detectDuplicate(candidate, [item({ title: 'Crypto coin generator raises funding round', summary: '' })], provider);
    assert.equal(r.level, 0);
    assert.equal(r.match, null);
  });
});

describe('meaningful new information + evidence relations', () => {
  const story = {
    title: 'Agent sandbox vault bypass permits credential theft',
    summary: 'A new bypass lets an attacker steal credentials. CVE-2026-1001.'
  };

  it('a new identifier is meaningful new information', () => {
    assert.equal(hasMeaningfulNewInfo({ title: story.title, summary: 'CVE-2026-2002 assigned.' }, story), true);
  });

  it('no new identifiers and no new tokens → NOT meaningful', () => {
    assert.equal(hasMeaningfulNewInfo({ title: story.title, summary: 'A new bypass lets an attacker steal credentials. CVE-2026-1001.' }, story), false);
  });

  it('≥ 25% new substantive tokens is meaningful', () => {
    const extended = {
      title: story.title,
      summary: 'A new bypass lets an attacker steal credentials. CVE-2026-1001. The exploit is now weaponized in phishing kits targeting fintech workers.'
    };
    assert.equal(hasMeaningfulNewInfo(extended, story), true);
  });

  it('relations: contradicts on dispute signals, updates on new ids, confirms otherwise', () => {
    const dispute = { title: 'Agent sandbox vault bypass is not vulnerable', summary: 'Vendor says the bypass is a false positive; no evidence of exploitation.' };
    assert.equal(evidenceRelation(dispute, story), 'contradicts');

    const update = { title: story.title, summary: 'CVE-2026-2002 now under active exploitation.' };
    assert.equal(evidenceRelation(update, story), 'updates');

    const confirm = { title: story.title, summary: 'Independent researchers reproduce the CVE-2026-1001 bypass.' };
    assert.equal(evidenceRelation(confirm, story), 'confirms');
  });

  it('identifiersOf extracts CVE/GHSA/arXiv ids', () => {
    const ids = identifiersOf('CVE-2026-1001, GHSA-aaaa-bbbb-cccc, arxiv.org/abs/2608.12345');
    assert.ok(ids.has('cve-2026-1001'));
    assert.ok(ids.has('ghsa-aaaa-bbbb-cccc'));
    assert.ok(ids.has('arxiv.org/abs/2608.12345'));
  });
});

describe('durable memory store', () => {
  it('upserts by (scope, kind, subject): first sighting creates, next bumps occurrences', () => {
    upsertMemoryEntry({ agentId: null, kind: 'long_term', subject: 'agent sandbox vault', content: 'Story one', nowMs: NOW });
    upsertMemoryEntry({ agentId: null, kind: 'long_term', subject: 'agent sandbox vault', content: 'Story one updated', nowMs: NOW + HOUR });
    const rows = getRecentMemoryEntries({ agentId: null, kinds: ['long_term'], limit: 10 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].occurrences, 2);
    assert.equal(rows[0].content, 'Story one updated');

    // Different kind or scope → a separate entry.
    upsertMemoryEntry({ agentId: null, kind: 'editorial', subject: 'agent sandbox vault', content: 'stance', nowMs: NOW });
    assert.equal(getRecentMemoryEntries({ agentId: null, kinds: ['long_term', 'editorial'], limit: 10 }).length, 2);
  });

  it('memory survives a restart (close + reopen)', () => {
    upsertMemoryEntry({ agentId: null, kind: 'long_term', subject: 'persisted subject', content: 'persisted content', metadata: { canonicalUrl: 'https://example.com/p' }, nowMs: NOW });
    closeDb(); // simulated server restart
    const rows = getRecentMemoryEntries({ agentId: null, kinds: ['long_term'], limit: 10 });
    const found = rows.find(r => r.subject === 'persisted subject');
    assert.ok(found, 'memory entry must survive restart');
    assert.equal(found.metadata.canonicalUrl, 'https://example.com/p');
  });
});

describe('recordMemoryForAccepted + getEditorialStance', () => {
  it('records long-term + editorial memory and accumulates stance on the story subject', () => {
    const story = {
      id: 'cand-1',
      title: 'Agent sandbox vault bypass permits credential theft',
      summary: 'A new bypass lets an attacker steal credentials. CVE-2026-1001.',
      canonicalUrl: 'https://github.com/advisories/GHSA-s-1',
      sourceType: 'github-advisory'
    };
    recordMemoryForAccepted(null, story, { nowMs: NOW });
    recordMemoryForAccepted(null, story, { nowMs: NOW + HOUR });

    const stance = getEditorialStance(null, story.title);
    assert.ok(stance);
    assert.equal(stance.relation, 'confirms');
    assert.equal(stance.occurrences, 2);
  });

  it('a follow-up with a new identifier records relation updates on the story subject', () => {
    const story = {
      id: 'cand-a',
      title: 'Prompt injection guardrail bypass in model gateway',
      summary: 'A bypass defeats the model gateway guardrails. CVE-2026-3001.',
      canonicalUrl: 'https://github.com/advisories/GHSA-a',
      sourceType: 'github-advisory'
    };
    recordMemoryForAccepted(null, story, { nowMs: NOW });
    const followUp = {
      id: 'cand-b',
      title: 'Prompt injection guardrail bypass now exploited in the wild',
      summary: 'CVE-2026-3002 is under active exploitation in the wild.',
      canonicalUrl: 'https://github.com/advisories/GHSA-b',
      sourceType: 'github-advisory'
    };
    recordMemoryForAccepted(null, followUp, {
      nowMs: NOW + 2 * HOUR,
      followUp: { subject: story.title, relation: 'updates' }
    });
    const stance = getEditorialStance(null, story.title);
    assert.ok(stance);
    assert.equal(stance.relation, 'updates');
    assert.equal(stance.occurrences, 2);
  });
});

describe('getRelevantMemory (persona scope)', () => {
  it('classifies an exact duplicate, a follow-up, and a fresh story', () => {
    const story = {
      id: 'cand-1',
      title: 'Agent sandbox vault bypass permits credential theft',
      summary: 'A new bypass lets an attacker steal credentials. CVE-2026-1001.',
      canonicalUrl: 'https://github.com/advisories/GHSA-r-1',
      sourceType: 'github-advisory'
    };
    recordMemoryForAccepted(null, story, { nowMs: NOW });

    const dup = getRelevantMemory(null, { ...story, id: 'cand-2', canonicalUrl: 'https://example.com/copy' });
    assert.equal(dup.duplicate.level, 2, 'same normalized title → level 2');

    const followUp = getRelevantMemory(null, {
      id: 'cand-3',
      title: 'Agent sandbox vault bypass now exploited in credential theft wave',
      summary: 'CVE-2026-2002 under active exploitation.',
      canonicalUrl: 'https://github.com/advisories/GHSA-r-3',
      sourceType: 'github-advisory'
    });
    assert.equal(followUp.duplicate.level, 3);
    assert.ok(followUp.followUp);
    assert.equal(followUp.meaningful, true);
    assert.equal(followUp.relation, 'updates');

    const fresh = getRelevantMemory(null, {
      id: 'cand-4',
      title: 'Crypto coin generator raises funding round',
      summary: 'Marketing announcement.',
      canonicalUrl: 'https://example.com/fresh',
      sourceType: 'github-release'
    });
    assert.equal(fresh.duplicate.level, 0);
    assert.equal(fresh.followUp, null);
  });

  it('gatherMemoryItems is stable for a given DB state', () => {
    const a = gatherMemoryItems(null);
    const b = gatherMemoryItems(null);
    assert.equal(a.length, b.length);
    assert.deepEqual(a.map(x => x.id), b.map(x => x.id));
  });
});

describe('post links (agent scope)', () => {
  function createAgentPost(agentId: string, title: string, body: string, canonicalUrl: string | null, nowMs: number): string {
    let topicId: string | null = null;
    if (canonicalUrl) {
      topicId = upsertTopicRow({
        agentId,
        title,
        canonicalSourceUrl: canonicalUrl,
        category: null,
        sourceName: null,
        credibilityScore: 90,
        trendScore: null,
        noveltyScore: 80,
        importanceScore: 90,
        confidenceScore: 90,
        recommendation: 'Accept',
        rejectionReason: null,
        detailedAnalysis: body,
        opinion: 'x',
        freshness: null,
        rawJson: '{}',
        createdAtMs: nowMs
      });
    }
    const postId = `post-${nowMs}-${title.slice(0, 12).replace(/\s/g, '-')}`;
    insertPost({
      id: postId,
      agentId,
      topicId,
      title,
      body,
      opinion: null,
      rationale: null,
      confidenceScore: 90,
      category: null,
      importanceScore: 90,
      noveltyScore: 80,
      publicationId: null,
      publishedAtMs: nowMs
    });
    return postId;
  }

  it('links a follow-up post to an earlier post of the same agent (relation updates)', () => {
    const t0 = NOW;
    const agent = initializeAgentInstance('Link Test', 'AI Systems & Hardware', undefined, undefined, t0);
    const firstPostId = createAgentPost(
      agent.agentId,
      'Agent sandbox vault bypass permits credential theft',
      'A new bypass lets an attacker steal credentials. CVE-2026-1001.',
      'https://nvd.nist.gov/vuln/detail/CVE-2026-1001',
      t0
    );
    const secondPostId = createAgentPost(
      agent.agentId,
      'Agent sandbox vault bypass now exploited in credential theft wave',
      'CVE-2026-2002 under active exploitation.',
      'https://nvd.nist.gov/vuln/detail/CVE-2026-2002',
      t0 + 2 * HOUR
    );

    const links = linkRelatedPosts(agent.agentId, secondPostId, t0 + 2 * HOUR);
    const row = links.find(l => l.relatedPostId === firstPostId);
    assert.ok(row, `expected a link to the earlier post, got ${JSON.stringify(links.map(l => l.relationType))}`);
    assert.equal(row.relationType, 'updates');

    const persisted = getPostLinks(secondPostId);
    assert.ok(persisted.some(l => l.relatedPostId === firstPostId && l.relationType === 'updates'));
  });

  it('does not link unrelated posts', () => {
    const t0 = NOW + 5 * HOUR;
    const agent = initializeAgentInstance('Link Test 2', 'AI Systems & Hardware', undefined, undefined, t0);
    const postId = createAgentPost(agent.agentId, 'Crypto coin generator raises funding round', 'Marketing announcement.', null, t0);
    const links = linkRelatedPosts(agent.agentId, postId, t0);
    assert.equal(links.length, 0);
  });
});
