// Deterministic validation of model output against the post schema.
//
// The model's output is untrusted: it may fabricate citations, invent
// statistics, or reference posts that never existed. Every claim is checked
// against the trusted context (candidate evidence, allowed URLs, known
// related posts) before the output can be recorded.

import type { Persona } from '../persona';
import type { GeneratedPost } from './types';

export interface GenerationContext {
  persona: Persona;
  candidate: {
    title: string;
    summary: string | null;
    canonicalUrl: string;
    sourceName: string;
    rawEvidence: string;
  };
  /** URLs the model is allowed to cite (candidate canonical + source URLs). */
  allowedUrls: string[];
  /** Every number the model is allowed to use (from the evidence corpus). */
  allowedNumbers: Set<string>;
  /** Titles of earlier accepted/published content (related-post references). */
  knownRelated: string[];
}

export type ValidationResult = { ok: true; post: GeneratedPost } | { ok: false; errors: string[] };

const MIN_TEXT = 300;
const MAX_TITLE = 200;

/** Every number token in a text (CVE/GHSA/arXiv ids carry their digits too). */
export function numberTokensOf(text: string): string[] {
  return [...text.matchAll(/\d+/g)].map(m => m[0]);
}

/** Extract trusted numbers from the evidence corpus. */
export function allowedNumbersOf(ctx: Pick<GenerationContext, 'candidate'>): Set<string> {
  const corpus = [
    ctx.candidate.title,
    ctx.candidate.summary ?? '',
    ctx.candidate.canonicalUrl,
    ctx.candidate.rawEvidence
  ].join(' ');
  return new Set(numberTokensOf(corpus));
}

const RATIONALE_MARKERS: Array<{ id: string; label: string; re: RegExp }> = [
  { id: 'selection', label: 'why selected', re: /selected|chosen|why this/i },
  { id: 'timeliness', label: 'why it matters now', re: /\bnow\b|current|active|recent|timeliness|ongoing/i },
  { id: 'persona-fit', label: 'persona fit', re: /persona|fit|mission|relevance|audience/i },
  { id: 'competition', label: 'why it beat competitors', re: /compet|beat|rank|versus|\bvs\b|score/i }
];

function isHttpUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\/[^\s]+$/.test(value);
}

function isString(value: unknown, min: number, max: number): value is string {
  return typeof value === 'string' && value.trim().length >= min && value.length <= max;
}

/**
 * Validate raw model output against the schema + the trusted context. Called
 * after JSON parsing/repair; returns specific, actionable errors for the
 * repair/retry path.
 */
export function validateGeneratedPost(raw: string, ctx: GenerationContext): ValidationResult {
  const errors: string[] = [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, errors: ['Output is not valid JSON.'] };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, errors: ['Output JSON must be a single object.'] };
  }
  const obj = parsed as Record<string, unknown>;

  const title = obj.title;
  if (!isString(title, 5, MAX_TITLE)) errors.push('title must be a string of 5–200 characters.');

  const text = obj.text;
  if (!isString(text, MIN_TEXT, 20_000)) errors.push(`text must be a string of at least ${MIN_TEXT} characters.`);

  const rationale = obj.rationale;
  if (!isString(rationale, 80, 5_000)) {
    errors.push('rationale must be a string of at least 80 characters.');
  } else {
    for (const marker of RATIONALE_MARKERS) {
      if (!marker.re.test(rationale)) errors.push(`rationale must explain ${marker.label} (missing "${marker.label}").`);
    }
  }

  const confidence = obj.confidence;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
    errors.push('confidence must be a number between 0 and 100.');
  }

  const citedUrls = obj.citedUrls;
  if (!Array.isArray(citedUrls) || citedUrls.length === 0) {
    errors.push('citedUrls must be a non-empty array.');
  } else {
    const allowed = new Set(ctx.allowedUrls);
    citedUrls.forEach((url, i) => {
      if (!isHttpUrl(url)) errors.push(`citedUrls[${i}] is not a URL.`);
      else if (!allowed.has(url)) errors.push(`citedUrls[${i}] is not in the trusted source set (fabricated citation): ${url}`);
    });
  }

  const relatedPosts = obj.relatedPosts;
  if (!Array.isArray(relatedPosts)) {
    errors.push('relatedPosts must be an array.');
  } else {
    const known = new Set(ctx.knownRelated);
    relatedPosts.forEach((ref, i) => {
      if (typeof ref !== 'string' || ref.trim().length === 0) errors.push(`relatedPosts[${i}] must be a non-empty string.`);
      else if (!known.has(ref.trim())) errors.push(`relatedPosts[${i}] references an unknown post (fabricated reference): ${ref}`);
    });
  }

  if (errors.length > 0) return { ok: false, errors };

  // Unsupported numerical claims: every number in the generated prose must
  // appear in the evidence corpus. Identifiers (CVE/GHSA/arXiv) are fine —
  // their digits are part of the evidence they came from.
  const textValue = text as string;
  for (const token of numberTokensOf(textValue)) {
    if (!ctx.allowedNumbers.has(token)) {
      errors.push(`Unsupported numerical claim: "${token}" does not appear in the candidate evidence.`);
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    post: {
      title: (title as string).trim(),
      text: textValue.trim(),
      rationale: (rationale as string).trim(),
      confidence: confidence as number,
      citedUrls: citedUrls as string[],
      relatedPosts: (relatedPosts as string[]).map(r => r.trim())
    }
  };
}
