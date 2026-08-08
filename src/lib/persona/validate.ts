// Final post quality validation. A finished post (LLM-written or otherwise)
// is checked against the persona's post structure and style rules before it
// can be considered publishable. Deterministic and pure.

import type { Persona } from './types';

export interface QualityCheck {
  id: string;
  label: string;
  passed: boolean;
  required: boolean;
  detail: string;
}

export interface PostQualityReport {
  valid: boolean;
  score: number; // 0..1
  checks: QualityCheck[];
}

export interface PostDraft {
  title: string;
  text: string;
  rationale?: string | null;
  opinion?: string | null;
}

const IDENTIFIER_RE = /\b(CVE-\d{4}-\d{4,}|GHSA-[0-9A-Za-z-]{4,}|arxiv\.org\/abs\/\d{4}\.\d{4,})\b/i;
// 6+ consecutive capitals catches genuine ALL-CAPS hype (INSANE, REVOLUTIONARY)
// without false-positiving on identifiers (GHSA/CVE) or acronyms (HTTPS/CVSS).
const HYPE_RE = /(!{2,}|[A-Z]{6,})/;

/**
 * Validate a finished post against the persona. Required checks must all pass
 * for the post to be valid; persona sections that are not marked required are
 * reported but do not fail the post.
 */
export function validatePost(persona: Persona, post: PostDraft): PostQualityReport {
  const checks: QualityCheck[] = [];
  const text = `${post.title} ${post.text} ${post.rationale ?? ''} ${post.opinion ?? ''}`.trim();

  // 1. Structure: title + body depth.
  checks.push({
    id: 'title',
    label: 'Title present',
    passed: post.title.trim().length >= 10,
    required: true,
    detail: post.title.trim().length >= 10 ? 'Title is substantive.' : 'Title is missing or too short.'
  });
  checks.push({
    id: 'depth',
    label: 'Technical depth',
    passed: post.text.trim().length >= 300,
    required: true,
    detail: `${post.text.trim().length} chars of body (need ≥ 300 for technical depth).`
  });

  // 2. Persona sections (required ones must appear; recommended ones are reported).
  for (const section of persona.postStructure) {
    if (section.id === 'title') continue; // covered above
    const present = section.terms.length === 0 || section.terms.some(t => text.toLowerCase().includes(t));
    checks.push({
      id: `section:${section.id}`,
      label: `Section: ${section.label}`,
      passed: present,
      required: !!section.required,
      detail: present
        ? `Section content detected.`
        : `Section "${section.label}" not detected (looks for: ${section.terms.join(', ')}).`
    });
  }

  // 3. Evidence-bound: identifier or calibrated uncertainty must be present.
  const hasIdentifier = IDENTIFIER_RE.test(text);
  const hasUncertainty = persona.confidenceRules.uncertaintyPhrases.some(p => text.toLowerCase().includes(p));
  checks.push({
    id: 'evidence',
    label: 'Evidence-bound',
    passed: hasIdentifier || hasUncertainty,
    required: true,
    detail: hasIdentifier
      ? 'Carries an identifier (CVE/GHSA/arXiv id).'
      : hasUncertainty
        ? 'No identifier, but explicitly calibrated uncertainty is present.'
        : 'No identifier and no uncertainty statement — claims are unsupported.'
  });

  // 4. Calm, hype-free style.
  const hypeHits = persona.vocabulary.styleAvoid.filter(t => text.toLowerCase().includes(t));
  const hasHype = hypeHits.length > 0 || HYPE_RE.test(text);
  checks.push({
    id: 'style',
    label: 'Calm, hype-free style',
    passed: !hasHype,
    required: true,
    detail: hasHype
      ? `Hype detected: ${hypeHits.join(', ') || 'exclamation marks or ALL-CAPS'}.`
      : 'Calm, measured prose.'
  });

  const required = checks.filter(c => c.required);
  const passedCount = checks.filter(c => c.passed).length;
  return {
    valid: required.every(c => c.passed),
    score: checks.length === 0 ? 1 : passedCount / checks.length,
    checks
  };
}
