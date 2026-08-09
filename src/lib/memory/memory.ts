// Durable memory facade.
//
//   short-term memory  = recent posts / accepted decisions (derived from the
//                        posts + discovery_decisions tables — already durable)
//   long-term memory   = recurring subjects/themes (memory_entries)
//   editorial memory   = what the persona said about a story, plus the
//                        relation of the newest evidence to it
//                        (confirms / updates / contradicts — memory_entries)
//
// Scoping: `agentId` null = persona scope (the discovery → editorial
// pipeline); a real agent id = that agent's posts. Both scopes share the same
// ladder and relations; everything survives restarts via SQLite.

import {
  getAcceptedDecisionCandidates,
  getMemoryEntryBySubject,
  getPostLinks,
  getRecentMemoryEntries,
  getRecentPostsForMemory,
  insertPostLink,
  upsertMemoryEntry,
  type MemoryKind,
  type PostLinkRelation
} from '../db';
import type { Persona } from '../persona';
import {
  detectDuplicate,
  evidenceRelation,
  hasMeaningfulNewInfo,
  KEYWORD_OVERLAP_THRESHOLD,
  memorySubject,
  type DuplicateResult,
  type EvidenceRelation,
  type MemoryItem
} from './dedup';
import {
  createSimilarityProvider,
  jaccard,
  tokenize,
  type SimilarityProvider
} from './similarity';

/** A memory source: an accepted decision, an agent post, or a memory entry. */
export interface MemorySource {
  id: string;
  title: string;
  summary: string | null;
  canonicalUrl: string;
  sourceType: string;
}

export interface RelevantMemory {
  /** Everything the ladder compared against. */
  items: MemoryItem[];
  /** Ladder result: level 1/2/4 → duplicate, level 3 → follow-up story. */
  duplicate: DuplicateResult;
  /** The level-3 story match (same story, needs meaningful new info). */
  followUp: { item: MemoryItem; similarity: number } | null;
  /** Evidence relation of the candidate to the matched story. */
  relation: EvidenceRelation;
  /** Follow-up carries meaningful new information (ids / new tokens). */
  meaningful: boolean;
  /** 0..1 how strongly the candidate matches the persona's recurring themes
   *  (persona-driven retrieval; 0 when no persona is supplied). */
  personaAffinity: number;
}

/** Gather the durable memory set for a scope (decisions/posts + memory
 *  entries). `source` selects the content base: 'decisions' (accepted
 *  editorial decisions — what the pipeline said) or 'posts' (published posts).
 *  Default: decisions for the persona scope, posts for a real agent. The
 *  decision base is scoped to the agent, so one agent's accepted content never
 *  leaks into another agent's memory ladder. */
export function gatherMemoryItems(
  agentId: string | null,
  opts: { memoryLimit?: number; source?: 'decisions' | 'posts' } = {}
): MemoryItem[] {
  const items: MemoryItem[] = [];
  const source = opts.source ?? (agentId === null ? 'decisions' : 'posts');
  if (source === 'decisions') {
    for (const accepted of getAcceptedDecisionCandidates(agentId)) {
      items.push({
        id: accepted.id,
        title: accepted.title,
        summary: accepted.summary,
        canonicalUrl: accepted.canonicalUrl,
        kind: 'accepted'
      });
    }
  } else {
    for (const post of getRecentPostsForMemory(agentId as string, 100)) {
      items.push({
        id: post.id,
        title: post.title,
        summary: post.body,
        canonicalUrl: post.canonicalUrl ?? '',
        kind: 'post'
      });
    }
  }
  for (const entry of getRecentMemoryEntries({ agentId, kinds: ['long_term', 'editorial'], limit: opts.memoryLimit ?? 300 })) {
    items.push({
      id: entry.id,
      title: entry.subject,
      summary: entry.content,
      canonicalUrl: typeof entry.metadata?.canonicalUrl === 'string' ? entry.metadata.canonicalUrl : '',
      kind: entry.kind
    });
  }
  return items;
}

