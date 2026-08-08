// Deterministic text-similarity primitives and the pluggable similarity seam.
//
// The SimilarityProvider interface is the extension point required by the
// duplicate-detection ladder's optional embeddings step: today only the
// deterministic lexical provider ships (no network, no models, reproducible
// anywhere); a real embeddings provider can be added behind the same
// interface without touching the ladder or the editorial engine.

export interface ContentLike {
  title: string;
  summary?: string | null;
}

/** 0..1 similarity between two content snippets; higher = more similar. */
export interface SimilarityProvider {
  readonly name: string;
  compare(a: ContentLike, b: ContentLike): number;
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

/** Factory behind the seam. Only 'lexical' ships today; a future embeddings
 *  provider registers here without changing callers. */
export function createSimilarityProvider(): SimilarityProvider {
  const mode = (process.env.AETHRA_SIMILARITY ?? 'lexical').toLowerCase();
  if (mode === 'lexical' || mode === '') return new LexicalSimilarityProvider();
  // Unknown modes degrade to the deterministic provider rather than failing:
  // scoring must stay reproducible everywhere.
  return new LexicalSimilarityProvider();
}
