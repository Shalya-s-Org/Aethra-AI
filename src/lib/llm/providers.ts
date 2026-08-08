// LLM providers. The default is the deterministic local provider: no network,
// no randomness, reproducible anywhere — it is also the test provider. The
// OpenAI-compatible provider talks to any `/chat/completions` endpoint using
// environment variables (AETHRA_LLM_API_KEY / BASE_URL / MODEL). API keys
// never appear in logs or commits; they are read from the environment only.

import type { LlmProvider, LlmProviderResult } from './types';

const IDENTIFIER_RE = /\b(CVE-\d{4}-\d{4,}|GHSA-[0-9A-Za-z-]{4,}|arxiv\.org\/abs\/\d{4}\.\d{4,})\b/gi;

function field(user: string, label: string): string {
  const match = new RegExp(`[-*]\\s*${label}:\\s*(.*)$`, 'm').exec(user);
  return match ? match[1].trim() : '';
}

function idsOf(text: string): number {
  return [...text.matchAll(IDENTIFIER_RE)].length;
}

/**
 * Deterministic local provider. It parses the generation prompt's structured
 * sections (Candidate / Editorial memory / Competing candidates) and emits a
 * schema-valid post built ONLY from the trusted evidence — numbers, citations,
 * and references are copied from the input, never invented. Identical input
 * yields identical output.
 */
export class LocalDeterministicProvider implements LlmProvider {
  readonly name = 'local';

  async complete(system: string, user: string): Promise<LlmProviderResult> {
    void system;
    const title = field(user, 'title');
    const summary = field(user, 'summary');
    const canonicalUrl = field(user, 'canonicalUrl');
    const sourceName = field(user, 'sourceName');
    const followUpLine = field(user, 'followUp');
    const followUp = followUpLine && followUpLine !== 'none' ? followUpLine.split('(')[0].trim() : '';

    // Competing candidates: "- <title> (score N, kind)"
    const competing: Array<{ title: string; score: number }> = [];
    const inCompeting = user.includes('## Competing candidates');
    if (inCompeting) {
      const section = user.split('## Competing candidates')[1]?.split('## ')[0] ?? '';
      for (const line of section.split('\n')) {
        const m = /^[-*]\s*(.+?)\s*\(score (\d+)/.exec(line.trim());
        if (m) competing.push({ title: m[1].trim(), score: Number(m[2]) });
      }
    }
    const myScore = competing.find(c => c.title === title)?.score ?? 0;
    const sorted = [...competing].sort((a, b) => b.score - a.score);
    const rank = sorted.findIndex(c => c.title === title) + 1;

    // Identifiers in THIS candidate's own sections (Candidate block + Evidence
    // section — never the follow-up story or competing titles, whose
    // identifiers may not be in this candidate's evidence) are citable: an
    // evidence-bound draft must reference the identifiers it is about.
    const candidateBlock = user.split('## Candidate')[1]?.split('## Editorial memory')[0] ?? user;
    const evidenceSection = user.split('## Evidence')[1]?.split('## Output')[0] ?? '';
    const trustedCorpus = `${candidateBlock} ${evidenceSection}`;
    const idCount = idsOf(trustedCorpus);
    const identifiers = [...trustedCorpus.matchAll(IDENTIFIER_RE)].map(m => m[0]).slice(0, 2);
    const confidence = idCount >= 2 ? 90 : idCount === 1 ? 80 : 60;
    const certainty = confidence >= 80 ? 'high' : confidence >= 70 ? 'medium' : 'low';

    const summaryLine = summary && summary !== 'none' ? summary : 'The canonical record does not include a summary.';
    const idText = identifiers.length > 0 ? `${title} (${identifiers.join(', ')})` : title;

    // Built strictly from evidence: no invented numbers, no invented facts.
    const text = [
      `Summary. ${summaryLine}`,
      `Exploitability. The disclosed details for ${idText} describe the attack surface; the available evidence does not include an independent public proof of concept.`,
      `Blast radius. The affected component named in ${sourceName || 'the advisory'} is exposed wherever it is deployed; the disclosed details do not quantify reach.`,
      `Mitigations. The canonical advisory does not disclose a specific mitigation in the available evidence; operators should review the linked advisory for remediation guidance.`,
      `Architectural implications. This finding reinforces isolating the affected component behind a trust boundary and gating privileged operations behind explicit allowlists.`,
      `Confidence. ${certainty} confidence: this assessment is based solely on the canonical record and identifiers in the evidence.`
    ].join(' ');

    const rationale = [
      `Selected because ${title} addresses a recurring security theme for the AI ecosystem.`,
      `It matters now because the candidate is recent and reflects an ongoing concern.`,
      `It fits the persona's mission of evidence-bound, exploitability-first analysis.`,
      `It beat ${Math.max(0, competing.length - rank)} competing candidates: it ranked ${rank}${rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th'} of ${competing.length} with score ${myScore}.`
    ].join(' ');

    const post = {
      title,
      text,
      rationale,
      confidence,
      citedUrls: [canonicalUrl],
      relatedPosts: followUp ? [followUp] : []
    };

    return { ok: true, raw: JSON.stringify(post) };
  }
}

/** Reports a fixed configuration/transport problem on every call. */
export class FailingProvider implements LlmProvider {
  readonly name: string;
  constructor(readonly error: string, name = 'failing') {
    this.name = name;
  }
  async complete(): Promise<LlmProviderResult> {
    return { ok: false, error: this.error };
  }
}

export interface OpenAiProviderOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
}

/** OpenAI-compatible `/chat/completions` client (server-side fetch only). */
export class OpenAiCompatibleProvider implements LlmProvider {
  readonly name = 'openai-compatible';

  constructor(private readonly opts: OpenAiProviderOptions) {}

  async complete(system: string, user: string, opts?: { timeoutMs?: number }): Promise<LlmProviderResult> {
    const controller = new AbortController();
    const timeoutMs = opts?.timeoutMs ?? this.opts.timeoutMs ?? 30_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const baseUrl = this.opts.baseUrl ?? 'https://api.openai.com/v1';
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.opts.apiKey}`
        },
        body: JSON.stringify({
          model: this.opts.model ?? 'gpt-4o-mini',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.2,
          max_tokens: 1_500
        }),
        signal: controller.signal
      });
      if (!res.ok) {
        const detail = (await res.text()).slice(0, 200);
        return { ok: false, error: `LLM API ${res.status}: ${detail}` };
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || content.trim().length === 0) {
        return { ok: false, error: 'LLM API returned empty content.' };
      }
      return { ok: true, raw: content };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: `LLM request failed: ${message}` };
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Factory. Default provider is 'local' (deterministic, no network). Any other
 * mode requires AETHRA_LLM_API_KEY; a missing key yields a failing provider so
 * the caller's failure path (rejected decision, no weak content) is uniform.
 */
export function createLlmProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  const mode = (env.AETHRA_LLM_PROVIDER ?? 'local').toLowerCase();
  if (mode === 'local' || mode === '') return new LocalDeterministicProvider();
  const apiKey = env.AETHRA_LLM_API_KEY;
  if (!apiKey) {
    return new FailingProvider(`AETHRA_LLM_API_KEY is not set (required for provider "${mode}").`);
  }
  return new OpenAiCompatibleProvider({
    apiKey,
    baseUrl: env.AETHRA_LLM_BASE_URL,
    model: env.AETHRA_LLM_MODEL,
    timeoutMs: Number(env.AETHRA_LLM_TIMEOUT_MS ?? 30_000)
  });
}
