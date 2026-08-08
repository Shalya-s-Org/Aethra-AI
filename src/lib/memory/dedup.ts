// The duplicate-detection ladder (checked in order, first hit wins):
//   1. canonical source URL match          → duplicate
//   2. normalized title / hash match       → duplicate
//   3. keyword / topic overlap             → follow-up story (gate: needs
//                                            meaningful new information)
//   4. semantic similarity (embeddings seam)→ near-duplicate
//
// Levels 1/2/4 are duplicates; level 3 marks a candidate as a legitimate
// story follow-up that must clear the meaningful-new-information gate before
// it may publish. Everything here is pure and deterministic; the similarity
// provider is the only injected dependency (the embeddings seam).

import {
  jaccard,
  normalizeTitle,
  titleHash,
  tokenize,
  type ContentLike,
  type SimilarityProvider
} from './similarity';

export type DuplicateLevel = 1 | 2 | 3 | 4;

/** A durable memory item the ladder compares against. */
export interface MemoryItem extends ContentLike {
  id: string;
  canonicalUrl: string;
  kind: 'accepted' | 'post' | 'long_term' | 'editorial' | 'short_term';
}

export interface DuplicateResult {
  /** 0 = no match; 1..4 = the ladder level that fired. */
  level: DuplicateLevel | 0;
  match: MemoryItem | null;
  similarity: number;
}

/** Keyword/topic overlap above this → same story (follow-up, level 3). */
export const KEYWORD_OVERLAP_THRESHOLD = 0.5;
/** Semantic similarity above this → near-duplicate (level 4). */
export const SEMANTIC_SIM_THRESHOLD = 0.85;
/** A follow-up must introduce at least this fraction of new substantive tokens. */
export const NEW_TOKEN_FRACTION = 0.25;

const IDENTIFIER_RE =
  /\b(CVE-\d{4}-\d{4,}|GHSA-[0-9A-Za-z-]{4,}|arxiv\.org\/abs\/\d{4}\.\d{4,})\b/gi;

/** Security identifiers (CVE/GHSA/arXiv id) mentioned in a snippet. */
export function identifiersOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.matchAll(IDENTIFIER_RE)) out.add(m[1].toLowerCase());
  return out;
}

export function textOf(content: ContentLike): string {
  return `${content.title} ${content.summary ?? ''}`;
}

/**
 * The ladder. Returns the first level that fires (1 → 2 → 3 → 4), so a
 * candidate is classified by its strongest signal: URL dup, title dup,
 * same-story follow-up, or semantic near-duplicate.
 */
export function detectDuplicate(
  candidate: ContentLike & { canonicalUrl: string },
  items: MemoryItem[],
  provider: SimilarityProvider
): DuplicateResult {
  const candidateHash = titleHash(candidate.title);

  // 1. Canonical source URL match.
  for (const item of items) {
    if (item.canonicalUrl && item.canonicalUrl === candidate.canonicalUrl) {
      return { level: 1, match: item, similarity: 1 };
    }
  }

  // 2. Normalized title / hash match.
  for (const item of items) {
    if (titleHash(item.title) === candidateHash) {
      return { level: 2, match: item, similarity: 1 };
    }
  }

  // 3. Keyword / topic overlap → same story (follow-up candidate). The topic
  //    is the TITLE: shared generic summary prose is not a story signal (two
  //    unrelated advisories can reuse the same boilerplate summary), so the
  //    overlap is measured on title tokens only.
  const candidateTitleTokens = tokenize(candidate.title);
  let best: { item: MemoryItem; similarity: number } | null = null;
  for (const item of items) {
    const similarity = jaccard(candidateTitleTokens, tokenize(item.title));
    if (similarity >= KEYWORD_OVERLAP_THRESHOLD && (!best || similarity > best.similarity)) {
      best = { item, similarity };
    }
  }
  if (best) return { level: 3, match: best.item, similarity: best.similarity };

  // 4. Semantic similarity (embeddings seam; lexical provider today). Like
  //    level 3, topic identity lives in the title: shared boilerplate summary
  //    prose must not make unrelated topics look like near-duplicates, so the
  //    comparison is title-focused.
  for (const item of items) {
    const similarity = provider.compare(
      { title: candidate.title, summary: null },
      { title: item.title, summary: null }
    );
    if (similarity >= SEMANTIC_SIM_THRESHOLD) {
      return { level: 4, match: item, similarity };
    }
  }

  return { level: 0, match: null, similarity: 0 };
}

/**
 * An evolving story may only publish when the new candidate carries
 * meaningful new information: a security identifier the prior story lacks, or
 * at least NEW_TOKEN_FRACTION of its substantive tokens being new.
 */
export function hasMeaningfulNewInfo(candidate: ContentLike, prior: ContentLike): boolean {
  const candidateText = textOf(candidate);
  const priorText = textOf(prior);

  const candidateIds = identifiersOf(candidateText);
  const priorIds = identifiersOf(priorText);
  for (const id of candidateIds) {
    if (!priorIds.has(id)) return true;
  }

  const candidateTokens = tokenize(candidateText);
  const priorTokens = tokenize(priorText);
  if (candidateTokens.size === 0) return false;
  let novel = 0;
  for (const token of candidateTokens) {
    if (!priorTokens.has(token)) novel += 1;
  }
  return novel / candidateTokens.size >= NEW_TOKEN_FRACTION;
}

export type EvidenceRelation = 'confirms' | 'updates' | 'contradicts';

const CONTRADICTION_SIGNALS = [
  'not vulnerable',
  'false positive',
  'disputed',
  'dispute',
  'unaffected',
  'no evidence',
  'not exploitable',
  'debunked',
  'rejected the claim'
];

/**
 * Editorial-memory relation of new evidence to what the persona previously
 * said: contradicts (explicit dispute signals), else updates (new
 * identifiers / meaningful new information), else confirms (same identifiers,
 * corroborating).
 */
export function evidenceRelation(candidate: ContentLike, prior: ContentLike): EvidenceRelation {
  const candidateText = textOf(candidate).toLowerCase();
  const disputes = CONTRADICTION_SIGNALS.some(signal => candidateText.includes(signal));
  if (disputes) return 'contradicts';
  return hasMeaningfulNewInfo(candidate, prior) ? 'updates' : 'confirms';
}

/** Normalized subject key used to group memory around a story. */
export function memorySubject(title: string): string {
  return normalizeTitle(title);
}
