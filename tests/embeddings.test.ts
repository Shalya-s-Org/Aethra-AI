import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-embeddings-test-'));
process.env.AETHRA_DB_PATH = path.join(TMP_DIR, 'embeddings.db');

import {
  contentKey,
  cosine,
  createEmbeddingProvider,
  dbEmbeddingCache,
  OpenAiEmbeddingsProvider,
  type EmbeddingProvider
} from '../src/lib/memory/embeddings';
import {
  createSimilarityProvider,
  EmbeddingSimilarityProvider,
  LexicalSimilarityProvider,
  type SimilarityProvider
} from '../src/lib/memory/similarity';
import { detectDuplicate, type MemoryItem } from '../src/lib/memory/dedup';
import { getRelevantMemory } from '../src/lib/memory/memory';
import {
  closeDb,
  getEmbedding,
  upsertEmbedding
} from '../src/lib/db';
import { initializeAgentInstance } from '../src/lib/agentEngine';

after(() => {
  closeDb();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const NOW = 1_750_000_000_000;

/** In-memory cache facade for provider unit tests (the DB cache is exercised
 *  separately). */
function memoryCache(): { cache: import('../src/lib/memory/embeddings').EmbeddingCache; store: Map<string, number[]> } {
  const store = new Map<string, number[]>();
  return {
    store,
    cache: {
      get(_agentId, key, model) {
        return store.get(`${_agentId ?? ''}|${key}|${model}`) ?? null;
      },
      put(_agentId, key, model, vector) {
        store.set(`${_agentId ?? ''}|${key}|${model}`, vector);
      }
    }
  };
}

describe('cosine similarity', () => {
  it('identical vectors → 1, orthogonal → 0', () => {
    assert.equal(cosine([1, 0], [1, 0]), 1);
    assert.equal(cosine([1, 0], [0, 1]), 0);
  });

  it('scaling does not change similarity', () => {
    assert.ok(Math.abs(cosine([2, 4], [1, 2]) - 1) < 1e-9);
  });

  it('zero-length or mismatched vectors → 0 (never NaN)', () => {
    assert.equal(cosine([], []), 0);
    assert.equal(cosine([1, 2], [1]), 0);
    assert.equal(cosine([0, 0], [0, 0]), 0);
    assert.ok(Number.isFinite(cosine([0, 0], [1, 1])));
  });
});

describe('contentKey', () => {
  it('is deterministic and case/punctuation-insensitive (normalized title)', () => {
    assert.equal(contentKey('Agent Sandbox Vault Bypass!'), contentKey('agent sandbox vault bypass'));
    assert.equal(contentKey('X'), contentKey('X'));
    assert.notEqual(contentKey('Agent sandbox vault bypass'), contentKey('Agent sandbox vault escape'));
  });
});

describe('OpenAiEmbeddingsProvider (fetch contract)', () => {
  after(() => {
    // @ts-expect-error restoring the real global after stubbing
    delete globalThis.fetch;
  });

  it('POSTs to {base}/embeddings with the model + bearer key and parses the vector', async () => {
    const requested: Array<{ url: string; init?: RequestInit }> = [];
    const realFetch = globalThis.fetch;
    (globalThis as { fetch: unknown }).fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      requested.push({ url: String(url), init });
      return new Response(JSON.stringify({ data: [{ embedding: [0.1, 0.2, 0.3] }] }));
    }) as typeof fetch;

    const provider = new OpenAiEmbeddingsProvider({
      apiKey: 'sk-test',
      baseUrl: 'https://emb.example.com/v1/',
      model: 'embed-m'
    });
    const vector = await provider.embed('agent sandbox vault bypass');
    assert.deepEqual(vector, [0.1, 0.2, 0.3]);
    assert.equal(requested.length, 1);
    assert.equal(requested[0].url, 'https://emb.example.com/v1/embeddings');
    const body = JSON.parse(String(requested[0].init?.body));
    assert.equal(body.model, 'embed-m');
    assert.equal(body.input, 'agent sandbox vault bypass');
    const headers = requested[0].init?.headers as Record<string, string>;
    assert.equal(headers.Authorization, 'Bearer sk-test');
    assert.equal(provider.model, 'embed-m');

    globalThis.fetch = realFetch;
  });

  it('throws on a non-2xx response', async () => {
    const realFetch = globalThis.fetch;
    (globalThis as { fetch: unknown }).fetch = (async () =>
      new Response('rate limited', { status: 429 })) as typeof fetch;
    const provider = new OpenAiEmbeddingsProvider({ apiKey: 'sk-test' });
    await assert.rejects(provider.embed('x'), /embeddings API 429/);
    globalThis.fetch = realFetch;
  });

  it('throws on an empty embedding (caller degrades)', async () => {
    const realFetch = globalThis.fetch;
    (globalThis as { fetch: unknown }).fetch = (async () =>
      new Response(JSON.stringify({ data: [] }))) as typeof fetch;
    const provider = new OpenAiEmbeddingsProvider({ apiKey: 'sk-test' });
    await assert.rejects(provider.embed('x'), /empty vector/);
    globalThis.fetch = realFetch;
  });
});

