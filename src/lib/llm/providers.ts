// LLM providers. The default is the deterministic local provider: no network,
// no randomness, reproducible anywhere — it is also the test provider. The
// OpenAI-compatible provider talks to any `/chat/completions` endpoint using
// environment variables (AETHRA_LLM_API_KEY / BASE_URL / MODEL). API keys
// never appear in logs or commits; they are read from the environment only.

import type { LlmProvider, LlmProviderResult } from './types';
import type { PersonaWritingPatterns } from '../persona';
import { getPersona } from '../persona';
import { jaccard, tokenize } from '../memory/similarity';

const IDENTIFIER_RE = /\b(CVE-\d{4}-\d{4,}|GHSA-[0-9A-Za-z-]{4,}|arxiv\.org\/abs\/\d{4}\.\d{4,})\b/gi;

function field(user: string, label: string): string {
  const match = new RegExp(`[-*]\\s*${label}:\\s*(.*)$`, 'm').exec(user);
  return match ? match[1].trim() : '';
}

function idsOf(text: string): number {
  return [...text.matchAll(IDENTIFIER_RE)].length;
}

/** FNV-1a — a stable hash for deterministic pattern selection per candidate. */
function stableHash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function fillPattern(pattern: string, item: string): string {
  return pattern.replace(/\{item\}/g, item);
}

function maxTokenSimilarity(value: string, against: string[]): number {
  const tokens = tokenize(value);
  if (tokens.size === 0) return 0;
  let best = 0;
  for (const other of against) {
    best = Math.max(best, jaccard(tokens, tokenize(other)));
  }
  return best;
}

/**
 * Deterministically pick a pattern: prefer the one LEAST similar to the
 * recently used openings (so consecutive posts never repeat), tie-broken by a
 * stable hash of the candidate (so the same candidate always picks the same
 * pattern) and finally by list order.
 */
function pickPattern(
  patterns: string[],
  avoid: string[],
  item: string,
  seed: string
): { text: string; index: number } {
  const ranked = patterns
    .map((pattern, index) => ({
      text: fillPattern(pattern, item),
      index,
      sim: maxTokenSimilarity(fillPattern(pattern, item), avoid)
    }))
    .sort(
      (a, b) =>
        a.sim - b.sim ||
        stableHash(`${seed}:${a.index}`) - stableHash(`${seed}:${b.index}`) ||
        a.index - b.index
    );
  return { text: ranked[0].text, index: ranked[0].index };
}

/** Recent openings the writer must not reuse — parsed from the prompt. */
function recentOpeningsOf(user: string): string[] {
  const section = user.split('## Openings to avoid')[1]?.split('## Evidence')[0] ?? '';
  return section
    .split('\n')
    .map(l => /^[-*]\s*(.+)$/.exec(l.trim())?.[1]?.trim() ?? '')
    .filter(s => s.length > 0 && s !== 'none');
}

/** The persona's approved writing patterns, parsed from the system prompt (so
 *  the provider always uses the SAME persona the prompt was built for). Falls
 *  back to the default persona's patterns if the section is absent. */
function writingPatternsOf(system: string): PersonaWritingPatterns {
  const section =
    system.split('## Approved writing patterns')[1]?.split('## Required post structure')[0] ?? '';
  if (!section.trim()) return getPersona(null).writingPatterns;
  const bullets = (s: string): string[] =>
    [...s.matchAll(/^[-*]\s+(.+)$/gm)].map(m => m[1].trim()).filter(Boolean);
  const parts = section.split(
    /\n(?:Open with exactly ONE of these openings|Vary the section transitions among these|Close with one of these)/
  );
  const patterns = {
    openings: bullets(parts[1] ?? ''),
    transitions: bullets(parts[2] ?? ''),
    closings: bullets(parts[3] ?? '')
  };
  // Robustness: if parsing drifted, fall back to the default persona.
  return patterns.openings.length > 0 && patterns.transitions.length > 0 && patterns.closings.length > 0
    ? patterns
    : getPersona(null).writingPatterns;
}