function personaThemeTokens(persona: Persona): Set<string> {
  return tokenize([...persona.recurringThemes, ...persona.expertise].join(' '));
}

/** 0..1 affinity between a candidate and the persona's recurring themes. */
export function personaAffinityOf(persona: Persona, candidate: MemorySource): number {
  return jaccard(tokenize(`${candidate.title} ${candidate.summary ?? ''}`), personaThemeTokens(persona));
}

/** Best level-3 story match, tie-broken by persona theme overlap so the
 *  persona's recurring themes shape which memory is retrieved. */
function bestFollowUpMatch(
  candidate: MemorySource,
  items: MemoryItem[],
  persona: Persona | undefined
): { item: MemoryItem; similarity: number } | null {
  const candidateTitleTokens = tokenize(candidate.title);
  const themes = persona ? personaThemeTokens(persona) : null;
  let best: { item: MemoryItem; similarity: number; themeOverlap: number } | null = null;
  for (const item of items) {
    const similarity = jaccard(candidateTitleTokens, tokenize(item.title));
    if (similarity < KEYWORD_OVERLAP_THRESHOLD) continue;
    const themeOverlap = themes ? jaccard(tokenize(item.title), themes) : 0;
    if (
      !best ||
      similarity > best.similarity ||
      (similarity === best.similarity && themeOverlap > best.themeOverlap)
    ) {
      best = { item, similarity, themeOverlap };
    }
  }
  return best ? { item: best.item, similarity: best.similarity } : null;
}

/**
 * Retrieve the memory relevant to a candidate: run the duplicate ladder over
 * the durable memory set and classify the outcome (duplicate vs follow-up
 * story), computing the evidence relation and meaningful-new-info verdict.
 * A supplied persona shapes retrieval (theme tie-break) and reports how
 * on-theme the candidate is.
 */
export function getRelevantMemory(
  agentId: string | null,
  candidate: MemorySource,
  opts: { provider?: SimilarityProvider; items?: MemoryItem[]; persona?: Persona } = {}
): RelevantMemory {
  const provider = opts.provider ?? createSimilarityProvider();
  const items = opts.items ?? gatherMemoryItems(agentId);
  const duplicate = detectDuplicate(
    { title: candidate.title, summary: candidate.summary, canonicalUrl: candidate.canonicalUrl },
    items,
    provider
  );
  let followUp: { item: MemoryItem; similarity: number } | null = null;
  if (duplicate.level === 3) {
    followUp = bestFollowUpMatch(candidate, items, opts.persona);
  }
  const target = followUp ? followUp.item : duplicate.match;
  const relation = target ? evidenceRelation(candidate, target) : 'confirms';
  const meaningful = target ? hasMeaningfulNewInfo(candidate, target) : true;
  return {
    items,
    duplicate,
    followUp,
    relation,
    meaningful,
    personaAffinity: opts.persona ? personaAffinityOf(opts.persona, candidate) : 0
  };
}

/**
 * Record durable memory from content the persona put out (an accepted
 * candidate or a published post): the story subject becomes long-term memory,
 * and an editorial-memory entry records the persona's stance + how the newest
 * evidence relates to the prior stance.
 */
export function recordMemoryForAccepted(
  agentId: string | null,
  source: MemorySource,
  opts: { nowMs: number; followUp?: { subject: string; relation: EvidenceRelation }; persona?: Persona }
): void {
  const { nowMs } = opts;
  // Story subject: for a follow-up, keep the STORY's subject so the recurring
  // theme and stance accumulate on one key; otherwise the candidate's own.
  const storySubject = opts.followUp ? memorySubject(opts.followUp.subject) : memorySubject(source.title);
  const relation = opts.followUp?.relation ?? 'confirms';
  const identifiers = identifiersFrom(source);
  // Persona-driven tagging: which recurring themes does this content touch?
  const themes = opts.persona
    ? opts.persona.recurringThemes.filter(theme =>
        `${source.title} ${source.summary ?? ''}`.toLowerCase().includes(theme.toLowerCase())
      )
    : [];

  upsertMemoryEntry({
    agentId,
    kind: 'long_term',
    subject: storySubject,
    content: source.title,
    importance: 2,
    metadata: { sourceType: source.sourceType, themes },
    nowMs
  });

  upsertMemoryEntry({
    agentId,
    kind: 'editorial',
    subject: storySubject,
    content: `${source.title}. ${source.summary}`,
    importance: 3,
    metadata: {
      canonicalUrl: source.canonicalUrl,
      relation,
      sourceType: source.sourceType,
      identifiers,
      themes
    },
    nowMs
  });
}

