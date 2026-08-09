// Canonical URL verification for discovered candidates.
//
// Every candidate's canonical URL must be https and must live on a host the
// source type is allowed to produce. This is the second gate (after
// makeCandidate's https normalization): a compromised or malformed feed can
// never smuggle an arbitrary host into the candidate pool — and therefore
// never into a published post's citations. Verification is purely syntactic +
// allowlist matching; it NEVER fetches anything.
//
//   cisa-kev        → NVD detail pages (the KEV entry's CVE maps to NVD)
//   github-advisory → github.com/advisories/*
//   arxiv           → arxiv.org/abs/*
//   github-release  → github.com releases
//   lab-feed        → the operator-configured feed hosts (checked against the
//                     allowlisted feed URLs, never content-derived)

import type { DiscoveredCandidate } from './types';

const DEFAULT_HOSTS: Record<string, string[]> = {
  'cisa-kev': ['nvd.nist.gov'],
  'github-advisory': ['github.com'],
  arxiv: ['arxiv.org'],
  'github-release': ['github.com']
};

/** The hosts the configured lab feeds may produce (extracted from the
 *  operator-controlled https feed allowlist). */
export function hostsOfLabFeeds(feedUrls: string[]): string[] {
  const hosts = new Set<string>();
  for (const url of feedUrls) {
    try {
      hosts.add(new URL(url).hostname);
    } catch {
      // Ignore malformed feed URLs — configuredLabFeeds() already rejects them.
    }
  }
  return [...hosts];
}

/** True when the candidate's canonical URL is https and on an allowlisted host
 *  for its source type. `labFeedHosts` is required for lab-feed candidates. */
export function verifyCanonicalUrl(candidate: DiscoveredCandidate, labFeedHosts: string[] = []): boolean {
  let url: URL;
  try {
    url = new URL(candidate.canonicalUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  if (candidate.sourceType === 'lab-feed') {
    return labFeedHosts.includes(url.hostname);
  }
  return (DEFAULT_HOSTS[candidate.sourceType] ?? []).includes(url.hostname);
}
