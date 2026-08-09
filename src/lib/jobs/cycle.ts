// The agent cycle — what one scheduled occurrence does.
//
//  1. Discover fresh candidates (live sources; per-source isolation means
//     individual source failures never abort the cycle).
//  2. Run editorial: score, generate, and quality-gate the agent's batch.
//  3. Publish ONLY gate-passed, generated decisions — transactionally, with a
//     per-decision idempotency key and a per-agent once-only published marker,
//     so a re-delivered occurrence can never publish the same decision twice.
//
// Publication never happens "because a run occurred": an occurrence with no
// gate-passed decisions publishes nothing.
//
// The legacy sim stage machine (src/lib/agentEngine advanceTo) is deliberately
// NOT run here: it is a test-only artifact and no longer advances in
// production. The dashboard's activity is derived from the real persisted
// records this cycle writes (agent_runs, posts, decisions, fetches).

import {
  getPublishableDecisions,
  insertPost,
  insertSource,
  markDecisionPublished,
  upsertTopicRow,
  withTransaction,
  type UpsertTopicInput
} from '../db';
import { runDiscovery, type DiscoverySummary } from '../discovery/runner';
import { runEditorial } from '../editorial/engine';
import { ulid } from '../ids';
import type { CycleResult } from './queue';

export interface CycleOptions {
  /** Injectable for offline tests (defaults to the live discovery runner). */
  discovery?: (now: number) => Promise<DiscoverySummary>;
  /** Skip the discovery step entirely (offline tests). */
  skipDiscovery?: boolean;
}

const TRANSIENT_PREFIX = 'TRANSIENT:';

export function isTransientError(error: string): boolean {
  return error.startsWith(TRANSIENT_PREFIX);
}

/** Publish every gate-passed, generated, not-yet-published decision for the
 *  agent, each in its own transaction (topic row + post + once-only marker). */
export function publishPublishablePosts(agentId: string, now: number): number {
  const decisions = getPublishableDecisions(agentId, 25);
  let published = 0;
  for (const decision of decisions) {
    let post: { title: string; text: string; rationale: string; confidence: number };
    try {
      post = JSON.parse(decision.generatedJson) as typeof post;
    } catch {
      continue; // unparseable draft — never publish it
    }
    const topicInput: UpsertTopicInput = {
      agentId,
      title: decision.title,
      canonicalSourceUrl: decision.canonicalUrl,
      category: decision.sourceType,
      sourceName: decision.sourceName,
      credibilityScore: decision.totalScore,
      trendScore: null,
      noveltyScore: null,
      importanceScore: null,
      confidenceScore: Math.round(post.confidence),
      recommendation: 'Accept',
      rejectionReason: null,
      detailedAnalysis: post.text,
      opinion: null,
      freshness: null,
      rawJson: decision.qualityJson,
      createdAtMs: now
    };
    withTransaction(() => {
      const topicId = upsertTopicRow(topicInput);
      // Persist the canonical source so future discovery/similarity lookups
      // can corroborate this decision's evidence.
      insertSource({
        agentId,
        topicId,
        url: decision.canonicalUrl,
        sourceName: decision.sourceName
      });
      const postId = ulid(now);
      insertPost({
        id: postId,
        agentId,
        topicId,
        title: post.title,
        body: post.text,
        opinion: null,
        rationale: post.rationale,
        confidenceScore: Math.round(post.confidence),
        category: decision.sourceType,
        importanceScore: decision.totalScore,
        noveltyScore: null,
        publicationId: `PUB-ED-${String(now).slice(-6)}`,
        publishedAtMs: now,
        idempotencyKey: `decision:${decision.decisionId}`
      });
      // Per-agent once-only guard: markDecisionPublished only succeeds when the
      // decision belongs to THIS agent and no worker published it first — a
      // re-delivered occurrence, a concurrent worker, or another agent's cycle
      // can never publish this decision, and this agent can never publish
      // another agent's decision.
      if (!markDecisionPublished(agentId, decision.decisionId, postId)) {
        throw new Error('decision already published');
      }
    });
    published += 1;
  }
  return published;
}

/** One scheduled occurrence for an agent. */
export async function runAgentCycle(agentId: string, now: number, opts: CycleOptions = {}): Promise<CycleResult> {
  // Discovery: live sources with per-source error isolation. A COMPLETE outage
  // (every allowlisted source failed) is a transient job failure — the queue
  // retries it with bounded exponential backoff. The runner records failed
  // fetches as rows with status 'failure', so a total outage is "failures
  // present AND every recorded fetch failed" (an empty fetch list with no
  // failures just means nothing was attempted).
  if (!opts.skipDiscovery) {
    const summary = opts.discovery
      ? await opts.discovery(now)
      : await runDiscovery({ now });
    const totalOutage =
      summary.failures.length > 0 && summary.fetches.every(f => f.status === 'failure');
    if (totalOutage) {
      return {
        ok: false,
        error: `${TRANSIENT_PREFIX} all discovery sources failed (${summary.failures.length} source(s) down)`
      };
    }
  }

  // Editorial: score → generate → quality-gate THIS AGENT's pending batch.
  // Generation failures flip decisions to rejected; gate failures hold or
  // reject — none of it publishes anything by itself.
  await runEditorial({ agentId, now });

  // Gated publication: only gate-passed, generated, accepted decisions.
  const published = publishPublishablePosts(agentId, now);

  return {
    ok: true,
    summary: `discovery + editorial complete; ${published} gate-passed post(s) published`
  };
}
