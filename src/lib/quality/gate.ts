// Pre-publication quality gate.
//
// Runs on a schema-validated generated draft (post-generation, pre-publication)
// and decides pass / hold / reject:
//   reject — content is defective and will not improve on retry (fabricated or
//            non-HTTPS citations, unsupported claims, marketing, persona
//            exclusions, repeated framing, broken structure).
//   hold   — content is usable in principle but not yet publishable (missing a
//            concrete implication, low confidence, weak source quality, exceeds
//            the concise format, ignores relevant memory); the pipeline retries
//            it next run.
//   pass   — publishable.
//
// Deterministic and pure: identical inputs yield identical verdicts.

import type { Persona } from '../persona';
import type { GeneratedPost } from '../llm/types';
import { allowedNumbersOf } from '../llm/schema';
import { jaccard, normalizeTitle, tokenize } from '../memory/similarity';

export type QualityVerdict = 'pass' | 'hold' | 'reject';

export interface QualityCheckResult {
  id: string;
  label: string;
  passed: boolean;
  /** Failing required checks reject the draft; failing polish checks hold it. */
  required: boolean;
  detail: string;
}

export interface QualityGateReport {
  verdict: QualityVerdict;
  /** Fraction of checks passed (0..1). */
  score: number;
  checks: QualityCheckResult[];
  /** Human-readable list of the failures behind the verdict. */
  reasons: string[];
}

export interface QualityGateInput {
  persona: Persona;
  candidate: {
    title: string;
    summary: string | null;
    canonicalUrl: string;
    sourceName: string;
    rawEvidence: string;
  };
  draft: GeneratedPost;
  /** Same-story follow-up from editorial memory (only when relevant). */
  followUp?: { story: string; relation: 'confirms' | 'updates' | 'contradicts' };
  /** Titles of recently accepted/generated content (framing check). */
  recentTitles: string[];
  /** Opening sentences of recently generated drafts (variation check). */
  recentOpenings: string[];
  /** Editorial source-quality component (0..15); unknown → null. */
  sourceQualityScore?: number | null;
}

const IDENTIFIER_RE = /\b(CVE-\d{4}-\d{4,}|GHSA-[0-9A-Za-z-]{4,}|arxiv\.org\/abs\/\d{4}\.\d{4,})\b/i;
const HYPE_RE = /(!{2,}|[A-Z]{6,})/;

// "Concise post format": Ada's posts are tight; anything far beyond this was
// not the requested format.
const CONCISE_MAX_CHARS = 2000;
const CONFIDENCE_MIN = 60;
const SOURCE_QUALITY_MIN = 8; // out of 15

const FRAME_SIM_THRESHOLD = 0.85;
const OPENING_SIM_THRESHOLD = 0.75;

