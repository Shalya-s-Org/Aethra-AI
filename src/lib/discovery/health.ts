// Source freshness / health status.
//
// One `source_health` row exists per source NAME (updated by the runner after
// every run). Status is derived at read time — never stored — so the same row
// ages correctly without a write:
//
//   ok    — last successful fetch is newer than the stale threshold
//   stale — last successful fetch is older than the threshold (the source may
//           still be reachable, but its data can no longer be trusted as
//           current)
//   down  — the source has failed repeatedly (consecutive_failures ≥ the
//           DOWN_AFTER threshold) or has never succeeded

import type { SourceHealthRow } from '../db';

export type SourceStatus = 'ok' | 'stale' | 'down';

/** A source is DOWN after this many consecutive all-failed runs. */
export const DOWN_AFTER_FAILURES = 3;

/** A source's data is STALE when its last success is older than this.
 *  Overridable via AETHRA_SOURCE_STALE_MS (default 7 days). */
export function sourceStaleThresholdMs(): number {
  const env = Number(process.env.AETHRA_SOURCE_STALE_MS);
  return Number.isFinite(env) && env > 0 ? env : 7 * 24 * 3600_000;
}

export function computeSourceStatus(row: SourceHealthRow, now: number): SourceStatus {
  if (row.consecutiveFailures >= DOWN_AFTER_FAILURES) return 'down';
  if (!row.lastSuccessAt) return 'down'; // never proven working
  const lastSuccessMs = Date.parse(row.lastSuccessAt);
  if (Number.isNaN(lastSuccessMs)) return 'stale';
  return now - lastSuccessMs > sourceStaleThresholdMs() ? 'stale' : 'ok';
}

/** Source names whose health is NOT ok — the set the editorial scorer uses to
 *  cap source-quality credit for stale/down sources. */
export function unhealthySourceNames(rows: SourceHealthRow[], now: number): Set<string> {
  const names = new Set<string>();
  for (const row of rows) {
    if (computeSourceStatus(row, now) !== 'ok') names.add(row.sourceName);
  }
  return names;
}
