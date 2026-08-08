// Deterministic editorial decision engine over discovered candidates.
//
// runEditorial() evaluates every pending candidate (no decision yet, or held),
// scores it on the seven weighted criteria, applies the hard rules, and
// persists one decision per candidate with a human-readable explanation.
// The pipeline is separate from the agent engine and from GET /feed — it only
// reads discovery_candidates and writes discovery_decisions.
//
// Determinism: no randomness anywhere; `now` is injectable; batch ordering and
// every tie-break are total orders (score desc → publishedAt asc → URL asc).

import { ulid } from '../ids';
import { generatePost, createLlmProvider, type LlmProvider } from '../llm';
import {
  countAcceptedSinceMs,
  getAcceptedDecisionCandidates,
  getLatestAcceptedAtMs,
  getPendingDecisionCandidates,
  hasPublishedCanonicalUrl,
  upsertDiscoveryDecision
} from '../db';
import {
  gatherMemoryItems,
  getRelevantMemory,
  recordMemoryForAccepted,
  type RelevantMemory
} from '../memory/memory';
import { getPersona, type Persona } from '../persona';
import {
  extractCve,
  maxTitleSimilarity,
  scoreCandidate,
  textOf,
  themeHitsOf
} from './scoring';
import {
  PUBLISH_THRESHOLD,
  REJECT_THRESHOLD,
  type DecisionKind,
  type EditorialDecision,
  type ScoredCandidate
} from './types';

export const DEFAULT_ROUTINE_INTERVAL_MS = 6 * 3600_000;
export const DEFAULT_DAILY_CAP = 4;
const DUPLICATE_SIM_THRESHOLD = 0.85;
const DAY_MS = 24 * 3600_000;

export interface EditorialRunOptions {
  /** Injectable for deterministic tests. */
  now?: number;
  /** Max candidates evaluated per run. */
  limit?: number;
  /** Minimum gap between routine posts (override-exempt). */
  routineIntervalMs?: number;
  /** Max routine posts per rolling 24h (override-exempt). */
  dailyCap?: number;
  /** LLM provider for accepted-post generation. Defaults to the env-driven
   *  factory (deterministic local provider unless AETHRA_LLM_PROVIDER is set). */
  provider?: LlmProvider;
}

export interface EditorialRunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  evaluated: number;
  accepted: number;
  held: number;
  rejected: number;
  decisions: EditorialDecision[];
}

interface Entry {
  scored: ScoredCandidate;
  kind: DecisionKind;
  reasons: string[];
}

/** Total-order tie-break: higher score first, then older, then URL. */
function comparePriority(a: ScoredCandidate, b: ScoredCandidate): number {
  if (b.total !== a.total) return b.total - a.total;
  const pa = Date.parse(a.candidate.publishedAt);
  const pb = Date.parse(b.candidate.publishedAt);
  if (pa !== pb) return pa - pb;
  return a.candidate.canonicalUrl < b.candidate.canonicalUrl
    ? -1
    : a.candidate.canonicalUrl > b.candidate.canonicalUrl
      ? 1
      : 0;
}

function findTitleDuplicate(title: string, seen: string[]): string | null {
  for (const other of seen) {
    if (maxTitleSimilarity(title, [other]) >= DUPLICATE_SIM_THRESHOLD) return other;
  }
  return null;
}

function ageDays(now: number, publishedAt: string): number {
  return Math.max(0, Math.floor((now - Date.parse(publishedAt)) / DAY_MS));
}

/** The persona's strong opinion for a decision situation ('' if none). */
function stanceOf(persona: Persona, appliesTo: string): string {
  const opinion = persona.strongOpinions.find(o => o.appliesTo === appliesTo);
  return opinion ? `${persona.name}'s stance: ${opinion.stance}` : '';
}

