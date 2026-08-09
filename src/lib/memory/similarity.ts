// Deterministic text-similarity primitives and the pluggable similarity seam.
//
// The SimilarityProvider interface is the extension point required by the
// duplicate-detection ladder's optional embeddings step. The lexical provider
// ships always (no network, no models, reproducible anywhere). An embeddings
// provider can be added behind the same interface without touching the ladder
// or the editorial engine: callers optionally `warm` the items of a batch
// (embedding them into the durable cache), and `compare` then reads vectors
// from the cache — falling back to the lexical provider whenever an embedding
// is missing or the embedder failed.

import {
  contentKey,
  cosine,
  createEmbeddingProvider,
  dbEmbeddingCache,
  type EmbeddingCache,
  type EmbeddingProvider
} from './embeddings';

export interface ContentLike {
  title: string;
  summary?: string | null;
}

/** 0..1 similarity between two content snippets; higher = more similar. */
export interface SimilarityProvider {
  readonly name: string;
  compare(a: ContentLike, b: ContentLike): number;
  /**
   * Optional async warm-up so providers that embed via network/models can
   * precompute vectors for a batch before any `compare` call. Default: no-op.
   * Implementations must never throw — failures degrade to lexical.
   */
  warm?(items: ContentLike[]): Promise<void>;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'in', 'on', 'with', 'and', 'or', 'to', 'via', 'at', 'by',
  'from', 'is', 'are', 'was', 'were', 'its', 'it', 'this', 'that', 'we', 'our', 'new',
  'into', 'over', 'under', 'about', 'against', 'between', 'after', 'before'
]);

/** Lowercase, punctuation-stripped, whitespace-collapsed canonical title. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Deterministic 32-bit FNV-1a hash of the normalized title (hex string). */
export function titleHash(title: string): string {
  let h = 0x811c9dc5;
  const norm = normalizeTitle(title);
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** Substantive lowercase tokens (drops stopwords and ≤ 2-char tokens). */
export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(w => w.length > 2 && !STOPWORDS.has(w))
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Character bigrams (Dice coefficient) — robust to word order/typos. */
export function charBigrams(text: string): Set<string> {
  const grams = new Set<string>();
  const norm = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  for (let i = 0; i < norm.length - 1; i++) {
    const gram = norm.slice(i, i + 2);
    if (gram.trim().length > 0) grams.add(gram);
  }
  return grams;
}

export function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const gram of a) {
    if (b.has(gram)) intersection += 1;
  }
  return (2 * intersection) / (a.size + b.size);
}

/**
 * Default deterministic provider: max of title-token Jaccard and char-bigram
 * Dice over title+summary. Pure function of its inputs — no randomness, no
 * wall clock, no network.
 */
export class LexicalSimilarityProvider implements SimilarityProvider {
  readonly name = 'lexical';

  compare(a: ContentLike, b: ContentLike): number {
    const titleSim = jaccard(tokenize(a.title), tokenize(b.title));
    const textA = `${a.title} ${a.summary ?? ''}`;
    const textB = `${b.title} ${b.summary ?? ''}`;
    const bigramSim = dice(charBigrams(textA), charBigrams(textB));
    return Math.max(titleSim, bigramSim);
  }
}

/**
 * Embeddings-backed provider behind the same seam. `warm` embeds a batch of
 * content into the durable (agent/persona-scoped) cache; `compare` returns
 * the cosine similarity of cached vectors and — whenever either side has no
 * cached vector (not warmed, embedder failure, model change, unknown scope) —
 * degrades to the lexical provider for that pair. Semantics can therefore
 * never block the pipeline: the ladder still runs its deterministic checks
 * first, and this step only ever adds a finding when real vectors exist.
 */
export class EmbeddingSimilarityProvider implements SimilarityProvider {
  readonly name = 'embeddings';
  readonly model: string;
  private readonly fallback: SimilarityProvider;
  /** Embed failures since construction — exposed for health/observability. */
  failures = 0;

  constructor(
    private readonly opts: {
      agentId: string | null;
      embedder: EmbeddingProvider;
      cache?: EmbeddingCache;
      fallback?: SimilarityProvider;
    }
  ) {
    this.model = opts.embedder.model;
    this.fallback = opts.fallback ?? new LexicalSimilarityProvider();
  }

  private get cache(): EmbeddingCache {
    return this.opts.cache ?? dbEmbeddingCache;
  }

  /** Embed every item missing from the cache. Never throws: a failed embed is
   *  counted and skipped, so the batch degrades per-item to lexical. Batches
   *  missing keys into single round-trips when the embedder supports it. */
  async warm(items: ContentLike[]): Promise<void> {
    const missing: Array<{ item: ContentLike; key: string }> = [];
    const queued = new Set<string>();
    for (const item of items) {
      const key = contentKey(item.title);
      if (this.cache.get(this.opts.agentId, key, this.model)) continue;
      if (queued.has(key)) continue; // duplicate within this batch
      queued.add(key);
      missing.push({ item, key });
    }
    if (missing.length === 0) return;
    const { embedder } = this.opts;
    if (embedder.embedMany) {
      for (let i = 0; i < missing.length; i += 100) {
        const chunk = missing.slice(i, i + 100);
        try {
          const vectors = await embedder.embedMany(chunk.map(c => c.item.title));
          chunk.forEach((c, j) => {
            this.cache.put(this.opts.agentId, c.key, this.model, vectors[j]);
          });
        } catch {
          this.failures += chunk.length;
        }
      }
      return;
    }
    for (const { item, key } of missing) {
      try {
        const vector = await embedder.embed(item.title);
        this.cache.put(this.opts.agentId, key, this.model, vector);
      } catch {
        this.failures += 1;
      }
    }
  }

  compare(a: ContentLike, b: ContentLike): number {
    const va = this.cache.get(this.opts.agentId, contentKey(a.title), this.model);
    const vb = this.cache.get(this.opts.agentId, contentKey(b.title), this.model);
    if (va && vb) return cosine(va, vb);
    // Unavailable (not warmed / embed failure / wrong scope): safe degradation.
    return this.fallback.compare(a, b);
  }
}

/**
 * Factory behind the seam.
 *
 *   AETHRA_SIMILARITY=auto (default) → embeddings when a key is configured
 *                                     (AETHRA_EMBEDDINGS_API_KEY or
 *                                     AETHRA_LLM_API_KEY), else lexical
 *   AETHRA_SIMILARITY=embeddings     → embeddings; WITHOUT a key this falls
 *                                     back to lexical (safe degradation, never
 *                                     a crash)
 *   AETHRA_SIMILARITY=lexical        → deterministic lexical only
 *   unknown modes                    → lexical (scoring stays reproducible)
 */
export function createSimilarityProvider(
  agentId: string | null = null,
  env: NodeJS.ProcessEnv = process.env
): SimilarityProvider {
  const mode = (env.AETHRA_SIMILARITY ?? 'auto').toLowerCase();
  if (mode === 'embeddings' || mode === 'auto') {
    const embedder = createEmbeddingProvider(env);
    if (embedder) {
      return new EmbeddingSimilarityProvider({ agentId, embedder });
    }
  }
  return new LexicalSimilarityProvider();
}
