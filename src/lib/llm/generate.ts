// LLM post generation orchestration.
//
// Flow per candidate: build the trusted prompt (persona system prompt +
// normalized candidate evidence + editorial memory + competing candidates),
// call the provider, repair malformed JSON, validate strictly against the
// schema (fabricated citations, invented numbers, unknown references are all
// rejected), and on failure retry ONCE with the validator's errors as
// corrective feedback. If validation still fails, the outcome is a failure —
// the caller records a rejected decision rather than publishing weak content.
//
// The provider is injectable; the default is the deterministic local provider
// (no network), so this module is fully testable offline.

import type { Persona } from '../persona';
import { buildGenerationPrompt, type CompetingCandidate } from '../persona/prompt';
import {
  allowedNumbersOf,
  validateGeneratedPost,
  type GenerationContext
} from './schema';
import { createLlmProvider } from './providers';
import type { GeneratedPost, LlmProvider } from './types';

export interface GenerationInput {
  persona: Persona;
  candidate: {
    title: string;
    summary: string | null;
    canonicalUrl: string;
    sourceName: string;
    rawEvidence: string;
  };
  /** Same-story follow-up (title must match a known related post). */
  followUp?: { story: string; relation: 'confirms' | 'updates' | 'contradicts' };
  /** Persona themes this item touches (from memory retrieval). */
  themes: string[];
  /** Other candidates of the batch, for the "why it beat them" rationale. */
  competing: CompetingCandidate[];
  /** Opening phrasings of recently generated posts — the writer must avoid
   *  reusing them (the local provider picks a pattern that differs; the LLM
   *  is told to choose a different opening). */
  recentOpenings?: string[];
  /** Defaults to createLlmProvider() (deterministic local, no network). */
  provider?: LlmProvider;
  /** Corrective retries after schema validation failure. Default 1. */
  maxRetries?: number;
}

export type GenerationOutcome =
  | { ok: true; post: GeneratedPost; raw: string }
  | { ok: false; error: string };

/** https URLs inside the raw evidence, usable as trusted citations. */
function sourceUrlsOf(rawEvidence: string, canonicalUrl: string): string[] {
  const urls = [...rawEvidence.matchAll(/https?:\/\/[^\s"'<>)\]]+/g)].map(m =>
    m[0].replace(/[.,;:]+$/, '')
  );
  return [canonicalUrl, ...urls.filter(u => u.startsWith('https://'))];
}

function buildContext(input: GenerationInput): GenerationContext {
  const knownRelated = input.followUp ? [input.followUp.story] : [];
  return {
    persona: input.persona,
    candidate: input.candidate,
    allowedUrls: sourceUrlsOf(input.candidate.rawEvidence, input.candidate.canonicalUrl),
    allowedNumbers: allowedNumbersOf({ candidate: input.candidate }),
    knownRelated
  };
}

/**
 * Repair common malformed-JSON shapes from models: markdown fences, prose
 * around the object, and trailing commas. Returns a JSON-parseable string, or
 * null when no repair helps. Validation runs on the REPAIRED string, so a
 * repaired output is validated, not re-parsed from the broken original.
 */
export function repairJsonString(raw: string): string | null {
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    // fall through to repair
  }

  // Strip ```json ... ``` fences (and bare ``` ```).
  let candidate = raw.replace(/```(?:json)?\s*/gi, '').replace(/```/g, '');
  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidate = candidate.slice(firstBrace, lastBrace + 1);
  }

  // Trailing commas before } or ] (the most common model JSON error).
  candidate = candidate.replace(/,\s*([}\]])/g, '$1');

  try {
    JSON.parse(candidate);
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Generate a schema-valid post for one candidate. Never throws: every failure
 * (transport, malformed output, validation) is reported as { ok: false } so
 * the caller can record a rejected decision.
 */
export async function generatePost(input: GenerationInput): Promise<GenerationOutcome> {
  const provider = input.provider ?? createLlmProvider();
  const { system, user } = buildGenerationPrompt(input.persona, {
    candidate: input.candidate,
    followUp: input.followUp,
    themes: input.themes,
    competing: input.competing,
    recentOpenings: input.recentOpenings
  });

  const maxRetries = input.maxRetries ?? 1;
  let attempts = 0;
  let lastErrors: string[] = [];

  let prompt = user;
  while (attempts <= maxRetries) {
    attempts += 1;
    const result = await provider.complete(system, prompt);
    if (!result.ok) {
      return { ok: false, error: `Provider error: ${result.error}` };
    }

    const repaired = repairJsonString(result.raw);
    if (repaired === null) {
      lastErrors = ['Output could not be parsed as JSON after repair.'];
    } else {
      const validation = validateGeneratedPost(repaired, buildContext(input));
      if (validation.ok) {
        return { ok: true, post: validation.post, raw: repaired };
      }
      lastErrors = validation.errors;
    }

    // Corrective retry: hand the validator's errors back as feedback.
    prompt =
      user +
      `\n\n## Correction required\nYour previous response failed validation. Fix exactly these problems and respond again with ONLY the JSON object:\n- ${lastErrors.join('\n- ')}`;
  }

  return {
    ok: false,
    error: `Output failed schema validation after ${attempts} attempt(s): ${lastErrors.join('; ')}`
  };
}