function buildExplanation(kind: DecisionKind, scored: ScoredCandidate, reasons: string[]): string {
  const c = scored.components;
  const scores =
    `persona relevance ${c.personaRelevance}/20; technical impact ${c.technicalImpact}/20; ` +
    `source quality ${c.sourceQuality}/15; recency ${c.recency}/15; novelty ${c.novelty}/15; ` +
    `discussion value ${c.discussionValue}/10; evidence confidence ${c.evidenceConfidence}/5`;
  const prefix = `${kind.toUpperCase()} (${scored.total}/100) — ${scores}.`;
  return reasons.length > 0 ? `${prefix} ${reasons.join(' ')}` : prefix;
}

export async function runEditorial(options: EditorialRunOptions = {}): Promise<EditorialRunSummary> {
  const now = options.now ?? Date.now();
  const interval = options.routineIntervalMs ?? DEFAULT_ROUTINE_INTERVAL_MS;
  const cap = options.dailyCap ?? DEFAULT_DAILY_CAP;
  const limit = options.limit ?? 50;
  const runId = ulid(now);
  const startedAt = new Date(now).toISOString();
  // The editorial pipeline is the AI Security persona's pipeline.
  const persona: Persona = getPersona(null);

  const pending = getPendingDecisionCandidates(limit);
  if (pending.length === 0) {
    return {
      runId,
      startedAt,
      finishedAt: startedAt,
      evaluated: 0,
      accepted: 0,
      held: 0,
      rejected: 0,
      decisions: []
    };
  }

  // Editorial memory: previously accepted candidates (novelty + duplicate base).
  const acceptedMemory = getAcceptedDecisionCandidates();
  const memoryTitles = acceptedMemory.map(a => a.title);

  // Durable memory (persona scope): one ladder run per candidate against the
  // same gathered memory set, so the batch is deterministic.
  const memoryItems = gatherMemoryItems(null);
  const memoryByCandidate = new Map<string, RelevantMemory>();
  for (const candidate of pending) {
    memoryByCandidate.set(
      candidate.id,
      getRelevantMemory(null, candidate, { items: memoryItems, persona })
    );
  }

  // Corroboration: the same CVE in ≥ 2 candidates of this batch.
  const cveCounts = new Map<string, number>();
  for (const candidate of pending) {
    const cve = extractCve(textOf(candidate));
    if (cve) cveCounts.set(cve, (cveCounts.get(cve) ?? 0) + 1);
  }
  const corroborationCves = new Set([...cveCounts].filter(([, n]) => n >= 2).map(([c]) => c));

  // Score everything, then order deterministically (tie-break: score → age → URL).
  const scored = pending.map(candidate =>
    scoreCandidate(candidate, {
      now,
      memoryTitles,
      corroborationCves,
      memory: memoryByCandidate.get(candidate.id),
      persona
    })
  );
  scored.sort(comparePriority);

  // In-batch + memory duplicate detection in priority order: the highest
  // scorer of a duplicate group is treated as the original.
  const seenTitles = [...memoryTitles];
  for (const s of scored) {
    const dup = findTitleDuplicate(s.candidate.title, seenTitles);
    if (dup) {
      s.flags.duplicateTitle = dup;
      s.flags.duplicateTitleSimilarity = maxTitleSimilarity(s.candidate.title, [dup]);
    }
    seenTitles.push(s.candidate.title);
    if (hasPublishedCanonicalUrl(s.candidate.canonicalUrl)) {
      s.flags.duplicateUrl = s.candidate.canonicalUrl;
    }
  }

  // Tentative kinds + reasons (interval/cap applied next). Hard rejects
  // (duplicate/stale/marketing/unsupported) are final; the breaking-security
  // override then rescues items the THRESHOLD would hold or reject — it never
  // resurrects a hard-rejected item and never relabels one the threshold
  // already accepts.
  const entries: Entry[] = [];
  for (const s of scored) {
    let reasons: string[] = [];
    let kind: DecisionKind;
    let hardRejected = false;

    if (s.flags.duplicateTitle || s.flags.duplicateUrl) {
      hardRejected = true;
      kind = 'rejected';
      if (s.flags.duplicateUrl) {
        reasons.push(`Duplicate: canonical URL already published (${s.flags.duplicateUrl}).`);
      }
      if (s.flags.duplicateTitle) {
        reasons.push(
          `Duplicate: title matches accepted candidate (similarity ${(s.flags.duplicateTitleSimilarity ?? 1).toFixed(2)}).`
        );
      }
    } else if (s.flags.stale) {
      hardRejected = true;
      kind = 'rejected';
      reasons.push(`Stale: published ${ageDays(now, s.candidate.publishedAt)} days ago (> 30 days).`);
    } else if (s.flags.offPersona) {
      // The persona's topics-to-avoid: unrelated content is rejected outright.
      hardRejected = true;
      kind = 'rejected';
      reasons.push(
        `Off-persona: "${s.flags.offPersona}" is on ${persona.name}'s topics to avoid. ${stanceOf(persona, 'hype')}`.trim()
      );
    } else if (s.flags.marketing) {
      hardRejected = true;
      kind = 'rejected';
      reasons.push(`Low-quality marketing content. ${stanceOf(persona, 'hype')}`.trim());
    } else if (s.flags.unsupported) {
      hardRejected = true;
      kind = 'rejected';
      reasons.push(
        `Unsupported claims: no identifiers (CVE/GHSA/arXiv) and thin evidence. ${stanceOf(persona, 'unsupported')}`.trim()
      );
    } else if (s.flags.followUpWithoutNewInfo) {
      // An evolving story may only publish with meaningful new information.
      hardRejected = true;
      kind = 'rejected';
      reasons.push(
        `Follow-up on "${s.flags.followUpWithoutNewInfo}" without meaningful new information (no new identifiers, no new substantive content).`
      );
    } else if (s.flags.memoryNearDuplicate) {
      // Semantic near-duplicate found through the similarity seam (level 4).
      hardRejected = true;
      kind = 'rejected';
      reasons.push(`Near-duplicate of "${s.flags.memoryNearDuplicate}" (semantic similarity).`);
    } else if (s.total >= PUBLISH_THRESHOLD) {
      kind = 'accepted';
      reasons.push(`Score ${s.total} meets publish threshold ${PUBLISH_THRESHOLD}.`);
    } else if (s.total < REJECT_THRESHOLD) {
      kind = 'rejected';
      reasons.push(`Score ${s.total} below reject threshold ${REJECT_THRESHOLD}.`);
    } else {
      kind = 'held';
      reasons.push(`Score ${s.total} below publish threshold ${PUBLISH_THRESHOLD} (held for review).`);
    }

    // The breaking-security override rescues items the THRESHOLD would hold or
    // reject — it never overrides a hard rejection (duplicate/stale/marketing/
    // unsupported) and never relabels one the threshold already accepts.
    if (s.flags.breakingSecurity && !hardRejected && kind !== 'accepted') {
      kind = 'accepted';
      reasons = [
        'Breaking-security override: verified high-severity advisory (CISA KEV or high-severity GitHub advisory), fresh, with a CVE identifier.'
      ];
    }

    const cve = extractCve(textOf(s.candidate));
    if (cve) reasons.push(`Reference: ${cve}.`);
    if (s.flags.meaningfulFollowUp) {
      reasons.push(
        `Follow-up on "${s.flags.meaningfulFollowUp.story}" — ${s.flags.meaningfulFollowUp.relation} the prior stance with new information.`
      );
    }
    if (kind !== 'rejected') {
      const themes = themeHitsOf(persona, textOf(s.candidate));
      if (themes.length > 0) {
        reasons.push(`On-theme for ${persona.name}: ${themes.join(', ')}.`);
      }
    }

    entries.push({ scored: s, kind, reasons });
  }

  // Routine posting interval + daily cap, applied in deterministic priority
  // order. Breaking-security overrides are exempt.
  let lastAcceptedAt = getLatestAcceptedAtMs(now - interval);
  let dailyCount = countAcceptedSinceMs(now - DAY_MS);
  for (const entry of entries) {
    if (entry.kind !== 'accepted' || entry.scored.flags.breakingSecurity) continue;
    const withinInterval = lastAcceptedAt !== null && now - lastAcceptedAt < interval;
    const overCap = dailyCount >= cap;
    if (withinInterval || overCap) {
      entry.kind = 'held';
      entry.reasons = entry.reasons.filter(r => !r.startsWith('Score '));
      const waitMin =
        lastAcceptedAt !== null
          ? Math.max(1, Math.ceil((interval - (now - lastAcceptedAt)) / 60_000))
          : 0;
      entry.reasons.push(
        overCap
          ? `Rate-limited: daily cap of ${cap} routine posts reached.`
          : `Rate-limited: next routine slot frees in ~${waitMin} min (minimum interval ${Math.round(interval / 3600_000)}h).`
      );
    } else {
      lastAcceptedAt = now;
      dailyCount += 1;
    }
  }

  // Persist every decision (accepted, held, rejected) with scores + explanation.
  // Accepted entries first generate a schema-validated post via the LLM
  // provider; a generation/validation failure flips the decision to rejected
  // (never publishes weak content) and records the failure. Durable memory is
  // only recorded when generation actually succeeded.
  const provider = options.provider ?? createLlmProvider();
  const decisions: EditorialDecision[] = [];
  for (const entry of entries) {
    let kind = entry.kind;
    let reasons = entry.reasons;
    let generation:
      | { status: 'generated'; json: string }
      | { status: 'failed'; failure: string }
      | undefined;

    if (kind === 'accepted') {
      const outcome = await generatePost({
        persona,
        candidate: entry.scored.candidate,
        followUp: entry.scored.flags.meaningfulFollowUp,
        themes: themeHitsOf(persona, textOf(entry.scored.candidate)),
        competing: entries.map(e => ({
          title: e.scored.candidate.title,
          score: e.scored.total,
          kind: e.kind
        })),
        provider
      });
      if (outcome.ok) {
        generation = { status: 'generated', json: outcome.raw };
      } else {
        kind = 'rejected';
        reasons = [
          ...reasons,
          `Generation failed (${outcome.error}). Recorded as rejected rather than publishing weak content.`
        ];
        generation = { status: 'failed', failure: outcome.error };
      }
    }

    const explanation = buildExplanation(kind, entry.scored, reasons);
    const decision: EditorialDecision = {
      id: ulid(now),
      candidateId: entry.scored.candidate.id,
      kind,
      totalScore: entry.scored.total,
      components: entry.scored.components,
      explanation,
      decidedAt: startedAt
    };
    upsertDiscoveryDecision({
      id: decision.id,
      candidateId: decision.candidateId,
      decision: kind,
      totalScore: decision.totalScore,
      components: decision.components,
      explanation,
      decidedAtMs: now,
      generation
    });

    // Durable memory: successfully generated content becomes long-term +
    // editorial memory (persona scope), keyed to the story subject for
    // follow-up accumulation, and tagged with the persona's recurring themes.
    if (kind === 'accepted') {
      recordMemoryForAccepted(null, entry.scored.candidate, {
        nowMs: now,
        followUp: entry.scored.flags.meaningfulFollowUp
          ? {
              subject: entry.scored.flags.meaningfulFollowUp.story,
              relation: entry.scored.flags.meaningfulFollowUp.relation
            }
          : undefined,
        persona
      });
    }

    decisions.push(decision);
  }

  return {
    runId,
    startedAt,
    finishedAt: new Date(now).toISOString(),
    evaluated: decisions.length,
    accepted: decisions.filter(d => d.kind === 'accepted').length,
    held: decisions.filter(d => d.kind === 'held').length,
    rejected: decisions.filter(d => d.kind === 'rejected').length,
    decisions
  };
}
