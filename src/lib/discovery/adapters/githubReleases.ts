import { fetchJson } from '../http';
import { makeCandidate, type AdapterFetchDetail, type AdapterResult, type DiscoveredCandidate, type DiscoveryAdapter } from '../types';

// GitHub releases for a small, operator-controlled allowlist of AI
// infrastructure repos where security fixes land. Repos are configurable via
// AETHRA_GITHUB_REPOS (comma-separated owner/repo pairs); only the allowlist
// is ever requested.
export const DEFAULT_GITHUB_REPOS: string[] = [
  'ollama/ollama',
  'huggingface/transformers',
  'langchain-ai/langchain'
];

const SECURITY_TERMS =
  /cve|security|vulnerab|exploit|sandbox|jailbreak|prompt injection|bypass|privilege|denial of service|ssrf|rce|remote code|memory saf/i;

function configuredRepos(): string[] {
  const env = process.env.AETHRA_GITHUB_REPOS;
  if (!env) return DEFAULT_GITHUB_REPOS;
  return env
    .split(',')
    .map(s => s.trim())
    .filter(s => /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(s));
}

interface GithubRelease {
  tag_name?: string;
  name?: string | null;
  published_at?: string;
  html_url?: string;
  body?: string | null;
  prerelease?: boolean;
  draft?: boolean;
}

/** Pure parse — exported for offline fixture tests. */
export function parseGithubReleases(payload: unknown): DiscoveredCandidate[] {
  if (!Array.isArray(payload)) return [];
  const candidates: DiscoveredCandidate[] = [];
  for (const raw of payload) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as GithubRelease;
    if (r.draft) continue;
    const text = `${r.name ?? ''} ${r.body ?? ''} ${r.tag_name ?? ''}`;
    // Only surface releases that mention security-relevant terms — the persona
    // is an AI security analyst, not a general release tracker.
    if (!SECURITY_TERMS.test(text)) continue;
    const title = `${r.name || r.tag_name || 'Release'} (${r.tag_name ?? ''})`.trim();
    const summary = (r.body ?? '').trim().split('\n')[0].slice(0, 500);
    const candidate = makeCandidate({
      title,
      summary,
      publishedAt: r.published_at ?? '',
      canonicalUrl: r.html_url ?? '',
      sourceName: 'GitHub Releases',
      sourceType: 'github-release',
      rawEvidence: JSON.stringify(r)
    });
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

export const githubReleasesAdapter: DiscoveryAdapter = {
  name: 'GitHub Releases',
  sourceType: 'github-release',
  url: `https://api.github.com/repos/${configuredRepos()[0] ?? 'ollama/ollama'}/releases?per_page=5`,
  async fetch(fetchImpl): Promise<AdapterResult> {
    const repos = configuredRepos();
    if (repos.length === 0) return { candidates: [], error: 'No allowlisted GitHub repos configured.' };

    const all: DiscoveredCandidate[] = [];
    const fetches: AdapterFetchDetail[] = [];
    for (const repo of repos) {
      const url = `https://api.github.com/repos/${repo}/releases?per_page=5`;
      const result = await fetchJson(fetchImpl, url, { retries: 1 });
      if (!result.ok) {
        fetches.push({ url, status: 'failure', error: result.error ?? 'unknown fetch error' });
        continue;
      }
      const items = parseGithubReleases(result.data);
      all.push(...items);
      fetches.push({ url, status: 'success', itemCount: items.length });
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
