import { fetchJson } from '../http';
import { makeCandidate, type AdapterResult, type DiscoveredCandidate, type DiscoveryAdapter } from '../types';

// CISA Known Exploited Vulnerabilities catalog (public JSON feed). Entries
// carry no per-entry URL, so the canonical URL is constructed from the CVE id
// onto NVD's stable detail page — a https URL derived from the entry's own
// identifier, never fetched and never taken from retrieved content.
export const CISA_KEV_URL =
  'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

interface KevEntry {
  cveID?: string;
  vendorProject?: string;
  product?: string;
  vulnerabilityName?: string;
  dateAdded?: string;
  shortDescription?: string;
  requiredAction?: string;
  dueDate?: string;
  knownRansomwareCampaignUse?: string;
  notes?: string;
}

/** Pure parse — exported for offline fixture tests. */
export function parseCisaKev(payload: unknown): DiscoveredCandidate[] {
  if (!payload || typeof payload !== 'object') return [];
  const list = (payload as { vulnerabilities?: unknown }).vulnerabilities;
  if (!Array.isArray(list)) return [];

  const candidates: DiscoveredCandidate[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const v = raw as KevEntry;
    const cve = (v.cveID ?? '').trim();
    if (!cve) continue;
    const title = `${v.vulnerabilityName ?? cve} (${cve})`.trim();
    const summary = [
      (v.shortDescription ?? '').trim(),
      v.requiredAction ? `Required action: ${v.requiredAction}` : '',
      v.knownRansomwareCampaignUse === 'Known'
        ? 'Known to be used in ransomware campaigns.'
        : ''
    ]
      .filter(Boolean)
      .join(' ');
    const candidate = makeCandidate({
      title,
      summary,
      // dateAdded is YYYY-MM-DD; anchor at UTC midnight.
      publishedAt: v.dateAdded ? `${v.dateAdded}T00:00:00.000Z` : '',
      canonicalUrl: `https://nvd.nist.gov/vuln/detail/${cve}`,
      sourceName: 'CISA KEV',
      sourceType: 'cisa-kev',
      rawEvidence: JSON.stringify(v)
    });
    if (candidate) candidates.push(candidate);
  }
  return candidates;
}

export const cisaKevAdapter: DiscoveryAdapter = {
  name: 'CISA KEV',
  sourceType: 'cisa-kev',
  url: CISA_KEV_URL,
  async fetch(fetchImpl): Promise<AdapterResult> {
    const result = await fetchJson(fetchImpl, this.url, { retries: 2 });
    if (!result.ok) return { candidates: [], error: result.error ?? 'unknown fetch error' };
    try {
      return { candidates: parseCisaKev(result.data) };
    } catch (err) {
      return { candidates: [], error: err instanceof Error ? err.message : String(err) };
    }
  }
};
