// Deterministic scoring for the AI Security persona.
//
// Every function here is pure: the same candidate + context always yields the
// same components, total, and flags (no randomness, no wall-clock side
// effects — `now` is injected). Hard reject signals (stale/marketing/
// unsupported/duplicate) and the breaking-security override are surfaced as
// flags; the engine applies the decision rules.

import type { EditorialFlags, ScoreComponents, ScoredCandidate, ScorableCandidate } from './types';

// ---------------------------------------------------------------------------
// Persona lexicons (AI Security). Matching is deterministic prefix matching
// with word boundaries; the two shortest tokens (ai, llm) match whole words
// only to avoid false positives like "said"/"aim".
// ---------------------------------------------------------------------------

const SECURITY_TERMS = [
  'cve', 'vulnerab', 'exploit', 'security', 'injection', 'jailbreak', 'sandbox', 'bypass',
  'privilege', 'ssrf', 'rce', 'remote code', 'ransomware', 'malware', 'adversarial',
  'red team', 'threat', 'patch', 'hardening', 'authentication', 'encryption', 'data breach',
  'leak', 'backdoor', 'zero-day', 'phishing', 'denial of service', 'prompt injection',
  'guardrail', 'model extraction', 'data poisoning', 'supply chain', 'escalation',
  'exfiltration', 'tamper', 'fuzzing', 'memory safety', 'buffer overflow', 'side channel',
  'evasion', 'spoofing', 'attacker', 'attack', 'compromise', 'malicious'
];

const AI_TERMS = [
  'llm', 'model', 'agent', 'artificial intelligence', 'machine learning', 'neural', 'rag',
  'prompt', 'transformer', 'inference', 'fine-tun', 'gpt', 'token', 'embedding',
  'vector database', 'multimodal', 'training data', 'openai', 'anthropic', 'deepseek',
  'huggingface', 'ai'
];

const TECHNICAL_TERMS = [
  'bypass', 'exploit', 'patch', 'fix', 'disclos', 'advisory', 'proof of concept', 'poc',
  'downgrade', 'escalation', 'protocol', 'architecture', 'pipeline', 'benchmark',
  'evaluation', 'analysis', 'research', 'implementation', 'framework', 'library',
  'runtime', 'container', 'api', 'serialization', 'deserialization', 'isolation',
  'sandbox escape', 'command injection', 'sql injection', 'cross-site', 'csrf', 'xss',
  'heap', 'stack', 'use-after-free', 'double free', 'type confusion', 'integer overflow',
  'auth bypass', 'token theft', 'credential', 'smuggling', 'websocket', 'gateway',
  'endpoint', 'handler', 'cache', 'deserialization', 'tls', 'certificate', 'signature'
];

const MARKETING_TERMS = [
  'raises', 'funding', 'series a', 'series b', 'seed round', 'launch', 'partnership',
  'announcement', 'crowdfunding', 'kickstarter', 'coin', 'token sale', 'celebrity',
  'meme', 'viral', 'marketing', 'press release', 'million', 'billion', 'startup',
  'acquires', 'acquired', 'pre-order', 'app store', 'download', 'new app', 'wraps',
  'hype', 'subscription', 'promo', 'giveaway'
];

const DISCUSSION_TERMS = [
  'implications', 'controvers', 'debate', 'raises questions', 'trade-off', 'tradeoff',
  'future of', 'impact on', 'concern', 'risk', 'opinion', 'limitations', 'ethics',
  'policy', 'regulation', 'should', 'open question', 'critical view', 'warning',
  'unanswered', 'outlook', 'landscape', 'adoption', 'ramification'
];

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'in', 'on', 'with', 'and', 'or', 'to', 'via', 'at', 'by',
  'from', 'is', 'are', 'was', 'were', 'its', 'it', 'this', 'that', 'we', 'our', 'new'
]);

// ---------------------------------------------------------------------------
// Time windows
// ---------------------------------------------------------------------------

export const FRESH_MS = 48 * 3600_000; // full recency credit for ≤ 48h
export const STALE_MS = 30 * 24 * 3600_000; // older than 30 days → stale
export const BREAKING_FRESH_MS = 7 * 24 * 3600_000; // override requires ≤ 7 days

const SOURCE_QUALITY_BASE: Record<string, number> = {
  'cisa-kev': 12,
  'github-advisory': 11,
  'lab-feed': 10,
  arxiv: 9,
  'github-release': 7
};

const DISCUSSION_BASE: Record<string, number> = {
  arxiv: 6,
  'lab-feed': 5,
  'github-advisory': 4,
  'cisa-kev': 4,
  'github-release': 3
};

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function textOf(candidate: ScorableCandidate): string {
  return `${candidate.title} ${candidate.summary ?? ''}`;
}

export function extractCve(text: string): string | null {
  return /\b(CVE-\d{4}-\d{4,})\b/i.exec(text)?.[1] ?? null;
}

const hasCve = (text: string): boolean => extractCve(text) != null;
const hasGhsa = (text: string): boolean => /\bGHSA-[0-9A-Za-z-]{4,}\b/i.test(text);
const hasArxivId = (text: string): boolean => /arxiv\.org\/abs\/\d{4}\.\d{4,}/i.test(text);
const hasSeverityField = (raw: string): boolean => /"severity"\s*:\s*"(critical|high)"/i.test(raw);

function termPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (term === 'ai' || term === 'llm') return new RegExp(`\\b${escaped}\\b`, 'i');
  return new RegExp(`\\b${escaped}\\w*\\b`, 'i');
}

function countTermHits(text: string, terms: string[]): number {
  let hits = 0;
  for (const term of terms) {
    if (termPattern(term).test(text)) hits += 1;
  }
  return hits;
}

export function titleTokens(title: string): Set<string> {
  return new Set(
    title
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

export function maxTitleSimilarity(title: string, others: string[]): number {
  const set = titleTokens(title);
  let max = 0;
  for (const other of others) {
    max = Math.max(max, jaccard(set, titleTokens(other)));
  }
  return max;
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export interface ScoringContext {
  now: number;
  /** Titles of previously accepted candidates (novelty memory). */
  memoryTitles: string[];
  /** CVEs appearing in ≥ 2 candidates of the current batch (corroboration). */
  corroborationCves: ReadonlySet<string>;
}

export function scoreCandidate(candidate: ScorableCandidate, ctx: ScoringContext): ScoredCandidate {
  const text = textOf(candidate);
  const raw = candidate.rawEvidence;
  const summary = candidate.summary ?? '';
  const summaryLen = summary.length;
  // Identifiers (CVE/GHSA/arXiv id) legitimately live in the canonical URL or
  // raw record (e.g. a KEV entry's CVE is only in its NVD URL / cveID field),
  // so identifier detection scans the widest view, never just the prose.
  const identifierText = `${text} ${candidate.canonicalUrl} ${raw}`;

  // persona relevance (/20)
  const secHits = countTermHits(text, SECURITY_TERMS);
  const aiHits = countTermHits(text, AI_TERMS);
  const personaRelevance = Math.min(
    20,
    (secHits > 0 ? 8 : 0) + (aiHits > 0 ? 6 : 0) + Math.min(6, secHits + aiHits)
  );

  // technical / significance impact (/20)
  const techHits = countTermHits(text, TECHNICAL_TERMS);
  const technicalImpact = Math.min(
    20,
    (hasCve(identifierText) ? 8 : 0) +
      (hasGhsa(identifierText) ? 4 : 0) +
      (hasArxivId(identifierText) ? 5 : 0) +
      (hasSeverityField(raw) ? 2 : 0) +
      Math.min(4, techHits) +
      Math.min(4, Math.floor(summaryLen / 300))
  );

  // source quality / corroboration (/15)
  const cve = extractCve(identifierText);
  const sourceQuality = Math.min(
    15,
    (SOURCE_QUALITY_BASE[candidate.sourceType] ?? 8) +
      (cve && ctx.corroborationCves.has(cve) ? 3 : 0)
  );

  // recency (/15)
  const ageMs = Math.max(0, ctx.now - Date.parse(candidate.publishedAt));
  const recency =
    ageMs <= FRESH_MS
      ? 15
      : ageMs >= STALE_MS
        ? 0
        : Math.round(15 - ((ageMs - FRESH_MS) / (STALE_MS - FRESH_MS)) * 15);

  // novelty versus memory (/15)
  const sim = maxTitleSimilarity(candidate.title, ctx.memoryTitles);
  const novelty = sim >= 0.85 ? 0 : sim >= 0.6 ? 5 : sim >= 0.4 ? 10 : 15;

  // discussion value (/10)
  const discussionValue = Math.min(
    10,
    (DISCUSSION_BASE[candidate.sourceType] ?? 4) +
      Math.min(3, countTermHits(text, DISCUSSION_TERMS)) +
      (summaryLen >= 300 ? 2 : 0)
  );

  // evidence confidence (/5)
  const idCount = [hasCve(identifierText), hasGhsa(identifierText), hasArxivId(identifierText)].filter(Boolean).length;
  const structured = raw.trim().startsWith('{') || raw.trim().startsWith('[');
  const evidenceConfidence = Math.min(
    5,
    (idCount > 0 ? 2 : 0) + (hasSeverityField(raw) ? 1 : 0) + (structured ? 1 : 0) + (raw.length > 500 ? 1 : 0)
  );

  const components: ScoreComponents = {
    personaRelevance,
    technicalImpact,
    sourceQuality,
    recency,
    novelty,
    discussionValue,
    evidenceConfidence
  };
  const total =
    personaRelevance + technicalImpact + sourceQuality + recency + novelty + discussionValue + evidenceConfidence;

  // Hard-rule signals.
  const marketingHits = countTermHits(text, MARKETING_TERMS);
  const flags: EditorialFlags = {
    stale: ageMs > STALE_MS,
    marketing: marketingHits >= 2 || (marketingHits >= 1 && techHits === 0 && idCount === 0),
    unsupported: idCount === 0 && techHits <= 1 && summaryLen < 150,
    breakingSecurity:
      ageMs <= BREAKING_FRESH_MS &&
      idCount >= 1 &&
      (candidate.sourceType === 'cisa-kev' ||
        (candidate.sourceType === 'github-advisory' && hasSeverityField(raw)))
  };

  return { candidate, components, total, flags };
}
