// Server-side LLM integration types. Providers are interchangeable: a
// deterministic local provider (default, no network) and an OpenAI-compatible
// HTTP provider behind environment variables. Generated output is validated
// by a strict schema (see schema.ts) before anything is recorded.

/** The structured output a model must produce for a post. */
export interface GeneratedPost {
  title: string;
  text: string;
  rationale: string;
  /** 0..100, calibrated by evidence confidence. */
  confidence: number;
  /** Must be a subset of the allowed (trusted) source URLs. */
  citedUrls: string[];
  /** References to earlier posts/decisions that actually exist in memory. */
  relatedPosts: string[];
}

export type LlmProviderResult = { ok: true; raw: string } | { ok: false; error: string };

export interface LlmProvider {
  readonly name: string;
  /**
   * Complete a system+user prompt pair and return raw model output. Transport
   * failures (timeout, auth, network) are reported as { ok: false } — they are
   * the caller's failure path, never thrown.
   */
  complete(system: string, user: string, opts?: { timeoutMs?: number }): Promise<LlmProviderResult>;
}
