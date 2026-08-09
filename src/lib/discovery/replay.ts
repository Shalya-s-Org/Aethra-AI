// Record/replay harness for live-provider smoke tests.
//
// The full adapter stack (every allowlisted source) can be exercised against a
// committed fixture directory in replay mode, so CI is deterministic with no
// network. Maintainers refresh the fixtures by running the record mode once
// against the live endpoints:
//
//   node --import tsx scripts/record-discovery-fixtures.ts
//
// Fixture files are JSON `{ url, status, body }` per allowlisted URL, named by
// URL hash (stable, filesystem-safe). Replay serves the exact recorded
// response for each requested URL and 404s anything not recorded — so a replay
// run also proves the runner never requests an un-allowlisted URL.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface ReplayEntry {
  url: string;
  status: number;
  body: string;
}

export function fixtureFileName(url: string): string {
  return `${crypto.createHash('sha256').update(url).digest('hex').slice(0, 24)}.json`;
}

/** Load every recorded response from a fixture directory (one file per URL). */
export function loadReplayFixtures(dir: string): ReplayEntry[] {
  const entries: ReplayEntry[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const raw = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as ReplayEntry;
    entries.push(raw);
  }
  return entries;
}

/** A fetch implementation backed by recorded responses. Requests outside the
 *  recorded set return 404 — nothing content-derived can ever be fetched. */
export function createReplayFetch(entries: ReplayEntry[]): typeof fetch {
  const byUrl = new Map(entries.map(e => [e.url, e]));
  // Requests carry no headers/options that matter (responses are fully
  // recorded); the cast keeps the signature compatible with `typeof fetch`.
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const entry = byUrl.get(url);
    if (!entry) return new Response('{"message":"Not Found (unrecorded URL)"}', { status: 404 });
    return new Response(entry.body, { status: entry.status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }) as typeof fetch;
}

/** Record mode: fetch each allowlisted URL live and write its response to the
 *  fixture directory. Returns the number of responses written. */
export async function recordLiveFixtures(
  fetchImpl: typeof fetch,
  urls: string[],
  dir: string
): Promise<number> {
  fs.mkdirSync(dir, { recursive: true });
  let written = 0;
  for (const url of urls) {
    const response = await fetchImpl(url);
    const body = await response.text();
    fs.writeFileSync(
      path.join(dir, fixtureFileName(url)),
      JSON.stringify({ url, status: response.status, body }, null, 2)
    );
    written += 1;
  }
  return written;
}
