// Structured persona system. A persona is the single source of truth for how
// content is scored, rejected, remembered, prompted, and validated — replacing
// cosmetic name/domain fields with a definition that actually drives the
// pipeline.

/** One of the persona's editorial pillars (the lens every story is judged by). */
export interface PersonaPillar {
  id: string;
  label: string;
  description: string;
}

/** A strongly held position that forms the decision framework. */
export interface PersonaOpinion {
  stance: string;
  /** Which decision situations this stance applies to (e.g. 'hype', 'evidence'). */
  appliesTo: string;
}

/** A section the persona's published posts must (or should) contain. */
export interface PersonaSection {
  id: string;
  label: string;
  description: string;
  /** Keywords used to detect the section in finished prose. */
  terms: string[];
  required: boolean;
}

/** The persona's vocabulary — drives scoring term hits and style enforcement. */
export interface PersonaVocabulary {
  /** Security/domain terms (persona relevance). */
  securityTerms: string[];
  /** AI/ML terms (persona relevance). */
  aiTerms: string[];
  /** Technical-depth terms (significance). */
  technicalTerms: string[];
  /** Hype/marketing terms (rejected as noise). */
  marketingTerms: string[];
  /** Discussion/opinion terms (discussion value). */
  discussionTerms: string[];
  /** Off-persona topic signals (hard rejection). */
  avoidTerms: string[];
  /** Words banned from Ada's voice (calm, evidence-bound). */
  styleAvoid: string[];
}

export interface PersonaConfidenceRules {
  /** Language to use for high-confidence claims. */
  high: string;
  /** Language for medium-confidence claims. */
  medium: string;
  /** Language for low-confidence / speculative claims. */
  low: string;
  /** Phrases that mark calibrated uncertainty (validator passes on these). */
  uncertaintyPhrases: string[];
}

export interface Persona {
  id: string;
  name: string;
  /** Domains this persona serves (registry key). */
  domains: string[];
  identity: string;
  mission: string;
  expertise: string[];
  targetAudience: string[];
  editorialPillars: PersonaPillar[];
  recurringThemes: string[];
  strongOpinions: PersonaOpinion[];
  /** Human-readable topics the persona will not cover. */
  topicsToAvoid: string[];
  vocabulary: PersonaVocabulary;
  styleRules: string[];
  postStructure: PersonaSection[];
  confidenceRules: PersonaConfidenceRules;
}
