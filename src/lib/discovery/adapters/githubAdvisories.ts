import { fetchJson } from '../http';
import { makeCandidate, type AdapterResult, type DiscoveryAdapter } from '../types';

// GitHub global Security Advisory database (unauthenticated; 60 req/hr IP
// limit). Only this allowlisted URL is ever requested.
export const GITHUB_ADVISORIES_URL = 'https://api.github.com/advisories';

interface GitHubAdvisory {
  ghsa_id?: string;
  cve_id?: string | null;
  summary?: string;
  severity?: string;
  published_at?: string;
  html_url?: string;
  vulnerabilities?: Array<{ package?: { name?: string; ecosystem?: string }; severity?: string }>;
}

/** Pure parse — exported for offline fixture tests. */
export function parseGithubAdvisories(payload: unknown): ReturnType<typeof makeCandidate>[] {
  if (!Array.isArray(payload)) return [];
  const candidates = [];
  for (const raw of payload) {
    if (!raw || typeof raw !== 'object') continue;
    const a = raw as GitHubAdvisory;
    const id = a.cve_id || a.ghsa_id;
    const title = `${a.ghsa_id ?? a.cve_id ?? 'GHSA'}: ${(a.summary ?? '').trim()}`.trim();
    const packages = (a.vulnerabilities ?? [])
      .map(v => v?.package?.name)
      .filter((n): n is string => Boolean(n))
      .slice(0, 5);
    const summary = [
      (a.summary ?? '').trim(),
      a.severity ? `Severity: ${a.severity}.` : '',
      packages.length > 0 ? `Affected packages: ${packages.join(', ')}.` : ''
    ]
      .filter(Boolean)
      .join(' ');
    const candidate = makeCandidate({
      title,
      summary,
      publishedAt: a.published_at ?? '',
      canonicalUrl: a.html_url ?? (id ? `https://github.com/advisories/${id}` : ''),
      sourceName: 'GitHub Security Advisories',
      sourceType: 'github-advisory',
      rawEvidence: JSON.stringify(a)
    });
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

export const githubAdvisoriesAdapter: DiscoveryAdapter = {
  name: 'GitHub Security Advisories',
  sourceType: 'github-advisory',
  url: GITHUB_ADVISORIES_URL,
  async fetch(fetchImpl): Promise<AdapterResult> {
    const result = await fetchJson(fetchImpl, this.url, { retries: 2 });
    if (!result.ok) return { candidates: [], error: result.text || `HTTP ${result.status}` };
    try {
      return { candidates: parseGithubAdvisories(result.data) };
    } catch (err) {
      return { candidates: [], error: err instanceof Error ? err.message : String(err) };
    }
  }
};
