// Shared source-type metadata for the AI Security persona's discovery pipeline.
//
// Single source of truth for how each allowlisted source type is ranked and
// scored: the editorial engine imports SOURCE_QUALITY_BASE from here, the
// runner/adapter order uses SOURCE_PRIORITY, and the dashboard shows the
// priority tier. "Primary" sources are the ones that can stand alone for a
// high-impact claim (CISA KEV and GitHub advisories are the authoritative
// advisory bodies; official AI-lab/vendor feeds are primary vendor
// announcements); arXiv and release notes are secondary (great for context,
// never the sole backing for a high-severity claim).

import type { SourceType } from './types';

/** Execution priority — primary sources run first. Higher = more authoritative. */
export const SOURCE_PRIORITY: Record<SourceType, number> = {
  'cisa-kev': 5,
  'github-advisory': 4,
  'lab-feed': 4, // official vendor/AI-lab security announcements
  arxiv: 3,
  'github-release': 2
};

/** Sources authoritative enough to back a high-impact claim on their own. */
export const PRIMARY_SOURCE_TYPES: ReadonlySet<SourceType> = new Set([
  'cisa-kev',
  'github-advisory',
  'lab-feed'
]);

/** Base source-quality score (/15) per source type — used by the editorial
 *  scorer (imported by src/lib/editorial/scoring.ts). */
export const SOURCE_QUALITY_BASE: Record<SourceType, number> = {
  'cisa-kev': 12,
  'github-advisory': 11,
  'lab-feed': 10,
  arxiv: 9,
  'github-release': 7
};

/** Discussion-value base (/10) per source type — kept here with the rest. */
export const DISCUSSION_BASE: Record<SourceType, number> = {
  arxiv: 6,
  'lab-feed': 5,
  'github-advisory': 4,
  'cisa-kev': 4,
  'github-release': 3
};

/** Stable display order for the dashboard (primary first, then secondary). */
export function sourceTypeRank(sourceType: string): number {
  return SOURCE_PRIORITY[sourceType as SourceType] ?? 0;
}

/** Source-quality base for any sourceType string (unknown types get 8). */
export function sourceQualityBase(sourceType: string): number {
  return SOURCE_QUALITY_BASE[sourceType as SourceType] ?? 8;
}

/** Discussion-value base for any sourceType string (unknown types get 4). */
export function discussionBase(sourceType: string): number {
  return DISCUSSION_BASE[sourceType as SourceType] ?? 4;
}
