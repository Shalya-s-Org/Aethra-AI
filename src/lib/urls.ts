// Canonical source URL normalization.
//
// Source URLs stored in the sources table must be canonical HTTPS URLs:
// scheme-less inputs are upgraded to https://, hosts lowercased, default ports
// and query/hash fragments stripped, and a single trailing slash removed.
// Anything that is not an http(s) URL is rejected (returns null).

export function canonicalizeSourceUrl(input: string): string | null {
  const raw = (input ?? '').trim();
  if (!raw) return null;

  // Bare domains/arXiv ids have no scheme — assume https.
  let candidate = raw;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;

  url.protocol = 'https:';
  url.host = url.host.toLowerCase();
  if (url.port === '80' || url.port === '443') url.port = '';
  url.search = '';
  url.hash = '';
  // Bare host ("https://host/") → "https://host"
  if (url.pathname === '/') url.pathname = '';
  // Drop a single trailing slash from deeper paths.
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }

  let result = url.toString();
  // URL#toString re-adds a root slash for bare hosts; strip it for a clean
  // canonical form.
  if (result.endsWith('/')) result = result.slice(0, -1);
  return result;
}