describe('EmbeddingSimilarityProvider (the seam)', () => {
  it('uses cached vectors when warmed; falls back to lexical when not', async () => {
    const { cache } = memoryCache();
    const embedder: EmbeddingProvider = {
      name: 'stub',
      model: 'm',
      async embed(text) {
        return text.toLowerCase().includes('agent') ? [1, 0] : [0, 1];
      }
    };
    const provider = new EmbeddingSimilarityProvider({ agentId: null, embedder, cache });

    // Not warmed → lexical fallback (identical titles still compare to 1 via
    // the fallback, but the provider reports its own name).
    assert.equal(provider.name, 'embeddings');
    assert.equal(provider.compare({ title: 'Agent vault bypass' }, { title: 'Agent vault bypass' }), 1);

    // Warm the batch, then compare via embeddings (orthogonal vectors → 0).
    await provider.warm([
      { title: 'Agent vault bypass' },
      { title: 'Crypto coin generator funding' }
    ]);
    assert.equal(provider.compare({ title: 'Agent vault bypass' }, { title: 'Crypto coin generator funding' }), 0);
    // A warmed item vs an unwarmed item degrades per-pair to lexical.
    const lexical = new LexicalSimilarityProvider().compare(
      { title: 'Agent vault bypass' },
      { title: 'Unseen title entirely different' }
    );
    assert.equal(
      provider.compare({ title: 'Agent vault bypass' }, { title: 'Unseen title entirely different' }),
      lexical
    );
  });

  it('batches missing keys into one embedMany round-trip when available', async () => {
    const { cache } = memoryCache();
    let calls = 0;
    const embedder: EmbeddingProvider = {
      name: 'stub',
      model: 'm',
      async embed() {
        throw new Error('unused');
      },
      async embedMany(texts) {
        calls += 1;
        return texts.map(t => (t.toLowerCase().includes('agent') ? [1, 0] : [0, 1]));
      }
    };
    const provider = new EmbeddingSimilarityProvider({ agentId: null, embedder, cache });
    await provider.warm([
      { title: 'Agent vault bypass' },
      { title: 'Crypto coin generator funding' },
      { title: 'Agent vault bypass' } // duplicate in-batch → embedded once
    ]);
    assert.equal(calls, 1, 'all missing keys go in a single round-trip');
    assert.equal(provider.compare({ title: 'Agent vault bypass' }, { title: 'Crypto coin generator funding' }), 0);
  });

  it('degradation: an embedder failure is counted, never thrown, and compares fall back', async () => {
    const { cache } = memoryCache();
    const failing: EmbeddingProvider = {
      name: 'stub',
      model: 'm',
      async embed() {
        throw new Error('embedding service down');
      }
    };
    const provider = new EmbeddingSimilarityProvider({ agentId: null, embedder: failing, cache });
    await provider.warm([{ title: 'A' }, { title: 'B' }]); // must not throw
    assert.equal(provider.failures, 2);
    // compare still answers via the lexical fallback (symmetric, deterministic)
    assert.equal(
      provider.compare({ title: 'Agent sandbox vault' }, { title: 'Agent sandbox vault' }),
      1
    );
  });
});

describe('durable embeddings cache (agent/persona scope)', () => {
  it('round-trips through the DB and survives a restart', () => {
    upsertEmbedding({ agentId: null, contentKey: 'key-1', model: 'm1', vector: [0.5, 0.25], nowMs: NOW });
    upsertEmbedding({ agentId: null, contentKey: 'key-1', model: 'm1', vector: [0.9, 0.1], nowMs: NOW + 1 });
    const row = getEmbedding(null, 'key-1', 'm1');
    assert.ok(row);
    assert.deepEqual(row.vector, [0.9, 0.1]); // upsert replaced

    closeDb(); // simulated server restart
    const again = getEmbedding(null, 'key-1', 'm1');
    assert.ok(again, 'embedding must survive restart');
    assert.deepEqual(again.vector, [0.9, 0.1]);

    // Different model → separate cache entry.
    assert.equal(getEmbedding(null, 'key-1', 'm2'), null);
  });

  it('scopes by agent: one agent cannot read another agent’s vectors', () => {
    const agentA = initializeAgentInstance('Embed A', 'ai-security').agentId;
    const agentB = initializeAgentInstance('Embed B', 'ai-security').agentId;
    upsertEmbedding({ agentId: agentA, contentKey: 'key-a', model: 'm1', vector: [1, 0], nowMs: NOW });

    const a = dbEmbeddingCache.get(agentA, 'key-a', 'm1');
    assert.ok(a && a[0] === 1, 'owner scope reads its own vector');
    assert.equal(dbEmbeddingCache.get(agentB, 'key-a', 'm1'), null, 'other agent → cache miss');
    assert.equal(dbEmbeddingCache.get(null, 'key-a', 'm1'), null, 'persona scope → cache miss');
  });
});

