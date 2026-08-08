import { fetchText } from '../http';
import { parseFeedItems } from '../xml';
import { makeCandidate, type AdapterFetchDetail, type AdapterResult, type DiscoveredCandidate, type DiscoveryAdapter } from '../types';

// Allowlisted official AI-lab / security-team feeds. The list is configurable
// via AETHRA_LAB_FEEDS (comma-separated https URLs) — but only https URLs are
// ever requested, and the list is operator-controlled, not content-derived.
export const DEFAULT_LAB_FEEDS: string[] = [
  'https://openai.com/news/rss.xml',
  'https://security.googleblog.com/feeds/posts/default'
];

function configuredLabFeeds(): string[] {
  const env = process.env.AETHRA_LAB_FEEDS;
  if (!env) return DEFAULT_LAB_FEEDS;
  const feeds = env
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  // Require https and no credentials/query — only plain https feed URLs.
  return feeds.filter(url => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '';
    } catch {
      return false;
    }
  });
}

/** Pure parse — exported for offline fixture tests. */
export function parseFeed(xml: string, sourceName: string): DiscoveredCandidate[] {
  const candidates: DiscoveredCandidate[] = [];
  for (const item of parseFeedItems(xml)) {
    if (!item.title || !item.link) continue;
    const candidate = makeCandidate({
      title: item.title,
      summary: item.summary,
      publishedAt: item.publishedAt ?? '',
      canonicalUrl: item.link,
      sourceName,
      sourceType: 'lab-feed',
      rawEvidence: item.title + '\n' + (item.summary ?? '')
    });
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

export const labFeedsAdapter: DiscoveryAdapter = {
  name: 'AI Lab Security Feeds',
  sourceType: 'lab-feed',
  // The registry-level URL (used by the runner for one fetch-record row);
  // `fetch` below iterates each allowlisted feed.
  url: configuredLabFeeds()[0] ?? DEFAULT_LAB_FEEDS[0],
  async fetch(fetchImpl): Promise<AdapterResult> {
    const feeds = configuredLabFeeds();
    if (feeds.length === 0) return { candidates: [], error: 'No allowlisted lab feeds configured.' };

    const all: DiscoveredCandidate[] = [];
    const fetches: AdapterFetchDetail[] = [];
    for (const feedUrl of feeds) {
      const result = await fetchText(fetchImpl, feedUrl, { retries: 1 });
      if (!result.ok) {
        fetches.push({ url: feedUrl, status: 'failure', error: result.error ?? 'unknown fetch error' });
        continue;
      }
      const items = parseFeed(result.text, feedUrl);
      all.push(...items);
      fetches.push({ url: feedUrl, status: 'success', itemCount: items.length });
    }

    const failures = fetches.filter(f => f.status === 'failure');
    if (failures.length > 0 && all.length === 0) {
      return {
        candidates: [],
        error: failures.map(f => `${f.url}: ${f.error}`).join('; '),
        fetches
      };
    }
    return { candidates: all, fetches };
  }
};
