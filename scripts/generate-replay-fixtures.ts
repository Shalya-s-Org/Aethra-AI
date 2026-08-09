// Generate the committed replay fixture set used by tests/discovery-smoke.test.ts.
//
// The smoke test runs the FULL adapter stack (all default allowlisted sources)
// against these recorded responses, so CI is deterministic with no network.
// Bodies reuse the existing per-adapter fixtures (tests/fixtures/*) plus small
// synthetic payloads for the additional default URLs (second lab feed, extra
// release repos). Run `npm run generate-fixtures` after changing the default
// allowlist or fixture bodies; a maintainer can refresh from LIVE endpoints
// with `npm run record-fixtures` instead.
//
// NOTE: run with the default env (no AETHRA_LAB_FEEDS / AETHRA_GITHUB_REPOS),
// exactly like the smoke test that consumes these files.

import fs from 'node:fs';
import path from 'node:path';
import { fixtureFileName, type ReplayEntry } from '../src/lib/discovery/replay';
import { CISA_KEV_URL } from '../src/lib/discovery/adapters/cisaKev';
import { GITHUB_ADVISORIES_URL } from '../src/lib/discovery/adapters/githubAdvisories';
import { arxivAdapter } from '../src/lib/discovery/adapters/arxiv';
import { DEFAULT_LAB_FEEDS } from '../src/lib/discovery/adapters/labFeeds';
import { DEFAULT_GITHUB_REPOS } from '../src/lib/discovery/adapters/githubReleases';

const OUT_DIR = path.join(process.cwd(), 'tests', 'fixtures', 'replay');
const read = (name: string): string => fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', name), 'utf8');

const releasesUrl = (repo: string): string => `https://api.github.com/repos/${repo}/releases?per_page=5`;

// Synthetic bodies for the URLs that have no dedicated fixture file. Hosts
// match the configured feed/repo hosts so canonical-URL verification passes.
const OPENAI_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>OpenAI News</title>
    <link>https://openai.com/news/</link>
    <description>OpenAI announcements</description>
    <item>
      <title>Security update: hardening the ChatGPT plugin sandbox</title>
      <link>https://openai.com/news/security-sandbox-hardening/</link>
      <description>We shipped hardening for the plugin execution sandbox and a security advisory for a prompt-injection vector.</description>
      <pubDate>Mon, 20 Jul 2026 14:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Introducing new model capabilities for developers</title>
      <link>https://openai.com/news/model-capabilities/</link>
      <description>New API features for building agentic applications.</description>
      <pubDate>Mon, 20 Jul 2026 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const GOOGLE_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Google Online Security Blog</title>
    <link>https://security.googleblog.com/</link>
    <description>Security research and announcements</description>
    <item>
      <title>New research: practical attacks on LLM tool orchestration</title>
      <link>https://security.googleblog.com/2026/07/llm-tool-orchestration-attacks.html</link>
      <description>Google security researchers detail practical prompt-injection attacks against LLM tool orchestration and mitigations.</description>
      <pubDate>Tue, 21 Jul 2026 09:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const EXTRA_RELEASE = (repo: string, tag: string, body: string): string =>
  JSON.stringify([
    {
      tag_name: tag,
      name: `${tag} — Security release`,
      published_at: '2026-07-22T16:00:00Z',
      html_url: `https://github.com/${repo}/releases/tag/${tag}`,
      body,
      prerelease: false,
      draft: false
    }
  ]);

const entries: ReplayEntry[] = [
  { url: CISA_KEV_URL, status: 200, body: read('cisa-kev.json') },
  { url: GITHUB_ADVISORIES_URL, status: 200, body: read('github-advisories.json') },
  { url: arxivAdapter.url, status: 200, body: read('arxiv.xml') },
  { url: DEFAULT_LAB_FEEDS[0], status: 200, body: OPENAI_FEED },
  { url: DEFAULT_LAB_FEEDS[1], status: 200, body: GOOGLE_FEED },
  {
    url: releasesUrl(DEFAULT_GITHUB_REPOS[0]),
    status: 200,
    body: read('github-releases.json')
  },
  {
    url: releasesUrl(DEFAULT_GITHUB_REPOS[1]),
    status: 200,
    body: EXTRA_RELEASE(
      DEFAULT_GITHUB_REPOS[1],
      'v4.55.0',
      'Security fix: deserialization guard against untrusted checkpoints (CVE-2026-40101).'
    )
  },
  {
    url: releasesUrl(DEFAULT_GITHUB_REPOS[2]),
    status: 200,
    body: EXTRA_RELEASE(
      DEFAULT_GITHUB_REPOS[2],
      'v0.3.500',
      'Patched a prompt-injection vector in tool-calling (GHSA-lc-500).'
    )
  }
];

fs.mkdirSync(OUT_DIR, { recursive: true });
// Clear stale entries so a renamed URL never lingers as a dead record.
for (const file of fs.readdirSync(OUT_DIR)) {
  if (file.endsWith('.json')) fs.rmSync(path.join(OUT_DIR, file));
}
for (const entry of entries) {
  fs.writeFileSync(
    path.join(OUT_DIR, fixtureFileName(entry.url)),
    JSON.stringify(entry, null, 2)
  );
}
console.log(`Wrote ${entries.length} replay fixtures to ${OUT_DIR}`);
for (const e of entries) console.log(`  ${e.status} ${e.url}`);
