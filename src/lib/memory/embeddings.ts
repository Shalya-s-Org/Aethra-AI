// Optional embeddings backend for the duplicate ladder's level-4 semantic
// step. Everything behind the EmbeddingProvider interface is async (network /
// model calls); the SimilarityProvider seam in ./similarity.ts stays
// synchronous by reading from the durable embeddings cache (warmed once per
// editorial run). When no embedder is configured, or one fails, callers
// degrade to the deterministic lexical checks — the ladder order (URL → title
// → keyword → semantic) guarantees embeddings can never override a stronger
// finding.

import { createHash } from 'node:crypto';
import { getEmbedding, upsertEmbedding } from '../db';
import { normalizeTitle } from './similarity';

/** 0..1 cosine similarity between two vectors. */
export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Deterministic cache key for a content snippet. The semantic comparison is
 * TITLE-focused (mirroring the ladder's level-3/4 philosophy — shared
 * boilerplate summary prose must not make unrelated topics look alike), so the
 * key is derived from the normalized title only. sha256 avoids the 32-bit
 * titleHash collision risk on a durable cache key.
 */
export function contentKey(text: string): string {
  return createHash('sha256').update(normalizeTitle(text)).digest('hex');
}

/** An embedding model: turns text into a fixed-dimension float vector. */
export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  /** Embed a single snippet of text. Throws on failure (caller degrades). */
  embed(text: string): Promise<number[]>;
  /**
   * Batch embed (one API round-trip). Optional — callers fall back to
   * per-item `embed` calls when absent. Throws on failure (caller degrades).
   */
  embedMany?(texts: string[]): Promise<number[][]>;
}

/**
 * OpenAI-compatible `/embeddings` client. Reads the same deployment secrets
 * convention as the LLM provider: AETHRA_EMBEDDINGS_* override their
 * AETHRA_LLM_* counterparts, so a single OpenAI-compatible deployment can
 * serve both chat and embeddings without extra config.
 */
export class OpenAiEmbeddingsProvider implements EmbeddingProvider {
  readonly name = 'openai-embeddings';
  readonly model: string;

  constructor(
    private readonly opts: {
      apiKey: string;
      baseUrl?: string;
      model?: string;
      timeoutMs?: number;
    }
  ) {
    this.model = opts.model ?? 'text-embedding-3-small';
  }

  async embed(text: string): Promise<number[]> {
    const baseUrl = (this.opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 30_000);
    try {
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.opts.apiKey}`
        },
        body: JSON.stringify({ model: this.model, input: text }),
        signal: controller.signal
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        throw new Error(`embeddings API ${res.status}: ${detail}`);
      }
      const data = (await res.json()) as { data?: Array<{ embedding?: unknown }> };
      const vector = data.data?.[0]?.embedding;
      if (!Array.isArray(vector) || vector.length === 0) {
        throw new Error('embeddings API returned an empty vector.');
      }
      return vector.map(Number);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Batch embed: one request with the full input array; results keep order. */
  async embedMany(texts: string[]): Promise<number[][]> {
    const baseUrl = (this.opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 30_000);
    try {
      const res = await fetch(`${baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.opts.apiKey}`
        },
        body: JSON.stringify({ model: this.model, input: texts }),
        signal: controller.signal
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        throw new Error(`embeddings API ${res.status}: ${detail}`);
      }
      const data = (await res.json()) as { data?: Array<{ embedding?: unknown }> };
      const vectors = (data.data ?? []).map(d => d.embedding);
      if (
        vectors.length !== texts.length ||
        vectors.some(v => !Array.isArray(v) || v.length === 0)
      ) {
        throw new Error('embeddings API returned a mismatched or empty batch.');
      }
      return vectors.map(v => (v as number[]).map(Number));
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Resolve the configured embedder, or null when unavailable. Resolution:
 *   AETHRA_EMBEDDINGS_PROVIDER=openai → OpenAI-compatible (requires a key);
 *   unset/auto                      → openai when a key is present, else null;
 *   a key present with no provider   → openai (same convention as the LLM).
 * A null result means callers use the deterministic lexical provider — the
 * documented safe degradation, never a crash.
 */
export function createEmbeddingProvider(
  env: NodeJS.ProcessEnv = process.env
): EmbeddingProvider | null {
  let mode = (env.AETHRA_EMBEDDINGS_PROVIDER ?? '').toLowerCase();
  if (mode === '' || mode === 'auto') {
    mode = env.AETHRA_EMBEDDINGS_API_KEY || env.AETHRA_LLM_API_KEY ? 'openai' : '';
  }
  if (mode !== 'openai') return null;
  const apiKey = env.AETHRA_EMBEDDINGS_API_KEY ?? env.AETHRA_LLM_API_KEY;
  if (!apiKey) return null;
  return new OpenAiEmbeddingsProvider({
    apiKey,
    baseUrl: env.AETHRA_EMBEDDINGS_BASE_URL ?? env.AETHRA_LLM_BASE_URL,
    model: env.AETHRA_EMBEDDINGS_MODEL,
    timeoutMs: Number(env.AETHRA_EMBEDDINGS_TIMEOUT_MS ?? 30_000)
  });
}

/** The scope-aware cache facade used by the similarity provider. */
export interface EmbeddingCache {
  get(agentId: string | null, contentKey: string, model: string): number[] | null;
  put(agentId: string | null, contentKey: string, model: string, vector: number[]): void;
}

/** Durable cache backed by the embeddings table (agent/persona scope). */
export const dbEmbeddingCache: EmbeddingCache = {
  get(agentId, key, model) {
    const row = getEmbedding(agentId, key, model);
    return row ? row.vector : null;
  },
  put(agentId, key, model, vector) {
    upsertEmbedding({ agentId, contentKey: key, model, vector, nowMs: Date.now() });
  }
};
