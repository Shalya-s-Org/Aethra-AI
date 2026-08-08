import { fetchText } from '../http';
import { extractXmlBlocks, xmlField } from '../xml';
import { makeCandidate, type AdapterResult, type DiscoveredCandidate, type DiscoveryAdapter } from '../types';

// arXiv API (Atom XML). The query is a fixed allowlisted phrase search for
// AI-security research; it can be overridden via AETHRA_ARXIV_QUERY, which is
// sanitized to letters/digits/spaces so it can never alter the request shape.
const ARXIV_API = 'https://export.arxiv.org/api/query';

const DEFAULT_PHRASES = [
  'adversarial machine learning',
  'prompt injection',
  'AI safety',
  'machine learning security',
  'LLM security'
];

export function buildArxivQuery(phrases: string[] = DEFAULT_PHRASES): string {
  const safe = phrases
    .map(p => p.replace(/[^a-zA-Z0-9 ]/g, '').trim())
    .filter(Boolean);
  const query = safe.map(p => `all:"${p}"`).join('+OR+');
  return query.replace(/ /g, '+');
}

function arxivQueryUrl(query: string): string {
  return `${ARXIV_API}?search_query=${query}&start=0&max_results=15&sortBy=submittedDate&sortOrder=descending`;
}

/** Pure parse — exported for offline fixture tests. */
export function parseArxivAtom(xml: string): DiscoveredCandidate[] {
  const entries = extractXmlBlocks(xml, 'entry');
  const candidates: DiscoveredCandidate[] = [];
  for (const block of entries) {
    const title = xmlField(block, 'title');
    const summary = xmlField(block, 'summary');
    const published = xmlField(block, 'published');
    let link = xmlField(block, 'id'); // e.g. http://arxiv.org/abs/2412.19437v2
    if (link) {
      // Strip the version suffix so v1/v2 of the same paper share one canonical URL.
      link = link.replace(/v\d+$/, '');
    }
    if (!title || !link) continue;
    const candidate = makeCandidate({
      title,
      summary,
      publishedAt: published ?? '',
      canonicalUrl: link,
      sourceName: 'arXiv',
      sourceType: 'arxiv',
      rawEvidence: block
    });
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

export const arxivAdapter: DiscoveryAdapter = {
  name: 'arXiv',
  sourceType: 'arxiv',
  url: arxivQueryUrl(buildArxivQuery()),
  async fetch(fetchImpl): Promise<AdapterResult> {
    const result = await fetchText(fetchImpl, this.url, { retries: 2 });
    if (!result.ok) return { candidates: [], error: result.error ?? 'unknown fetch error' };
    try {
      return { candidates: parseArxivAtom(result.text) };
    } catch (err) {
      return { candidates: [], error: err instanceof Error ? err.message : String(err) };
    }
  }
};
