import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Scratch DB + deterministic allowlists BEFORE importing the discovery modules.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-discovery-test-'));
process.env.AETHRA_DB_PATH = path.join(TMP_DIR, 'discovery.db');
process.env.AETHRA_LAB_FEEDS = 'https://lab.example.com/feed';
process.env.AETHRA_GITHUB_REPOS = 'example/ai-sec';

import { arxivAdapter } from '../src/lib/discovery/adapters/arxiv';
import { CISA_KEV_URL } from '../src/lib/discovery/adapters/cisaKev';
import { GITHUB_ADVISORIES_URL } from '../src/lib/discovery/adapters/githubAdvisories';
import { runDiscovery } from '../src/lib/discovery/runner';
import {
  closeDb,
  getDb,
  getDiscoveryCandidates,
  getDiscoveryFetches
} from '../src/lib/db';

after(() => {
  delete process.env.AETHRA_LAB_FEEDS;
  delete process.env.AETHRA_GITHUB_REPOS;
  closeDb();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const fixture = (name: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', name), 'utf8');

const LAB_URL = 'https://lab.example.com/feed';
const RELEASES_URL = 'https://api.github.com/repos/example/ai-sec/releases?per_page=5';

// Every allowlisted URL the runner is permitted to request.
const ALLOWLIST = [GITHUB_ADVISORIES_URL, CISA_KEV_URL, arxivAdapter.url, LAB_URL, RELEASES_URL];

function buildMock(routes: Record<string, { status?: number; body?: string }>) {
  const requested: string[] = [];
  const impl = (async (url: string) => {
    requested.push(url);
    const route = routes[url];
    if (!route) return new Response('{"message":"Not Found"}', { status: 404 });
    return new Response(route.body, { status: route.status ?? 200 });
  }) as typeof fetch;
  return { impl, requested };
}

function fullRoutes(): Record<string, { status?: number; body?: string }> {
  return {
    [GITHUB_ADVISORIES_URL]: { body: fixture('github-advisories.json') },
    [CISA_KEV_URL]: { body: fixture('cisa-kev.json') },
    [arxivAdapter.url]: { body: fixture('arxiv.xml') },
    [LAB_URL]: { body: fixture('lab-rss.xml') },
    [RELEASES_URL]: { body: fixture('github-releases.json') }
  };
}

const T0 = 1_750_000_000_000;

describe('runDiscovery with mocked sources', () => {
  it('persists candidates and per-source fetch outcomes', async () => {
    const { impl, requested } = buildMock(fullRoutes());
    const summary = await runDiscovery({ fetchImpl: impl, now: T0 });

    assert.equal(summary.failures.length, 0);
    assert.equal(summary.totalCandidates, 10);
    assert.equal(summary.newCandidates, 10);

    // Per-URL fetch rows, all successful with item counts.
    const fetches = getDiscoveryFetches();
    assert.equal(fetches.length, 5);
    assert.ok(fetches.every(f => f.status === 'success'));
    const byUrl = new Map(fetches.map(f => [f.url, f]));
    assert.equal(byUrl.get(GITHUB_ADVISORIES_URL)?.itemCount, 2);
    assert.equal(byUrl.get(CISA_KEV_URL)?.itemCount, 2);
    assert.equal(byUrl.get(arxivAdapter.url)?.itemCount, 2);
    assert.equal(byUrl.get(LAB_URL)?.itemCount, 2);
    assert.equal(byUrl.get(RELEASES_URL)?.itemCount, 2);

    // Candidates persisted with the full shape.
    const rows = getDiscoveryCandidates({ limit: 100 });
    assert.equal(rows.length, 10);
    for (const row of rows) {
      assert.ok(row.canonicalUrl.startsWith('https://'));
      assert.match(row.publishedAt, /Z$/);
      assert.ok(row.rawEvidence.length > 0);
    }

    // The runner only ever requested the allowlisted feed URLs — nothing from
    // retrieved content (e.g. advisory html_url, NVD detail URLs) was fetched.
    assert.deepEqual([...new Set(requested)].sort(), [...ALLOWLIST].sort());
  });

  it('deduplicates by canonical URL across runs', async () => {
    const { impl } = buildMock(fullRoutes());
    await runDiscovery({ fetchImpl: impl, now: T0 });
    const second = await runDiscovery({ fetchImpl: impl, now: T0 + 60_000 });

    assert.equal(second.totalCandidates, 10, 'same candidates found again');
    assert.equal(second.newCandidates, 0, 'no new rows on replay');
    assert.equal(getDiscoveryCandidates({ limit: 100 }).length, 10);
    assert.equal(getDiscoveryFetches().length, 10, 'fetch history grows, candidates do not');
  });

  it('isolates a failing source: run continues, failure is persisted', async () => {
    const routes = fullRoutes();
    routes[arxivAdapter.url] = { status: 500, body: 'boom' };
    const { impl } = buildMock(routes);

    const summary = await runDiscovery({ fetchImpl: impl, now: T0 + 120_000 });
    assert.equal(summary.failures.length, 1);
    assert.equal(summary.failures[0].sourceName, 'arXiv');
    assert.ok(summary.failures[0].error.length > 0);

    // Other sources still produced candidates.
    assert.equal(summary.totalCandidates, 8);
    assert.equal(getDiscoveryCandidates({ limit: 100 }).length, 18, '8 new rows on top of 10');

    const fetches = getDiscoveryFetches();
    const arxivFetch = fetches.find(f => f.url === arxivAdapter.url);
    assert.ok(arxivFetch);
    assert.equal(arxivFetch.status, 'failure');
    assert.ok(arxivFetch.error, 'failure rows must carry the error');
    assert.equal(arxivFetch.itemCount, null);
  });

  it('a source that throws is caught and reported, not fatal', async () => {
    const { impl } = buildMock(fullRoutes());
    const throwing = (async () => {
      throw new Error('socket hang up');
    }) as typeof fetch;

    const summary = await runDiscovery({
      sources: ['CISA KEV'],
      fetchImpl: throwing,
      now: T0
    });
    assert.equal(summary.failures.length, 1);
    assert.equal(summary.failures[0].sourceName, 'CISA KEV');
    assert.equal(summary.totalCandidates, 0);
  });

  it('never writes to the posts table (feed stays a pure projection)', () => {
    const posts = getDb().prepare('SELECT COUNT(*) AS n FROM posts').get();
    assert.equal(Number((posts as { n: number }).n), 0);
  });
});
