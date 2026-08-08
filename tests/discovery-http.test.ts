import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson, fetchWithRetry } from '../src/lib/discovery/http';

/** Build a stub fetch that records every requested URL and delegates to `handler`. */
function stubFetch(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response
): { impl: typeof fetch; requested: string[] } {
  const requested: string[] = [];
  const impl = (async (url: string, init?: RequestInit) => {
    requested.push(url);
    return handler(url, init);
  }) as typeof fetch;
  return { impl, requested };
}

const OK = () => new Response('ok');

describe('fetchWithRetry', () => {
  it('returns the body on success', async () => {
    const { impl, requested } = stubFetch(OK);
    const res = await fetchWithRetry(impl, 'https://example.com/x');
    assert.equal(res.ok, true);
    assert.equal(res.text, 'ok');
    assert.deepEqual(requested, ['https://example.com/x']);
  });

  it('retries transient 5xx with backoff and succeeds on a later attempt', async () => {
    let attempts = 0;
    const started = Date.now();
    const { impl } = stubFetch(() => {
      attempts += 1;
      return attempts < 3 ? new Response('err', { status: 503 }) : new Response('ok');
    });
    const res = await fetchWithRetry(impl, 'https://example.com/x', {
      retries: 2,
      baseBackoffMs: 20,
      maxBackoffMs: 100
    });
    assert.equal(res.ok, true);
    assert.equal(attempts, 3, 'two retries after the first attempt');
    // Two sleeps, each at least 0.5 * base * 2^i → >= 10ms and >= 20ms.
    assert.ok(Date.now() - started >= 25, 'backoff must sleep between retries');
  });

  it('fails fast on a permanent 4xx without burning retries', async () => {
    let attempts = 0;
    const { impl } = stubFetch(() => {
      attempts += 1;
      return new Response('nope', { status: 404 });
    });
    const res = await fetchWithRetry(impl, 'https://example.com/x', { retries: 3, baseBackoffMs: 5 });
    assert.equal(res.ok, false);
    assert.equal(res.status, 404);
    assert.equal(attempts, 1, '4xx must not be retried');
  });

  it('times out a hung request and reports the abort', async () => {
    const { impl } = stubFetch((_url, init) => {
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(new DOMException('The operation was aborted.', 'AbortError'))
        );
      });
    });
    const started = Date.now();
    const res = await fetchWithRetry(impl, 'https://example.com/slow', {
      timeoutMs: 40,
      retries: 0
    });
    assert.equal(res.ok, false);
    assert.ok(Date.now() - started < 2_000, 'timeout must bound the request');
    assert.ok(res.error, 'failure must carry an error message');
  });

  it('gives up after bounded retries on a persistent network error', async () => {
    let attempts = 0;
    const started = Date.now();
    const { impl } = stubFetch(() => {
      attempts += 1;
      throw new Error('ECONNRESET');
    });
    const res = await fetchWithRetry(impl, 'https://example.com/flaky', {
      retries: 2,
      baseBackoffMs: 10,
      maxBackoffMs: 25
    });
    assert.equal(res.ok, false);
    assert.equal(attempts, 3);
    assert.match(res.error ?? '', /ECONNRESET/);
    // Bounded backoff: 2 sleeps capped at maxBackoffMs → well under a second.
    assert.ok(Date.now() - started < 1_000, 'backoff must stay bounded');
  });

  it('treats 429 as transient and retries', async () => {
    let attempts = 0;
    const { impl } = stubFetch(() => {
      attempts += 1;
      return attempts === 1 ? new Response('slow down', { status: 429 }) : OK();
    });
    const res = await fetchWithRetry(impl, 'https://example.com/ratelimited', {
      retries: 2,
      baseBackoffMs: 5,
      maxBackoffMs: 20
    });
    assert.equal(res.ok, true);
    assert.equal(attempts, 2);
  });
});

describe('fetchJson', () => {
  it('parses JSON on success and reports parse failure as non-ok', async () => {
    const good = await fetchJson(stubFetch(() => new Response('{"a":1}')).impl, 'https://example.com/g');
    assert.equal(good.ok, true);
    assert.deepEqual(good.data, { a: 1 });

    const bad = await fetchJson(stubFetch(() => new Response('not json')).impl, 'https://example.com/b');
    assert.equal(bad.ok, false);
    assert.match(bad.error ?? '', /JSON/);
  });
});