/** Read the current editorial stance on a story (for tests + tooling). */
export function getEditorialStance(
  agentId: string | null,
  subject: string
): { relation: EvidenceRelation; content: string; occurrences: number } | null {
  const entry = getMemoryEntryBySubject(agentId, 'editorial', memorySubject(subject));
  if (!entry) return null;
  const relation = (entry.metadata?.relation as EvidenceRelation | undefined) ?? 'confirms';
  return { relation, content: entry.content, occurrences: entry.occurrences };
}

export interface PostLinkInfo {
  postId: string;
  relatedPostId: string;
  relationType: PostLinkRelation;
  similarity: number;
  reason: string;
  title: string;
}

/**
 * Persist links from a freshly published post to related earlier posts of the
 * same agent. Uses the duplicate ladder (levels 2–4; level-1 URL matches are
 * impossible here because duplicate publication is blocked upstream) and the
 * evidence relation to choose the link type.
 */
export function linkRelatedPosts(
  agentId: string,
  newPostId: string,
  nowMs: number,
  opts: { provider?: SimilarityProvider } = {}
): PostLinkInfo[] {
  const provider = opts.provider ?? createSimilarityProvider();
  const posts = getRecentPostsForMemory(agentId, 100);
  const newPost = posts.find(p => p.id === newPostId);
  if (!newPost) return [];

  const newContent = { title: newPost.title, summary: newPost.body };
  const links: PostLinkInfo[] = [];

  for (const earlier of posts) {
    if (earlier.id === newPostId) continue;
    const result = detectDuplicate(
      { ...newContent, canonicalUrl: newPost.canonicalUrl ?? '' },
      [
        {
          id: earlier.id,
          title: earlier.title,
          summary: earlier.body,
          canonicalUrl: earlier.canonicalUrl ?? '',
          kind: 'post' as const
        }
      ],
      provider
    );
    if (result.level === 0) continue;

    const relation = evidenceRelation(newContent, { title: earlier.title, summary: earlier.body });
    const relationType = linkTypeFor(result.level, relation);
    const reason = linkReason(result.level, relation, earlier.title);
    insertPostLink({
      postId: newPostId,
      relatedPostId: earlier.id,
      relationType,
      similarity: result.similarity,
      reason,
      nowMs
    });
    links.push({
      postId: newPostId,
      relatedPostId: earlier.id,
      relationType,
      similarity: result.similarity,
      reason,
      title: earlier.title
    });
  }

  return links;
}

function linkTypeFor(level: number, relation: EvidenceRelation): PostLinkRelation {
  if (level === 3) {
    if (relation === 'updates') return 'updates';
    if (relation === 'contradicts') return 'contradicts';
    if (relation === 'confirms') return 'confirms';
    return 'follow_up';
  }
  return 'related';
}

function linkReason(level: number, relation: EvidenceRelation, title: string): string {
  if (level === 3) {
    return `Same story as "${title}" — ${relation} the earlier report.`;
  }
  return `Near-duplicate of "${title}" (ladder level ${level}).`;
}

function identifiersFrom(source: MemorySource): string[] {
  const found: string[] = [];
  const re = /\b(CVE-\d{4}-\d{4,}|GHSA-[0-9A-Za-z-]{4,}|arxiv\.org\/abs\/\d{4}\.\d{4,})\b/gi;
  for (const m of `${source.title} ${source.summary} ${source.canonicalUrl}`.matchAll(re)) {
    found.push(m[1]);
  }
  return [...new Set(found)];
}

export { getPostLinks };
export type { MemoryKind };
