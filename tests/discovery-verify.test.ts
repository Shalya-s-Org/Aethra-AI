import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeCandidate, type DiscoveredCandidate } from '../src/lib/discovery/types';
import { verifyCanonicalUrl, hostsOfLabFeeds } from '../src/lib/discovery/verify';
import { runDiscovery } from '../src/lib/discovery/runner';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-verify-test-'));
process.env.AETHRA_DB_PATH = path.join(TMP_DIR, 'verify.db');
process.env.AETHRA_LAB_FEEDS = 'https://lab.example.com/feed';

import { closeDb, getDiscoveryCandidates } from '../src/lib/db';

after(() => {
  delete process.env.AETHRA_LAB_FEEDS;
  closeDb();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

function candidate(over: Partial<Parameters<typeof makeCandidate>[0]> & { canonicalUrl: string; sourceType: DiscoveredCandidate['sourceType'] }): DiscoveredCandidate {
  const c = makeCandidate({
    title: 't',
    summary: 's',
    publishedAt: '2026-07-01T00:00:00.000Z',
    sourceName: 'S',
    rawEvidence: '{}',
    ...over
  });
  assert.ok(c, 'candidate must normalize');
  return c;
}

describe('canonical URL verification', () => {
  it('accepts https URLs on the allowlisted host for each source type', () => {
    assert.equal(verifyCanonicalUrl(candidate({ sourceType: 'cisa-kev', canonicalUrl: 'https://nvd.nist.gov/vuln/detail/CVE-2026-12345' })), true);
    assert.equal(verifyCanonicalUrl(candidate({ sourceType: 'github-advisory', canonicalUrl: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc' })), true);
    assert.equal(verifyCanonicalUrl(candidate({ sourceType: 'arxiv', canonicalUrl: 'https://arxiv.org/abs/2608.12345' })), true);
    assert.equal(verifyCanonicalUrl(candidate({ sourceType: 'github-release', canonicalUrl: 'https://github.com/ollama/ollama/releases/tag/v2.1.0' })), true);
    assert.equal(verifyCanonicalUrl(candidate({ sourceType: 'lab-feed', canonicalUrl: 'https://lab.example.com/security/item' }), ['lab.example.com']), true);
  });

  it('rejects foreign hosts, non-https, and malformed URLs', () => {
    // Same source type, wrong host (e.g. a feed smuggling attacker.com).
    assert.equal(verifyCanonicalUrl(candidate({ sourceType: 'github-advisory', canonicalUrl: 'https://attacker.example/advisories/GHSA-aaaa' })), false);
    assert.equal(verifyCanonicalUrl(candidate({ sourceType: 'cisa-kev', canonicalUrl: 'https://evil.example/CVE-2026-12345' })), false);
    // A raw non-https URL never passes the gate directly (the pipeline
    // canonicalizes before this point, but the gate must not trust http).
    assert.equal(
      verifyCanonicalUrl({
        id: 'x',
        title: 't',
        summary: '',
        publishedAt: '2026-07-01T00:00:00.000Z',
        canonicalUrl: 'http://arxiv.org/abs/2608.12345',
        sourceName: 'arXiv',
        sourceType: 'arxiv',
        rawEvidence: '{}'
      }),
      false
    );
    // Not a URL at all.
    assert.equal(verifyCanonicalUrl(candidate({ sourceType: 'github-release', canonicalUrl: 'not-a-url' })), false);
    // Lab-feed candidate on a host outside the configured allowlist.
    assert.equal(verifyCanonicalUrl(candidate({ sourceType: 'lab-feed', canonicalUrl: 'https://not-configured.example/x' }), ['lab.example.com']), false);
  });

  it('derives lab-feed hosts from the configured feed URLs', () => {
    assert.deepEqual(hostsOfLabFeeds(['https://openai.com/news/rss.xml', 'https://security.googleblog.com/feeds/posts/default']).sort(), [
      'openai.com',
      'security.googleblog.com'
    ]);
    assert.deepEqual(hostsOfLabFeeds(['not-a-url']), []);
  });
});

describe('runner applies verification before persistence', () => {
  it('drops candidates with un-allowlisted hosts and reports them as filtered', async () => {
    const LAB_URL = 'https://lab.example.com/feed';
    const labBody = `<?xml version="1.0"?><rss version="2.0"><channel><title>t</title>
      <item><title>Good item</title><link>https://lab.example.com/security/good</link><pubDate>Wed, 01 Jul 2026 00:00:00 GMT</pubDate></item>
      <item><title>Sneaky item</title><link>https://evil.example/security/bad</link><pubDate>Wed, 01 Jul 2026 00:00:00 GMT</pubDate></item>
    </channel></rss>`;
    const routes: Record<string, { status?: number; body?: string }> = {
      [LAB_URL]: { body: labBody }
    };
    const impl = (async (url: string) => {
      const route = routes[url];
      if (!route) return new Response('Not Found', { status: 404 });
      return new Response(route.body, { status: route.status ?? 200 });
    }) as typeof fetch;

    const summary = await runDiscovery({ sources: ['AI Lab Security Feeds'], fetchImpl: impl, now: 1_750_000_000_000 });
    assert.equal(summary.totalCandidates, 1, 'only the allowlisted-host item survives');
    assert.equal(summary.filtered, 1, 'the foreign-host item is filtered, never persisted');
    const rows = getDiscoveryCandidates({ limit: 10 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].canonicalUrl, 'https://lab.example.com/security/good');
  });
});
