// Deterministic, persona-driven scoring.
//
// Every function here is pure: the same candidate + context always yields the
// same components, total, and flags (no randomness, no wall-clock side
// effects — `now` is injected). The term vocabulary is sourced from the
// persona definition (Ada by default), so "topic relevance scoring" and
// "candidate rejection" are genuinely driven by the structured persona rather
// than hardcoded constants. Hard reject signals (off-persona/stale/marketing/
// unsupported/duplicate) and the breaking-security override are surfaced as
// flags; the engine applies the decision rules.

import type { Persona } from '../persona';
import { getPersona } from '../persona';
import type { RelevantMemory } from '../memory/memory';
import type { EditorialFlags, ScoreComponents, ScoredCandidate, ScorableCandidate } from './types';

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

const STOPWORDS = new Set([
  'the', 'a', 'an', 'of', 'for', 'in', 'on', 'with', 'and', 'or', 'to', 'via', 'at', 'by',
  'from', 'is', 'are', 'was', 'were', 'its', 'it', 'this', 'that', 'we', 'our', 'new'
]);

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

/** Prefix matching with word boundaries; the two shortest tokens (ai, llm)
 *  match whole words only to avoid false positives like "said"/"aim". */
function termPattern(term: string): RegExp {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (term === 'ai' || term === 'llm') return new RegExp(`\\b${escaped}\\b`, 'i');
  return new RegExp(`\\b${escaped}\\w*\\b`, 'i');
}

export function countTermHits(text: string, terms: string[]): number {
  let hits = 0;
  for (const term of terms) {
    if (termPattern(term).test(text)) hits += 1;
  }
  return hits;
}

/** Which of the persona's recurring themes a candidate touches (for memory
 *  tagging and explanations). */
export function themeHitsOf(persona: Persona, text: string): string[] {
  return persona.recurringThemes.filter(theme => termPattern(theme).test(text));
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
  /** Durable memory context (duplicate ladder + follow-up story). */
  memory?: RelevantMemory;
  /** The persona driving relevance/rejection (defaults to Ada). */
  persona?: Persona;
}

export function scoreCandidate(candidate: ScorableCandidate, ctx: ScoringContext): ScoredCandidate {
  const persona = ctx.persona ?? getPersona(null);
  const vocab = persona.vocabulary;

  const text = textOf(candidate);
  const raw = candidate.rawEvidence;
  const summary = candidate.summary ?? '';
  const summaryLen = summary.length;
  // Identifiers (CVE/GHSA/arXiv id) legitimately live in the canonical URL or
  // raw record (e.g. a KEV entry's CVE is only in its NVD URL / cveID field),
  // so identifier detection scans the widest view, never just the prose.
  const identifierText = `${text} ${candidate.canonicalUrl} ${raw}`;

  // persona relevance (/20) — driven by the persona's vocabulary.
  const secHits = countTermHits(text, vocab.securityTerms);
  const aiHits = countTermHits(text, vocab.aiTerms);
  const personaRelevance = Math.min(
    20,
    (secHits > 0 ? 8 : 0) + (aiHits > 0 ? 6 : 0) + Math.min(6, secHits + aiHits)
  );

  // technical / significance impact (/20)
  const techHits = countTermHits(text, vocab.technicalTerms);
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
      Math.min(3, countTermHits(text, vocab.discussionTerms)) +
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
  const marketingHits = countTermHits(text, vocab.marketingTerms);
  const avoidHits = countTermHits(text, vocab.avoidTerms);
  const offPersona =
    avoidHits >= 2 || (avoidHits >= 1 && secHits === 0 && aiHits === 0) || personaRelevance === 0;

  const flags: EditorialFlags = {
    stale: ageMs > STALE_MS,
    marketing: marketingHits >= 2 || (marketingHits >= 1 && techHits === 0 && idCount === 0),
    unsupported: idCount === 0 && techHits <= 1 && summaryLen < 150,
    offPersona: offPersona ? matchedAvoidTerm(text, vocab.avoidTerms) : undefined,
    breakingSecurity:
      ageMs <= BREAKING_FRESH_MS &&
      idCount >= 1 &&
      (candidate.sourceType === 'cisa-kev' ||
        (candidate.sourceType === 'github-advisory' && hasSeverityField(raw)))
  };

  // Durable-memory duplicate ladder (levels 1/2/4 = duplicate; level 3 =
  // same-story follow-up that must carry meaningful new information).
  const memory = ctx.memory;
  if (memory) {
    const { duplicate, followUp, relation, meaningful } = memory;
    if (duplicate.level === 1 && duplicate.match) {
      flags.duplicateUrl = duplicate.match.canonicalUrl;
    } else if (duplicate.level === 2 && duplicate.match) {
      flags.duplicateTitle = duplicate.match.title;
      flags.duplicateTitleSimilarity = 1;
    } else if (duplicate.level === 4 && duplicate.match) {
      flags.memoryNearDuplicate = duplicate.match.title;
    }
    if (followUp && !flags.breakingSecurity) {
      // A verified fresh high-severity advisory is meaningful new information
      // by definition — the breaking-security override handles it instead.
      if (meaningful) {
        flags.meaningfulFollowUp = { story: followUp.item.title, relation };
      } else {
        flags.followUpWithoutNewInfo = followUp.item.title;
      }
    }
  }

  return { candidate, components, total, flags };
}

function matchedAvoidTerm(text: string, avoidTerms: string[]): string | undefined {
  for (const term of avoidTerms) {
    if (termPattern(term).test(text)) return term;
  }
  return undefined;
}
