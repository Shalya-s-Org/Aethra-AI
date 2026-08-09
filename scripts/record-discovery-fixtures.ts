// Maintainer tool: record LIVE responses for every default allowlisted source
// into tests/fixtures/replay/, refreshing the committed replay set.
//
//   npm run record-fixtures
//
// After recording, re-run the smoke test to confirm the recorded set still
// satisfies the pipeline (parsing, canonical-URL verification, health):
//
//   npx tsx --test tests/discovery-smoke.test.ts
//
// Keep the recorded set committed so CI stays deterministic and offline.

import path from 'node:path';
import { recordLiveFixtures } from '../src/lib/discovery/replay';
import { CISA_KEV_URL } from '../src/lib/discovery/adapters/cisaKev';
import { GITHUB_ADVISORIES_URL } from '../src/lib/discovery/adapters/githubAdvisories';
import { arxivAdapter } from '../src/lib/discovery/adapters/arxiv';
import { DEFAULT_LAB_FEEDS } from '../src/lib/discovery/adapters/labFeeds';
import { DEFAULT_GITHUB_REPOS } from '../src/lib/discovery/adapters/githubReleases';

const urls = [
  CISA_KEV_URL,
  GITHUB_ADVISORIES_URL,
  arxivAdapter.url,
  ...DEFAULT_LAB_FEEDS,
  ...DEFAULT_GITHUB_REPOS.map(repo => `https://api.github.com/repos/${repo}/releases?per_page=5`)
];

const outDir = path.join(process.cwd(), 'tests', 'fixtures', 'replay');
const written = await recordLiveFixtures(globalThis.fetch, urls, outDir);
console.log(`Recorded ${written}/${urls.length} live responses into ${outDir}`);