/** A deterministic synonym-aware concept embedder: a stand-in for a real
 *  semantic model (which would map paraphrases onto shared meaning). */
const CONCEPTS: Array<{ words: string[] }> = [
  { words: ['prompt injection', 'tool-calling', 'tool calling', 'function-calling', 'function calling'] },
  { words: ['remote code execution', 'rce', 'code execution'] },
  { words: ['sandbox', 'vault', 'isolation'] },
  { words: ['credential', 'theft', 'exfiltration', 'stolen'] },
  { words: ['bypass', 'escape', 'evasion'] },
  { words: ['supply chain', 'dependency', 'malicious package', 'malicious dependency'] },
  { words: ['model access', 'unauthorized access', 'privilege escalation', 'data leakage'] }
];

class ConceptEmbedder implements EmbeddingProvider {
  readonly name = 'concept-test';
  readonly model = 'concept-test-v1';
  async embed(text: string): Promise<number[]> {
    const lower = text.toLowerCase();
    const v = CONCEPTS.map(c => (c.words.some(w => lower.includes(w)) ? 1 : 0));
    const norm = Math.sqrt(v.reduce<number>((a, b) => a + b * b, 0));
    return norm === 0 ? v : v.map(x => x / norm);
  }
}

function providerFor(agentId: string | null, embedder: EmbeddingProvider = new ConceptEmbedder()): SimilarityProvider {
  return new EmbeddingSimilarityProvider({ agentId, embedder });
}

function memoryItem(title: string, canonicalUrl = `https://example.com/${encodeURIComponent(title)}`): MemoryItem {
  return { id: `m-${title}`, title, summary: '', canonicalUrl, kind: 'accepted' };
}

describe('ladder integration (semantic step runs only after deterministic checks)', () => {
  it('near-duplicate paraphrase (low token overlap, high semantic similarity) → level 4', async () => {
    const prior = 'Critical prompt injection flaw in agent tool-calling enables remote code execution';
    const provider = providerFor(null);
    await provider.warm?.([
      { title: prior },
      { title: 'RCE via crafted instructions in agent function-calling layer' }
    ]);
    const r = detectDuplicate(
      { title: 'RCE via crafted instructions in agent function-calling layer', summary: '', canonicalUrl: 'https://example.com/paraphrase' },
      [memoryItem(prior, 'https://example.com/prior')],
      provider
    );
    assert.equal(r.level, 4, `expected semantic near-duplicate, got level ${r.level} (sim ${r.similarity.toFixed(2)})`);
    assert.ok(r.similarity >= 0.85);
  });

  it('a paraphrase with the same evidence is a semantic near-duplicate (level 4), which the engine hard-rejects', async () => {
    const prior = {
      id: 'p-1',
      title: 'Agent sandbox vault bypass permits credential theft',
      summary: 'CVE-2026-1001.',
      canonicalUrl: 'https://github.com/advisories/GHSA-p1',
      sourceType: 'github-advisory' as const
    };
    const candidate = {
      id: 'p-2',
      title: 'Agent sandbox vault escape enables credential exfiltration',
      summary: 'CVE-2026-1001.',
      canonicalUrl: 'https://example.com/paraphrase',
      sourceType: 'github-advisory' as const
    };
    const provider = providerFor(null);
    await provider.warm?.([{ title: prior.title }, { title: candidate.title }]);
    const memory = getRelevantMemory(null, candidate, {
      provider,
      items: [memoryItem(prior.title, prior.canonicalUrl)]
    });
    // The rewrite carries the SAME identifier and no new evidence — the
    // semantic step classifies it as a near-duplicate (level 4), which the
    // editorial engine hard-rejects (memoryNearDuplicate) rather than
    // republishing the story as a fresh post. (The lexical token-novelty
    // heuristic alone would call the rewording "meaningful new tokens"; the
    // semantic layer exists precisely to catch what token overlap misses.)
    assert.equal(memory.duplicate.level, 4, `got level ${memory.duplicate.level}`);
  });

  it('legitimate update: same story with a NEW identifier is level 3 and meaningful', async () => {
    const prior = {
      id: 'u-1',
      title: 'Agent sandbox vault bypass permits credential theft',
      summary: 'A new bypass lets an attacker steal credentials. CVE-2026-1001.',
      canonicalUrl: 'https://github.com/advisories/GHSA-u1',
      sourceType: 'github-advisory' as const
    };
    const provider = providerFor(null);
    const memory = getRelevantMemory(null, {
      id: 'u-2',
      title: 'Agent sandbox vault bypass now exploited in credential theft wave',
      summary: 'CVE-2026-2002 under active exploitation.',
      canonicalUrl: 'https://github.com/advisories/GHSA-u2',
      sourceType: 'github-advisory'
    }, {
      provider,
      items: [memoryItem(prior.title, prior.canonicalUrl)]
    });
    assert.equal(memory.duplicate.level, 3);
    assert.ok(memory.followUp);
    assert.equal(memory.meaningful, true, 'a new identifier is meaningful new evidence');
    assert.equal(memory.relation, 'updates');
  });

  it('unrelated stories sharing security-jargon vocabulary are NOT flagged', async () => {
    const provider = providerFor(null);
    const a = 'Critical advisory: malicious dependency in popular npm package enables supply chain attack';
    const b = 'Critical advisory: prompt injection bypass in agent tool calling allows credential theft';
    await provider.warm?.([{ title: a }, { title: b }]);
    const r = detectDuplicate(
      { title: b, summary: '', canonicalUrl: 'https://example.com/b' },
      [memoryItem(a, 'https://example.com/a')],
      provider
    );
    assert.equal(r.level, 0, `shared generic vocabulary must not look like a duplicate (got level ${r.level})`);
  });

  it('deterministic checks still fire first: exact title and URL matches win over semantics', async () => {
    const provider = providerFor(null);
    // Same normalized title as the memory item, but with a HIGH semantic
    // similarity — the title hash (level 2) must fire before level 4.
    const dupTitle = detectDuplicate(
      { title: 'Agent Sandbox Vault Bypass Permits Credential Theft!', summary: '', canonicalUrl: 'https://example.com/new' },
      [memoryItem('Agent sandbox vault bypass permits credential theft', 'https://github.com/advisories/GHSA-z1')],
      provider
    );
    assert.equal(dupTitle.level, 2);

    // Same canonical URL on an otherwise-unrelated title → level 1.
    const dupUrl = detectDuplicate(
      { title: 'Crypto coin generator raises funding', summary: '', canonicalUrl: 'https://github.com/advisories/GHSA-z1' },
      [memoryItem('Agent sandbox vault bypass permits credential theft', 'https://github.com/advisories/GHSA-z1')],
      provider
    );
    assert.equal(dupUrl.level, 1);
  });
});

