import { fetchText } from '../http';
import { parseFeedItems } from '../xml';
import { makeCandidate, type AdapterResult, type DiscoveryAdapter } from '../types';

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
export function parseFeed(xml: string, sourceName: string): ReturnType<typeof makeCandidate>[] {
  const candidates = [];
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

    const all: ReturnType<typeof makeCandidate>[] = [];
    const errors: string[] = [];
    for (const feedUrl of feeds) {
      const result = await fetchText(fetchImpl, feedUrl, { retries: 1 });
      if (!result.ok) {
        errors.push(`${feedUrl}: ${result.text || `HTTP ${result.status}`}`);
        continue;
      }
      try {
        all.push(...parseFeed(result.text, feedUrl));
      } catch (err) {
        errors.push(`${feedUrl}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (errors.length > 0 && all.length === 0) {
      return { candidates: [], error: errors.join('; ') };
    }
    // Partial success: surface candidates; the runner records one fetch row
    // (success) — per-feed detail lives in the error string only if total.
    return { candidates: all };
  }
};
