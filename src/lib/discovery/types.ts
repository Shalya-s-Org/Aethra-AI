import { canonicalizeSourceUrl } from '../urls';
import { ulid } from '../ids';

// Live topic discovery — common types.
//
// Every allowlisted source adapter normalizes its raw payload into
// DiscoveredCandidate. Candidates are persisted to the discovery_candidates
// table (deduplicated by canonical URL) and NEVER trigger any further network
// fetching: the only URLs the runner requests are the allowlisted feed URLs
// configured in code/environment.

export type SourceType =
  | 'github-advisory'
  | 'cisa-kev'
  | 'arxiv'
  | 'lab-feed'
  | 'github-release';

export interface DiscoveredCandidate {
  /** ULID, assigned at persist time. */
  id: string;
  title: string;
  summary: string;
  /** ISO-8601 UTC. */
  publishedAt: string;
  /** Canonical https URL (scheme-less/http upgraded, query/hash stripped). */
  canonicalUrl: string;
  sourceName: string;
  sourceType: SourceType;
  /** The raw record this candidate was derived from (JSON/XML text). */
  rawEvidence: string;
}

export interface CandidateInput {
  title: string;
  summary: string | null;
  /** Anything Date.parse understands; normalized to ISO UTC. */
  publishedAt: string | number | Date;
  canonicalUrl: string;
  sourceName: string;
  sourceType: SourceType;
  rawEvidence: string;
}

const MAX_SUMMARY_CHARS = 4000;
const MAX_TITLE_CHARS = 300;

/**
 * Normalize a raw record into a candidate, or null if it cannot satisfy the
 * contract (missing title, unparseable date, non-https canonical URL).
 * Canonicalization upgrades http:// to https:// and strips query/hash — the
 * URL is derived from the allowlisted feed payload structure, never fetched.
 */
export function makeCandidate(input: CandidateInput): DiscoveredCandidate | null {
  const canonicalUrl = canonicalizeSourceUrl(input.canonicalUrl);
  if (!canonicalUrl) return null;

  const title = (input.title ?? '').trim();
  if (!title) return null;

  const published = new Date(input.publishedAt);
  if (Number.isNaN(published.getTime())) return null;

  return {
    id: ulid(),
    title: title.slice(0, MAX_TITLE_CHARS),
    summary: (input.summary ?? '').trim().slice(0, MAX_SUMMARY_CHARS),
    publishedAt: published.toISOString(),
    canonicalUrl,
    sourceName: input.sourceName,
    sourceType: input.sourceType,
    rawEvidence: input.rawEvidence
  };
}

export interface AdapterFetchDetail {
  url: string;
  status: 'success' | 'failure';
  itemCount?: number;
  error?: string;
}

export interface AdapterResult {
  candidates: DiscoveredCandidate[];
  /** Present when this source failed outright; candidates is then empty. */
  error?: string;
  /** Per-URL fetch outcomes (multi-URL adapters). Falls back to one row for
   *  adapter.url when omitted. */
  fetches?: AdapterFetchDetail[];
}

/**
 * A discovery source adapter. `fetch` requests ONLY its single allowlisted
 * `url` (via the injected fetch implementation) and normalizes the response.
 * Adapters never follow or fetch URLs found inside retrieved content.
 */
export interface DiscoveryAdapter {
  name: string;
  sourceType: SourceType;
  /** The allowlisted feed URL this adapter is permitted to request. */
  url: string;
  fetch(fetchImpl: typeof fetch): Promise<AdapterResult>;
}
