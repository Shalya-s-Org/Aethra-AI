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
  countPublishedBySourceType,
  getAcceptedDecisionCandidates,
  getAgentRow,
  getLatestAcceptedAtMs,
  getPendingDecisionCandidates,
  getRecentGeneratedAccepted,
  getSourceHealth,
  hasPublishedCanonicalUrl,
  upsertDiscoveryDecision
} from '../db';
import { unhealthySourceNames } from '../discovery/health';
import { openingOf, runQualityGate, type QualityGateReport } from '../quality';
import {
  gatherMemoryItems,
  getRelevantMemory,
  recordMemoryForAccepted,
  type RelevantMemory
} from '../memory/memory';
import { createSimilarityProvider } from '../memory/similarity';
import { getPersona, type Persona } from '../persona';
import {
  candidateIdentifierText,
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
/** Default cap on candidates from ONE source type per editorial run — a
 *  flooding feed can never starve every other source out of the queue.
 *  Overridable via AETHRA_DISCOVERY_MAX_PER_SOURCE. */
export const DEFAULT_MAX_PER_SOURCE_TYPE = 6;
/** Default max posts from ONE source type in the rolling 24h window — the
 *  feed-diversity rule. Overridable via AETHRA_DIVERSITY_MAX_POSTS_PER_TYPE. */
export const DEFAULT_DIVERSITY_MAX_POSTS_PER_TYPE = 2;
const DUPLICATE_SIM_THRESHOLD = 0.85;
const DAY_MS = 24 * 3600_000;

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export interface EditorialRunOptions {
  /** The agent whose editorial pipeline this run is (its candidates are
   *  scored, generated, gated, and persisted under this id). Required — the
   *  pipeline is per-agent. */
  agentId: string;
  /** Injectable for deterministic tests. */
  now?: number;
  /** Max candidates evaluated per run. */
  limit?: number;
  /** Minimum gap between routine posts (override-exempt). */
  routineIntervalMs?: number;
  /** Max routine posts per rolling 24h (override-exempt). */
  dailyCap?: number;
  /** Max candidates evaluated from ONE source type per run (intake diversity). */
  maxPerSourceType?: number;
  /** Max posts from ONE source type in the rolling 24h window (feed diversity). */
  diversityMaxPostsPerType?: number;
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
  /** LLM generation outcome (set during the generation phase). */
  generation?:
    | { status: 'generated'; json: string }
    | { status: 'failed'; failure: string };
  /** Pre-publication quality gate outcome (set during the generation phase). */
  quality?: { status: 'passed' | 'held' | 'rejected'; json: string };
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

export async function runEditorial(options: EditorialRunOptions): Promise<EditorialRunSummary> {
  const now = options.now ?? Date.now();
  const interval = options.routineIntervalMs ?? DEFAULT_ROUTINE_INTERVAL_MS;
  const cap = options.dailyCap ?? DEFAULT_DAILY_CAP;
  const limit = options.limit ?? 50;
  const maxPerSourceType = options.maxPerSourceType ?? envInt('AETHRA_DISCOVERY_MAX_PER_SOURCE', DEFAULT_MAX_PER_SOURCE_TYPE);
  const diversityMax = options.diversityMaxPostsPerType ?? envInt('AETHRA_DIVERSITY_MAX_POSTS_PER_TYPE', DEFAULT_DIVERSITY_MAX_POSTS_PER_TYPE);
  const runId = ulid(now);
  const startedAt = new Date(now).toISOString();
  // The persona is resolved from the AGENT's own configuration, so every agent
  // scores, prompts, and validates against its own persona definition.
  const agent = getAgentRow(options.agentId);
  const persona: Persona = getPersona(agent?.state.config.domain ?? null);

  // Intake diversity: fetch a superset of pending candidates and select at most
  // `maxPerSourceType` per source type (newest first, deterministic), so one
  // flooding feed can never monopolize the queue at the expense of the others.
  const pendingPool = getPendingDecisionCandidates(options.agentId, Math.min(500, limit * 6));
  const perType = new Map<string, number>();
  const pending: typeof pendingPool = [];
  for (const candidate of pendingPool) {
    const seen = perType.get(candidate.sourceType) ?? 0;
    if (seen >= maxPerSourceType) continue;
    perType.set(candidate.sourceType, seen + 1);
    pending.push(candidate);
    if (pending.length >= limit) break;
  }
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

  // Editorial memory: this agent's previously accepted candidates (novelty +
  // duplicate base) — another agent's accepts never leak into this ladder.
  const acceptedMemory = getAcceptedDecisionCandidates(options.agentId);
  const memoryTitles = acceptedMemory.map(a => a.title);

  // Source freshness: candidates from sources whose persisted health is
  // stale/down earn capped source-quality credit (their claims aren't current).
  const staleSources = unhealthySourceNames(getSourceHealth(), now);

  // Durable memory (this agent's scope): one ladder run per candidate against
  // the same gathered memory set, so the batch is deterministic. The similarity
  // provider is created once per run, scoped to this agent, and warmed with the
  // full memory + candidate set — a network embeddings provider embeds each
  // unique title ONCE into the durable cache; failures degrade per-item to the
  // lexical checks (the ladder still runs URL → title → keyword first).
  const memoryItems = gatherMemoryItems(options.agentId, { source: 'decisions' });
  const similarityProvider = createSimilarityProvider(options.agentId);
  if (similarityProvider.warm) {
    try {
      await similarityProvider.warm([...memoryItems, ...pending]);
    } catch {
      // A failed warm-up must never block scoring — comparisons fall back to
      // the deterministic lexical provider.
    }
  }
  const memoryByCandidate = new Map<string, RelevantMemory>();
  for (const candidate of pending) {
    memoryByCandidate.set(
      candidate.id,
      getRelevantMemory(options.agentId, candidate, {
        items: memoryItems,
        persona,
        provider: similarityProvider
      })
    );
  }

  // Corroboration: the same CVE in ≥ 2 candidates of this batch, detected
  // across the widest view (prose + canonical URL + raw record) so it agrees
  // with the scorer's identifier detection.
  const cveCounts = new Map<string, number>();
  for (const candidate of pending) {
    const cve = extractCve(candidateIdentifierText(candidate));
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
      persona,
      staleSources
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
    if (hasPublishedCanonicalUrl(options.agentId, s.candidate.canonicalUrl)) {
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
      // High-impact claims (CVE + explicit severity) from a non-primary source
      // never publish on one source's say-so — held until corroborated.
      if (s.flags.unverifiedImpact) {
        kind = 'held';
        reasons.push(
          `High-impact claim (${s.flags.unverifiedImpact}) from a non-primary source without corroboration — held until a primary advisory or a second source confirms it.`
        );
      } else {
        kind = 'accepted';
        reasons.push(`Score ${s.total} meets publish threshold ${PUBLISH_THRESHOLD}.`);
      }
    } else if (s.total < REJECT_THRESHOLD) {
      kind = 'rejected';
      reasons.push(`Score ${s.total} below reject threshold ${REJECT_THRESHOLD}.`);
    } else {
      kind = 'held';
      reasons.push(`Score ${s.total} below publish threshold ${PUBLISH_THRESHOLD} (held for review).`);
      if (s.flags.unverifiedImpact) {
        reasons.push(
          `High-impact claim (${s.flags.unverifiedImpact}) needs corroboration or a primary advisory before it can publish.`
        );
      }
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
    if (s.flags.staleSource) {
      reasons.push(
        `Source ${s.candidate.sourceName} is stale or down (persisted source health) — its claims earn capped source-quality credit.`
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

  // Generation + pre-publication quality gate, run BEFORE the interval/cap so
  // a gated-out draft never consumes a routine slot. Accepted entries generate
  // a schema-validated post; the quality gate then decides pass (stays
  // accepted), hold (retry next run), or reject (never publish weak content).
  const provider = options.provider ?? createLlmProvider();
  const recent = getRecentGeneratedAccepted(options.agentId, 20);
  const recentTitles = recent.map(r => r.title);
  // Rolling openings: previously generated posts PLUS this batch's own drafts,
  // so generation varies openings and the gate's variation check catches
  // in-batch repetition too (never deterministic-template-looking output).
  const rollingOpenings: string[] = recent.map(r => {
    try {
      return openingOf((JSON.parse(r.generatedJson) as { text?: string }).text ?? '');
    } catch {
      return '';
    }
  });
  for (const entry of entries) {
    if (entry.kind !== 'accepted') continue;
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
      recentOpenings: rollingOpenings.filter(o => o.length > 0),
      provider
    });
    if (!outcome.ok) {
      entry.kind = 'rejected';
      entry.reasons = [
        ...entry.reasons,
        `Generation failed (${outcome.error}). Recorded as rejected rather than publishing weak content.`
      ];
      entry.generation = { status: 'failed', failure: outcome.error };
      continue;
    }
    entry.generation = { status: 'generated', json: outcome.raw };

    // The gate compares against PRIOR openings (DB history + earlier drafts in
    // this batch) — never the draft's own opening, which would trivially
    // match itself. The opening joins the rolling set only after the gate.
    const report: QualityGateReport = runQualityGate({
      persona,
      candidate: entry.scored.candidate,
      draft: outcome.post,
      followUp: entry.scored.flags.meaningfulFollowUp,
      recentTitles,
      recentOpenings: rollingOpenings.filter(o => o.length > 0),
      sourceQualityScore: entry.scored.components.sourceQuality
    });
    rollingOpenings.push(openingOf(outcome.post.text));
    entry.quality = {
      status: report.verdict === 'pass' ? 'passed' : report.verdict === 'hold' ? 'held' : 'rejected',
      json: JSON.stringify(report)
    };
    if (report.verdict !== 'pass') {
      const held = report.verdict === 'hold';
      entry.kind = held ? 'held' : 'rejected';
      entry.reasons = [
        ...entry.reasons,
        held
          ? `Quality gate held the draft for revision: ${report.reasons.join('; ')}`
          : `Quality gate rejected the draft: ${report.reasons.join('; ')}`
      ];
    }
  }

  // Routine posting interval + daily cap + feed-diversity rule, applied in
  // deterministic priority order, scoped to THIS agent (one agent's cadence
  // never suppresses another's). Breaking-security overrides are exempt.
  let lastAcceptedAt = getLatestAcceptedAtMs(options.agentId, now - interval);
  let dailyCount = countAcceptedSinceMs(options.agentId, now - DAY_MS);
  // Per-source-type published counts in the rolling 24h window (lazily loaded;
  // in-run accepts count too, so a single run can't flood the feed with one
  // source type).
  const typeCounts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind !== 'accepted' || entry.scored.flags.breakingSecurity) continue;
    const sourceType = entry.scored.candidate.sourceType;
    let typeCount = typeCounts.get(sourceType);
    if (typeCount === undefined) {
      typeCount = countPublishedBySourceType(options.agentId, sourceType, now - DAY_MS);
      typeCounts.set(sourceType, typeCount);
    }
    const overTypeDiversity = typeCount >= diversityMax;
    const withinInterval = lastAcceptedAt !== null && now - lastAcceptedAt < interval;
    const overCap = dailyCount >= cap;
    if (withinInterval || overCap || overTypeDiversity) {
      entry.kind = 'held';
      entry.reasons = entry.reasons.filter(r => !r.startsWith('Score '));
      const waitMin =
        lastAcceptedAt !== null
          ? Math.max(1, Math.ceil((interval - (now - lastAcceptedAt)) / 60_000))
          : 0;
      entry.reasons.push(
        overTypeDiversity
          ? `Feed-diversity: source type ${sourceType} already has ${typeCount} post(s) in the last 24h (cap ${diversityMax}).`
          : overCap
            ? `Rate-limited: daily cap of ${cap} routine posts reached.`
            : `Rate-limited: next routine slot frees in ~${waitMin} min (minimum interval ${Math.round(interval / 3600_000)}h).`
      );
    } else {
      lastAcceptedAt = now;
      dailyCount += 1;
      typeCounts.set(sourceType, typeCount + 1);
    }
  }

  // Persist every decision (accepted, held, rejected) with scores, the
  // generation outcome, and the quality-gate report. Durable memory is only
  // recorded for gate-passed accepts.
  const decisions: EditorialDecision[] = [];
  for (const entry of entries) {
    const explanation = buildExplanation(entry.kind, entry.scored, entry.reasons);
    const decision: EditorialDecision = {
      id: ulid(now),
      candidateId: entry.scored.candidate.id,
      kind: entry.kind,
      totalScore: entry.scored.total,
      components: entry.scored.components,
      explanation,
      decidedAt: startedAt
    };
    upsertDiscoveryDecision({
      id: decision.id,
      agentId: options.agentId,
      candidateId: decision.candidateId,
      decision: decision.kind,
      totalScore: decision.totalScore,
      components: decision.components,
      explanation,
      decidedAtMs: now,
      generation: entry.generation,
      quality: entry.quality
    });

    // Durable memory: gate-passed content becomes long-term + editorial memory
    // (persona scope), keyed to the story subject for follow-up accumulation,
    // and tagged with the persona's recurring themes.
    if (entry.kind === 'accepted') {
      recordMemoryForAccepted(options.agentId, entry.scored.candidate, {
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
