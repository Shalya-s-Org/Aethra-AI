import type { DiscoveryAdapter } from '../types';
import { githubAdvisoriesAdapter } from './githubAdvisories';
import { cisaKevAdapter } from './cisaKev';
import { arxivAdapter } from './arxiv';
import { labFeedsAdapter } from './labFeeds';
import { githubReleasesAdapter } from './githubReleases';

/**
 * All allowlisted discovery sources, in execution order. Every adapter only
 * ever requests its own configured feed URL(s); nothing retrieved from a feed
 * can cause another request (no content-derived fetching).
 */
export const ADAPTERS: DiscoveryAdapter[] = [
  githubAdvisoriesAdapter,
  cisaKevAdapter,
  arxivAdapter,
  labFeedsAdapter,
  githubReleasesAdapter
];

export { githubAdvisoriesAdapter, cisaKevAdapter, arxivAdapter, labFeedsAdapter, githubReleasesAdapter };
export { parseGithubAdvisories } from './githubAdvisories';
export { parseCisaKev } from './cisaKev';
export { parseArxivAtom } from './arxiv';
export { parseFeed } from './labFeeds';
export { parseGithubReleases } from './githubReleases';
