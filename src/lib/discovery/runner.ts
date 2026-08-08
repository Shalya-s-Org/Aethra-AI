import { ulid } from '../ids';
import { ADAPTERS } from './adapters';
import {
  insertDiscoveryCandidate,
  insertDiscoveryFetch,
  type DiscoveryFetchRow
} from '../db';
import type { AdapterFetchDetail, DiscoveredCandidate } from './types';

// Manual discovery runner — the ONLY entry point that hits live sources.
// Deliberately separate from the agent pipeline: it writes to
// discovery_candidates / discovery_fetches, never to posts, so GET
// /api/agent/feed (a pure projection of posts) is unaffected.

export interface RunDiscoveryOptions {
  /** Restrict to specific adapter names (default: all allowlisted sources). */
  sources?: string[];
  /** Injectable for offline fixture tests. */
  fetchImpl?: typeof fetch;
  /** Injectable for deterministic tests. */
  now?: number;
}

export interface DiscoverySummary {
  runId: string;
  startedAt: string; // ISO UTC
  finishedAt: string; // ISO UTC
  candidates: DiscoveredCandidate[];
  totalCandidates: number;
  /** Candidates newly persisted this run (dedup by canonical URL). */
  newCandidates: number;
  fetches: DiscoveryFetchRow[];
  failures: Array<{ sourceName: string; error: string }>;
}

export async function runDiscovery(options: RunDiscoveryOptions = {}): Promise<DiscoverySummary> {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now();
  const adapters =
    options.sources && options.sources.length > 0
      ? ADAPTERS.filter(a => options.sources!.includes(a.name))
      : ADAPTERS;

  const startedAt = new Date(now).toISOString();
  const runId = ulid(now);
  const candidates: DiscoveredCandidate[] = [];
  const fetches: DiscoveryFetchRow[] = [];
  const failures: Array<{ sourceName: string; error: string }> = [];
  let newCandidates = 0;

  for (const adapter of adapters) {
    // Per-source error isolation: one flaky source never aborts the run.
    let result: AdapterResultSafe;
    try {
      result = await adapter.fetch(fetchImpl);
    } catch (err) {
      result = { candidates: [], error: err instanceof Error ? err.message : String(err) };
    }

    const details: AdapterFetchDetail[] =
      result.fetches ??
      [
        {
          url: adapter.url,
          status: result.error ? 'failure' : 'success',
          itemCount: result.error ? undefined : result.candidates.length,
          error: result.error
        }
      ];

    for (const detail of details) {
      const id = ulid(now);
      const row: DiscoveryFetchRow = {
        id,
        sourceName: adapter.name,
        sourceType: adapter.sourceType,
        url: detail.url,
        status: detail.status,
        itemCount: detail.itemCount ?? null,
        error: detail.error ?? null,
        fetchedAt: startedAt
      };
      insertDiscoveryFetch({
        id,
        sourceName: row.sourceName,
        sourceType: row.sourceType,
        url: row.url,
        status: row.status,
        itemCount: row.itemCount,
        error: row.error,
        fetchedAtMs: now
      });
      fetches.push(row);
    }

    if (result.error) {
      failures.push({ sourceName: adapter.name, error: result.error });
      continue;
    }

    for (const candidate of result.candidates) {
      candidates.push(candidate);
      if (insertDiscoveryCandidate(candidate, now)) newCandidates += 1;
    }
  }

  return {
    runId,
    startedAt,
    finishedAt: new Date(now).toISOString(),
    candidates,
    totalCandidates: candidates.length,
    newCandidates,
    fetches,
    failures
  };
}

interface AdapterResultSafe {
  candidates: DiscoveredCandidate[];
  error?: string;
  fetches?: AdapterFetchDetail[];
}