describe('createSimilarityProvider factory', () => {
  const env = (vars: Record<string, string>): NodeJS.ProcessEnv => ({ NODE_ENV: 'test', ...vars });

  it('auto without a key → lexical (safe default)', () => {
    const p = createSimilarityProvider(null, env({}));
    assert.ok(p instanceof LexicalSimilarityProvider);
  });

  it('auto/embeddings with a key → the embeddings provider', () => {
    const p = createSimilarityProvider(null, env({ AETHRA_LLM_API_KEY: 'sk-test' }));
    assert.ok(p instanceof EmbeddingSimilarityProvider);
    const q = createSimilarityProvider('agent-1', env({ AETHRA_EMBEDDINGS_API_KEY: 'sk-test' }));
    assert.ok(q instanceof EmbeddingSimilarityProvider);
  });

  it('explicit embeddings without a key → lexical (documented degradation)', () => {
    const p = createSimilarityProvider(null, env({ AETHRA_SIMILARITY: 'embeddings' }));
    assert.ok(p instanceof LexicalSimilarityProvider);
  });

  it('explicit lexical and unknown modes → lexical', () => {
    assert.ok(createSimilarityProvider(null, env({ AETHRA_SIMILARITY: 'lexical' })) instanceof LexicalSimilarityProvider);
    assert.ok(createSimilarityProvider(null, env({ AETHRA_SIMILARITY: 'magic' })) instanceof LexicalSimilarityProvider);
  });

  it('createEmbeddingProvider resolves openai from either key namespace', () => {
    assert.equal(createEmbeddingProvider(env({})), null);
    const viaLlm = createEmbeddingProvider(env({ AETHRA_LLM_API_KEY: 'sk-test' }));
    assert.ok(viaLlm instanceof OpenAiEmbeddingsProvider);
    assert.equal((viaLlm as OpenAiEmbeddingsProvider).model, 'text-embedding-3-small');
    const viaOwn = createEmbeddingProvider(
      env({ AETHRA_EMBEDDINGS_API_KEY: 'sk-test', AETHRA_EMBEDDINGS_MODEL: 'embed-3' })
    );
    assert.ok(viaOwn instanceof OpenAiEmbeddingsProvider);
    assert.equal((viaOwn as OpenAiEmbeddingsProvider).model, 'embed-3');
  });
});