/**
 * Deterministic local provider (tests / offline fallback ONLY). It parses the
 * generation prompt's structured sections (Candidate / Editorial memory /
 * Competing candidates / Openings to avoid) and emits a schema-valid post
 * built ONLY from the trusted evidence — numbers, citations, and references
 * are copied from the input, never invented. Openings, transitions, and
 * closings are drawn from the persona's approved writing patterns, selected
 * deterministically per candidate and avoiding recently used openings, so
 * output is varied across posts yet reproducible for identical input.
 */
export class LocalDeterministicProvider implements LlmProvider {
  readonly name = 'local';

  async complete(system: string, user: string): Promise<LlmProviderResult> {
    const patterns = writingPatternsOf(system);
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
    // Short reference for the writing-pattern slots: identifiers if present,
    // otherwise a trimmed title fragment.
    const item =
      identifiers.length > 0 ? identifiers.join(', ') : title.length > 60 ? `${title.slice(0, 60)}…` : title;
    const idText = identifiers.length > 0 ? `${title} (${identifiers.join(', ')})` : title;

    // Writing-pattern selection: deterministic per candidate (stable hash of
    // the canonical URL), and the opening deliberately AVOIDS recently used
    // openings so consecutive posts never repeat a framing. Two distinct
    // transitions and one closing are picked per candidate.
    const avoid = recentOpeningsOf(user);
    const opening = pickPattern(patterns.openings, avoid, item, canonicalUrl);
    const transitionSeed = (t: number) => `${canonicalUrl}#t${t}`;
    const t1 = pickPattern(patterns.transitions, [], item, transitionSeed(1));
    let t2 = pickPattern(patterns.transitions, [], item, transitionSeed(2));
    if (t2.index === t1.index) {
      t2 = pickPattern(patterns.transitions, [], item, transitionSeed(2) + 'x');
    }
    const closing = pickPattern(patterns.closings, [], item, `${canonicalUrl}#c`);

    // Built strictly from evidence: no invented numbers, no invented facts.
    // Every required stage is labeled (Summary / Exploitability / Blast radius /
    // Mitigations / Architectural implications / Confidence) and the
    // architectural section carries an explicit recommendation.
    const text = [
      `${opening.text} Summary. ${summaryLine}`,
      `${t1.text} Exploitability. The disclosed details for ${idText} describe the attack surface; the available evidence does not include an independent public proof of concept.`,
      `Blast radius. The affected component named in ${sourceName || 'the advisory'} is exposed wherever it is deployed; the disclosed details do not quantify reach.`,
      `${t2.text} Mitigations. The canonical advisory does not disclose a specific mitigation in the available evidence; operators should review the linked advisory for remediation guidance.`,
      `Architectural implications. Operators should isolate the affected component behind a trust boundary and gate privileged operations behind explicit allowlists.`,
      `${closing.text} Confidence. ${certainty} confidence: this assessment is based solely on the canonical record and identifiers in the evidence.`
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
 * Factory.
 *
 *   AETHRA_LLM_PROVIDER=local  → deterministic local provider (TESTS / OFFLINE
 *                                FALLBACK only — never deploy with this).
 *   AETHRA_LLM_PROVIDER=openai → OpenAI-compatible /chat/completions provider
 *                                (requires AETHRA_LLM_API_KEY).
 *   unset (auto)               → openai when a key is present (deployed
 *                                production) or when NODE_ENV=production (a
 *                                missing key then yields a FAILING provider, so
 *                                production never silently emits deterministic
 *                                template output); local otherwise (dev/tests
 *                                without a key).
 *
 * A missing key with a non-local mode yields a failing provider so the caller's
 * failure path (rejected decision, no weak content) is uniform — never a
 * silent fallback to the deterministic writer in production.
 */
export function createLlmProvider(env: NodeJS.ProcessEnv = process.env): LlmProvider {
  let mode = (env.AETHRA_LLM_PROVIDER ?? '').toLowerCase();
  if (mode === '' || mode === 'auto') {
    mode = env.NODE_ENV === 'production' || Boolean(env.AETHRA_LLM_API_KEY) ? 'openai' : 'local';
  }
  if (mode === 'local') return new LocalDeterministicProvider();
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
