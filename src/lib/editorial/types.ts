// Deterministic editorial decision engine — shared types.

export type DecisionKind = 'accepted' | 'held' | 'rejected';

/** The seven weighted criteria; their maxima sum to 100. */
export interface ScoreComponents {
  personaRelevance: number; // /20
  technicalImpact: number; // /20
  sourceQuality: number; // /15
  recency: number; // /15
  novelty: number; // /15
  discussionValue: number; // /10
  evidenceConfidence: number; // /5
}

export const MAX_SCORE = 100;
export const PUBLISH_THRESHOLD = 78;
export const REJECT_THRESHOLD = 60;

export type EvidenceRelation = 'confirms' | 'updates' | 'contradicts';

/** Hard-rule signals that can force a rejection or bypass thresholds. */
export interface EditorialFlags {
  /** Canonical URL was already published by an agent (posts table). */
  duplicateUrl?: string;
  /** Title matches an accepted candidate (memory or higher-priority batch item). */
  duplicateTitle?: string;
  duplicateTitleSimilarity?: number;
  /** Semantic near-duplicate found by the memory ladder (level 4). */
  memoryNearDuplicate?: string;
  /** Off-persona topic signal (the matched avoid term) — hard reject. */
  offPersona?: string;
  /** Level-3 story overlap without meaningful new information (hard reject). */
  followUpWithoutNewInfo?: string;
  /** Level-3 story overlap WITH meaningful new information (allowed). */
  meaningfulFollowUp?: { story: string; relation: EvidenceRelation };
  stale?: boolean;
  marketing?: boolean;
  unsupported?: boolean;
  /** Verified high-severity breaking-security item (CISA KEV / high-severity
   *  GitHub advisory, fresh, with an identifier). Bypasses thresholds and the
   *  routine interval/cap. */
  breakingSecurity?: boolean;
}

/** Minimal candidate shape the scorer consumes (discovery candidates are
 *  structurally compatible). */
export interface ScorableCandidate {
  id: string;
  title: string;
  summary: string | null;
  publishedAt: string;
  canonicalUrl: string;
  sourceName: string;
  sourceType: string;
  rawEvidence: string;
}

export interface ScoredCandidate {
  candidate: ScorableCandidate;
  components: ScoreComponents;
  total: number;
  flags: EditorialFlags;
}

export interface EditorialDecision {
  id: string;
  candidateId: string;
  kind: DecisionKind;
  totalScore: number;
  components: ScoreComponents;
  explanation: string;
  decidedAt: string; // ISO UTC
}
