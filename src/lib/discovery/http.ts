// Hardened HTTP for discovery sources.
//
// Every outbound request gets: a hard timeout (AbortController), bounded
// retries with exponential backoff + jitter, and never throws — callers get a
// typed result so one flaky source can fail in isolation.

export interface FetchResult {
  ok: boolean;
  /** HTTP status when a response was received; null on network/timeout. */
  status: number | null;
  /** Response body text on success. */
  text: string;
  /** Human-readable failure reason (network error, timeout, HTTP status). */
  error: string | null;
}

export interface FetchOptions {
  timeoutMs?: number;
  /** Additional attempts after the first (total attempts = retries + 1). */
  retries?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  headers?: Record<string, string>;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_BACKOFF_MS = 250;
const DEFAULT_MAX_BACKOFF_MS = 2_000;

const sleep = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/** Bounded exponential backoff with full jitter in [0.5x, 1x). */
function backoffMs(attempt: number, base: number, max: number): number {
  const exp = Math.min(max, base * 2 ** attempt);
  return Math.max(1, Math.round(exp * (0.5 + Math.random() * 0.5)));
}

export async function fetchWithRetry(
  fetchImpl: typeof fetch,
  url: string,
  options: FetchOptions = {}
): Promise<FetchResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const baseBackoffMs = options.baseBackoffMs ?? DEFAULT_BASE_BACKOFF_MS;
  const maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;

  let lastError = 'Unknown fetch error';
  let lastStatus: number | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        signal: controller.signal,
        headers: {
          Accept: 'application/json, application/atom+xml, application/rss+xml, text/xml, */*',
          'User-Agent': 'AethraAI-Discovery/1.0 (hackathon; security-research feed reader)',
          ...options.headers
        }
      });
      if (response.ok) {
        return { ok: true, status: response.status, text: await response.text(), error: null };
      }
      lastStatus = response.status;
      // 429 (rate limit) and 5xx are transient → retry. Other 4xx are
      // permanent (bad URL/forbidden) → fail fast without burning retries.
      if (response.status !== 429 && response.status < 500) {
        return { ok: false, status: response.status, text: '', error: `HTTP ${response.status}` };
      }
      lastError = `HTTP ${response.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
    }

    if (attempt < retries) {
      await sleep(backoffMs(attempt, baseBackoffMs, maxBackoffMs));
    }
  }

  return { ok: false, status: lastStatus, text: '', error: lastError };
}

export interface JsonFetchResult extends FetchResult {
  data: unknown;
}

/** fetchWithRetry + JSON parse. Never throws: parse failure is a non-ok result. */
export async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
  options: FetchOptions = {}
): Promise<JsonFetchResult> {
  const result = await fetchWithRetry(fetchImpl, url, options);
  if (!result.ok) return { ...result, data: undefined };
  try {
    return { ...result, data: JSON.parse(result.text) };
  } catch {
    return { ok: false, status: result.status, text: '', data: undefined, error: 'Invalid JSON in response' };
  }
}

/** fetchWithRetry + decode UTF-8 text (used for RSS/Atom XML). */
export async function fetchText(
  fetchImpl: typeof fetch,
  url: string,
  options: FetchOptions = {}
): Promise<FetchResult> {
  return fetchWithRetry(fetchImpl, url, options);
}