const URL_RE = /https?:\/\/[^\s"'<>)\]]+/g;

// A concrete security/architecture recommendation: an actionable imperative
// (should/must/recommend/… ) aimed at a concrete action (isolate, upgrade,
// patch, gate, restrict, …). Both halves are required — a generic "operators
// should be careful" carries no recommendation.
const RECOMMENDATION_VERB_RE = /(should|must|we recommend|we advise|we urge|adopt|require|consider)/i;
const RECOMMENDATION_ACTIONS = [
  'isolate', 'upgrade', 'patch', 'gate', 'restrict', 'enforce', 'audit',
  'disable', 'validate', 'allowlist', 'least privilege', 'sandbox',
  'remediate', 'monitor', 'deprecate', 'review', 're-architect', 'verify'
];

/** https URLs inside the evidence corpus the draft is allowed to cite. */
export function evidenceUrlsOf(rawEvidence: string, canonicalUrl: string): string[] {
  const urls = [...rawEvidence.matchAll(URL_RE)].map(m =>
    m[0].replace(/[.,;:]+$/, '')
  );
  return [canonicalUrl, ...urls.filter(u => u.startsWith('https://'))];
}

/** All URLs (https or not) appearing in the draft's prose + citations. */
function draftUrlsOf(draft: GeneratedPost): string[] {
  const cited = draft.citedUrls;
  const embedded = [...`${draft.title} ${draft.text} ${draft.rationale}`.matchAll(URL_RE)].map(
    m => m[0].replace(/[.,;:]+$/, '')
  );
  return [...new Set([...cited, ...embedded])];
}

/**
 * The draft's opening, skipping label-only fragments (e.g. a "Summary."
 * section header emitted as its own sentence) and extending to the first
 * substantive sentence. Used by the variation check and the engine's
 * recent-openings collection.
 */
export function openingOf(text: string): string {
  const sentences = text.match(/[^.!?]+[.!?]+/g) ?? [];
  let acc = '';
  for (const s of sentences) {
    acc = acc ? `${acc} ${s}` : s;
    if (tokenize(acc).size >= 3) break;
  }
  return (acc || text.trim().slice(0, 120)).trim().slice(0, 200);
}

function maxSimilarity(value: string, against: string[]): number {
  const tokens = tokenize(normalizeTitle(value));
  let best = 0;
  for (const other of against) {
    const otherTokens = tokenize(normalizeTitle(other));
    const sim = jaccard(tokens, otherTokens);
    if (sim > best) best = sim;
  }
  return best;
}

/** Fraction of a's tokens that appear in b (a is a subset/prefix of b → 1). */
function containment(a: Set<string>, b: Set<string>): number {
  if (a.size === 0) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit += 1;
  return hit / a.size;
}

/**
 * Run the quality gate on a generated draft. The draft has already passed
 * llm/schema validation (citations ⊆ allowed set, numbers ⊆ evidence) — this
 * gate re-checks against the *retrieved evidence* and adds the persona-level
 * originality, structure, format, and confidence checks.
 */
export function runQualityGate(input: QualityGateInput): QualityGateReport {
  const { persona, draft } = input;
  const checks: QualityCheckResult[] = [];
  const text = `${draft.title} ${draft.text} ${draft.rationale}`;

  const evidenceUrls = new Set(evidenceUrlsOf(input.candidate.rawEvidence, input.candidate.canonicalUrl));
  const allowedNumbers = allowedNumbersOf({ candidate: input.candidate });

  // 1. URL hygiene: every cited/embedded URL must be https and well-formed.
  const urls = draftUrlsOf(draft);
  const malformed = urls.filter(u => !/^https:\/\/[^\s]+$/.test(u));
  checks.push({
    id: 'urls-https',
    label: 'HTTPS, well-formed URLs',
    passed: malformed.length === 0,
    required: true,
    detail:
      malformed.length === 0
        ? 'All cited and embedded URLs are https and well-formed.'
        : `Non-HTTPS or malformed URLs: ${malformed.join(', ')}.`
  });

  // 2. Citations must come from the retrieved source evidence.
  const fabricated = urls.filter(u => !evidenceUrls.has(u));
  checks.push({
    id: 'citations-evidence',
    label: 'Citations in retrieved evidence',
    passed: fabricated.length === 0,
    required: true,
    detail:
      fabricated.length === 0
        ? 'Every cited/embedded URL is present in the retrieved source evidence.'
        : `Citations not in the retrieved source evidence: ${fabricated.join(', ')}.`
  });

  // 3. Unsupported claims: digits must come from the evidence; the draft must
  //    carry an identifier or calibrated uncertainty.
  const unsupportedNumbers = [...draft.text.matchAll(/\d+/g)]
    .map(m => m[0])
    .filter(t => !allowedNumbers.has(t));
  const hasIdentifier = IDENTIFIER_RE.test(text);
  const hasUncertainty = persona.confidenceRules.uncertaintyPhrases.some(p =>
    text.toLowerCase().includes(p)
  );
  checks.push({
    id: 'claims-evidence',
    label: 'Evidence-bound claims',
    passed: unsupportedNumbers.length === 0 && (hasIdentifier || hasUncertainty),
    required: true,
    detail:
      unsupportedNumbers.length > 0
        ? `Unsupported numerical claims: ${unsupportedNumbers.join(', ')} not in the evidence.`
        : hasIdentifier
          ? 'Claims carry an identifier from the evidence.'
          : hasUncertainty
            ? 'No identifier, but claims are explicitly calibrated as uncertain.'
            : 'Claims are unsupported: no identifier and no calibrated uncertainty.'
  });

  // 4. Originality — framing: the draft must not repeat a recent post's
  //    title/summary framing.
  const titleSim = maxSimilarity(draft.title, input.recentTitles);
  checks.push({
    id: 'framing',
    label: 'Fresh framing vs recent posts',
    passed: titleSim < FRAME_SIM_THRESHOLD,
    required: true,
    detail:
      titleSim < FRAME_SIM_THRESHOLD
        ? `Title framing is fresh (max similarity ${titleSim.toFixed(2)}).`
        : `Title repeats a recent post's framing (similarity ${titleSim.toFixed(2)}).`
  });

  // 5. Originality — variation: the opening pattern must differ from recent
  //    openings. An opening that simply quotes the candidate's own fact (the
  //    summary lead) is not the writer's phrasing, so it is exempt — this
  //    catches boilerplate writer openings ("In the rapidly evolving world of
  //    AI…") without false-positiving on identical factual leads.
  const opening = openingOf(draft.text);
  const summaryTokens = tokenize(input.candidate.summary ?? '');
  // The opening is a fact lead when most of its tokens come from the
  // candidate's own summary (the opening is a prefix/paraphrase of the fact).
  const openingIsFactLead =
    summaryTokens.size > 0 && containment(tokenize(opening), summaryTokens) >= 0.6;
  const openingSim = maxSimilarity(opening, input.recentOpenings);
  const varied = openingIsFactLead || openingSim < OPENING_SIM_THRESHOLD;
  checks.push({
    id: 'variation',
    label: 'Varied opening',
    passed: varied,
    required: true,
    detail: varied
      ? openingIsFactLead
        ? 'Opening quotes the candidate fact (not repeated writer phrasing).'
        : 'Opening pattern differs from recent posts.'
      : `Opening repeats a recent post's phrasing (similarity ${openingSim.toFixed(2)}).`
  });

  // 6. Concrete technical implication (exploitability / blast radius /
  //    mitigations / architectural implications).
  const implicationSections = persona.postStructure.filter(s =>
    ['exploitability', 'blast-radius', 'mitigations', 'architectural-implications'].includes(s.id)
  );
  const implicationTerms = implicationSections.flatMap(s => s.terms);
  const hasImplication = implicationTerms.some(t => text.toLowerCase().includes(t));
  checks.push({
    id: 'implication',
    label: 'Concrete technical implication',
    passed: hasImplication,
    required: false,
    detail: hasImplication
      ? 'Draft states a concrete security/architectural/operational implication.'
      : 'Draft lacks a concrete technical implication (exploitability, blast radius, mitigations, or architectural impact).'
  });

  // 7. No generic AI-marketing language, exclamation hype, or ALL-CAPS.
  const marketingHits = [
    ...persona.vocabulary.marketingTerms,
    ...persona.vocabulary.styleAvoid
  ].filter(t => text.toLowerCase().includes(t));
  const hype = HYPE_RE.test(text);
  checks.push({
    id: 'no-marketing',
    label: 'No generic AI-marketing language',
    passed: marketingHits.length === 0 && !hype,
    required: true,
    detail: marketingHits.length > 0 || hype
      ? `Marketing/hype language detected: ${marketingHits.join(', ') || 'exclamations or ALL-CAPS'}.`
      : 'Calm, evidence-bound prose.'
  });

  // 8. Concise post format: within the requested length.
  const tooLong = draft.text.length > CONCISE_MAX_CHARS;
  checks.push({
    id: 'format',
    label: 'Concise post format',
    passed: !tooLong,
    required: false,
    detail: tooLong
      ? `Draft exceeds the concise format (${draft.text.length} chars > ${CONCISE_MAX_CHARS}).`
      : `Draft is within the concise format (${draft.text.length} chars).`
  });

  // 9. Persona exclusions: none of the topics-to-avoid appear.
  const exclusionHits = persona.topicsToAvoid.filter(t => text.toLowerCase().includes(t));
  checks.push({
    id: 'exclusions',
    label: 'Persona exclusions respected',
    passed: exclusionHits.length === 0,
    required: true,
    detail: exclusionHits.length === 0
      ? 'No persona-excluded topics in the draft.'
      : `Draft violates persona exclusions: ${exclusionHits.join(', ')}.`
  });

  // 10. Confidence / source quality.
  const lowConfidence = draft.confidence < CONFIDENCE_MIN;
  const lowSource = input.sourceQualityScore != null && input.sourceQualityScore < SOURCE_QUALITY_MIN;
  checks.push({
    id: 'confidence',
    label: 'Confidence & source quality',
    passed: !lowConfidence && !lowSource,
    required: false,
    detail: lowConfidence || lowSource
      ? `Confidence ${draft.confidence}/100 or source quality ${input.sourceQualityScore ?? 'n/a'}/15 below publishable minimum.`
      : `Confidence ${draft.confidence}/100 with sufficient source quality.`
  });

  // 11. Structure: fact → interpretation → why it matters → Ada's view.
  // Stages are anchored on the persona's section headers as sentence-initial
  // labels followed by a delimiter (e.g. "Summary.", "Exploitability.",
  // "Architectural implications."), so stage words inside free-form openings
  // and transitions ("blast radius", "trust boundary") never masquerade as a
  // stage; distinctive content fallbacks cover header-less drafts.
  const atHeader = (phrase: string): number => {
    const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const capitalized = phrase.charAt(0).toUpperCase() + phrase.slice(1);
    // The exact Capitalized label anywhere (word boundary + delimiter): a real
    // section header, whether it follows the title directly or a sentence. The
    // lowercase prose of the approved openings/transitions ("blast radius",
    // "trust boundary") never matches this.
    const cap = new RegExp(`\\b${capitalized}\\s*[:.]`).exec(text);
    if (cap) return cap.index;
    // Sentence-initial label in any case (covers a lowercased header).
    const si = new RegExp(`(?:^|[.!?]\\s+|\\n)\\s*(${esc})\\s*[:.]`, 'i').exec(text);
    return si ? si.index + si[0].indexOf(si[1]) : -1; // -1 when absent
  };
  const fact = atHeader('summary');
  const interp = (() => {
    const headers = ['exploitability', 'blast radius', 'mitigations'].map(atHeader).filter(i => i !== -1);
    return headers.length > 0 ? Math.min(...headers) : text.toLowerCase().search(/exploitab|attack surface|precondition/);
  })();
  const whyMatters = (() => {
    const i = atHeader('architectural implications');
    if (i !== -1) return i;
    return text.toLowerCase().search(/trust boundary|isolation|design implication/);
  })();
  const view = (() => {
    const i = atHeader('confidence');
    if (i !== -1) return i;
    return text.toLowerCase().search(/we assess|not yet verified|uncertain|unconfirmed/);
  })();
  const ordered = fact !== -1 && interp !== -1 && whyMatters !== -1 && view !== -1
    && fact < interp && interp < whyMatters && whyMatters < view;
  checks.push({
    id: 'structure',
    label: 'Fact → interpretation → why it matters → Ada’s view',
    passed: ordered,
    required: true,
    detail: ordered
      ? 'Structure flows fact → interpretation → why it matters → Ada’s view.'
      : 'Structure is out of order or missing a stage (fact, interpretation, why it matters, Ada’s view).'
  });

  // 12. Memory relevance: connect to prior editorial memory ONLY when relevant.
  const memoryOk =
    input.followUp
      ? draft.relatedPosts.length > 0
      : draft.relatedPosts.length === 0;
  checks.push({
    id: 'memory-relevance',
    label: 'Memory connected only when relevant',
    passed: memoryOk,
    required: false,
    detail: memoryOk
      ? input.followUp
        ? `Draft references the relevant prior story (${draft.relatedPosts.join(', ')}).`
        : 'No prior-memory references (none are relevant to this candidate).'
      : input.followUp
        ? 'Draft ignores the relevant prior story it must build on.'
        : 'Draft references prior content that is not relevant to this candidate.'
  });

  // 13. Concrete security/architecture recommendation: an actionable
  //     imperative aimed at a concrete action — not just analysis.
  const hasRecommendationVerb = RECOMMENDATION_VERB_RE.test(text);
  const hasRecommendationAction = RECOMMENDATION_ACTIONS.some(a => text.toLowerCase().includes(a));
  const hasRecommendation = hasRecommendationVerb && hasRecommendationAction;
  checks.push({
    id: 'recommendation',
    label: 'Concrete security/architecture recommendation',
    passed: hasRecommendation,
    required: true,
    detail: hasRecommendation
      ? 'Draft states a concrete, actionable security or architecture recommendation.'
      : hasRecommendationVerb
        ? 'Draft urges action but names no concrete action (isolate, upgrade, patch, gate, restrict, …).'
        : 'Draft offers analysis but no recommendation (no should/must/recommend with a concrete action).'
  });

  const required = checks.filter(c => c.required);
  const failedRequired = required.filter(c => !c.passed);
  const failedPolish = checks.filter(c => !c.required && !c.passed);

  const verdict: QualityVerdict =
    failedRequired.length > 0 ? 'reject' : failedPolish.length > 0 ? 'hold' : 'pass';

  const reasons = checks
    .filter(c => !c.passed)
    .map(c => `${c.label}: ${c.detail}`);

  return {
    verdict,
    score: checks.length === 0 ? 1 : checks.filter(c => c.passed).length / checks.length,
    checks,
    reasons
  };
}
