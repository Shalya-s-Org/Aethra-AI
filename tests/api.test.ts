import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Each test file runs in its own process, so pointing the store at a scratch
// database before any import that touches the DB is safe (lazy singleton).
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-api-test-'));
process.env.AETHRA_DB_PATH = path.join(TMP_DIR, 'api.db');

// The route handlers themselves — driven with real Request objects so the
// endpoint contract is tested end-to-end (validation, status codes, shapes).
import { GET as feedGET } from '../src/app/api/agent/feed/route';
import { POST as initPOST } from '../src/app/api/agent/init/route';
import { advanceAgentById, initializeAgentInstance } from '../src/lib/agentEngine';
import { closeDb, getDb, getPostsByAgent, getScheduledJobByAgent } from '../src/lib/db';
import { isUlid } from '../src/lib/ids';

after(() => {
  closeDb();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const BASE = 'http://localhost';
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function initRequest(
  body: unknown,
  opts: { contentType?: string | null; idempotencyKey?: string } = {}
): Request {
  const headers: Record<string, string> = {};
  if (opts.contentType !== null) {
    headers['content-type'] = opts.contentType ?? 'application/json';
  }
  if (opts.idempotencyKey) headers['idempotency-key'] = opts.idempotencyKey;
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request(`${BASE}/api/agent/init`, {
    method: 'POST',
    headers,
    body: bodyText
  });
}

async function feedRequest(agentId: string | null): Promise<Response> {
  const url = agentId === null ? `${BASE}/api/agent/feed` : `${BASE}/api/agent/feed?agentId=${encodeURIComponent(agentId)}`;
  return feedGET(new Request(url));
}

const VALID = { persona: { name: 'Ada', domain: 'Robotics' } };

describe('POST /api/agent/init', () => {
  it('accepts exactly { persona: { name, domain } } and returns the contract shape', async () => {
    const res = await initPOST(initRequest(VALID));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(
      Object.keys(body).sort(),
      ['agentId', 'message', 'status', 'timestamp'],
      'response must have exactly the contract keys'
    );
    assert.ok(isUlid(body.agentId), 'agentId must be an opaque ULID');
    assert.equal(body.status, 'initialized');
    assert.ok(body.message.includes('Ada'));
    assert.match(body.timestamp, ISO_UTC_RE);
  });

  it('accepts documented advanced persona fields (role/mission/frequency/style)', async () => {
    const res = await initPOST(
      initRequest({
        persona: {
          name: 'Ada',
          domain: 'Robotics',
          role: 'Robotics Engineer',
          mission: 'Publish robotics breakthroughs only.',
          frequency: '10',
          style: 'Technical, concise'
        }
      })
    );
    assert.equal(res.status, 200);
  });

  it('rejects non-JSON content types with 415', async () => {
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded']) {
      const res = await initPOST(initRequest(VALID, { contentType: ct }));
      assert.equal(res.status, 415, `expected 415 for ${ct}`);
    }
    const noCt = await initPOST(initRequest(VALID, { contentType: null }));
    assert.equal(noCt.status, 415, 'missing content-type must be 415');
  });

  it('rejects malformed JSON with a useful 400', async () => {
    const res = await initPOST(initRequest('{not json'));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.error.includes('JSON'));
  });

  it('rejects a non-object body with 400', async () => {
    const res = await initPOST(initRequest(['not', 'an', 'object']));
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error.includes('object'));
  });

  it('rejects missing persona / missing name / missing domain with 400', async () => {
    const cases = [
      {},
      { foo: 1 },
      { persona: {} },
      { persona: { name: 'Ada' } },
      { persona: { domain: 'Robotics' } },
      { persona: { name: '', domain: 'Robotics' } },
      { persona: { name: 'Ada', domain: '  ' } }
    ];
    for (const body of cases) {
      const res = await initPOST(initRequest(body));
      assert.equal(res.status, 400, `expected 400 for ${JSON.stringify(body)}`);
      const parsed = await res.json();
      assert.ok(typeof parsed.error === 'string' && parsed.error.length > 0);
    }
  });

  it('rejects unknown top-level or persona fields with 400 (contract drift fails loudly)', async () => {
    const resTop = await initPOST(initRequest({ persona: { name: 'Ada', domain: 'Robotics' }, extra: true }));
    assert.equal(resTop.status, 400);
    assert.ok((await resTop.json()).error.includes('extra'));

    const resPersona = await initPOST(initRequest({ persona: { name: 'Ada', domain: 'Robotics', evil: 1 } }));
    assert.equal(resPersona.status, 400);
    assert.ok((await resPersona.json()).error.includes('evil'));
  });

  it('rejects oversized bodies with 413 (declared and actual)', async () => {
    const huge = JSON.stringify({ persona: { name: 'x', domain: 'd', mission: 'y'.repeat(20 * 1024) } });
    const res = await initPOST(initRequest(huge));
    assert.equal(res.status, 413);
  });

  it('rejects an invalid Idempotency-Key with 400', async () => {
    const res = await initPOST(initRequest(VALID, { idempotencyKey: 'bad key with spaces!!' }));
    assert.equal(res.status, 400);
    assert.ok((await res.json()).error.includes('Idempotency-Key'));
  });

  it('is idempotent: the same Idempotency-Key replays the identical response', async () => {
    const first = await initPOST(initRequest(VALID, { idempotencyKey: 'key-1' }));
    const second = await initPOST(initRequest(VALID, { idempotencyKey: 'key-1' }));
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    const body1 = await first.json();
    const body2 = await second.json();
    assert.equal(body1.agentId, body2.agentId, 'same key must return the same agent');
    assert.deepEqual(body1, body2, 'replay must return the byte-identical response');
  });

  it('is concurrency-safe: parallel requests with the same key share one agent', async () => {
    const results = await Promise.all(
      Array.from({ length: 3 }, () => initPOST(initRequest(VALID, { idempotencyKey: 'key-race' })))
    );
    for (const res of results) assert.equal(res.status, 200);
    const bodies = await Promise.all(results.map(r => r.json()));
    assert.equal(new Set(bodies.map(b => b.agentId)).size, 1, 'all racers must share one agent');
    assert.deepEqual(bodies[0], bodies[1]);
    assert.deepEqual(bodies[1], bodies[2]);
  });

  it('returns a distinct agent for a distinct key', async () => {
    const a = await (await initPOST(initRequest(VALID, { idempotencyKey: 'key-a' }))).json();
    const b = await (await initPOST(initRequest(VALID, { idempotencyKey: 'key-b' }))).json();
    assert.notEqual(a.agentId, b.agentId);
  });
});

describe('GET /api/agent/feed', () => {
  it('returns 400 for a missing or invalid agentId', async () => {
    const missing = await feedRequest(null);
    assert.equal(missing.status, 400);

    for (const bad of ['__proto__', 'bad id!', 'a'.repeat(200), 'constructor']) {
      const res = await feedRequest(bad);
      assert.equal(res.status, 400, `expected 400 for agentId=${bad}`);
    }
  });

  it('returns 404 for an unknown but well-formed agentId', async () => {
    const res = await feedRequest('01ARZ3NDEKTSV4RRFFQ69G5FA0'); // valid ULID shape, no agent
    assert.equal(res.status, 404);
  });

  it('returns an empty feed { posts: [] } for a fresh agent (demo seeds excluded)', async () => {
    const agent = initializeAgentInstance('Feed Test', 'Robotics', undefined, undefined, 1_700_000_000_000);
    const res = await feedRequest(agent.agentId);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { posts: [] }, 'judged feed must exclude static demo/seed posts');
  });

  it('returns posts reverse-chronologically with the exact contract item shape', async () => {
    const T0 = 1_700_000_000_000;
    const agent = initializeAgentInstance('Feed Order', 'Robotics', undefined, undefined, T0);
    advanceAgentById(agent.agentId, T0 + 30_000); // run 1: robot-1 (published)
    advanceAgentById(agent.agentId, T0 + 60_000);
    advanceAgentById(agent.agentId, T0 + 90_000); // run 2: robot-2 (published)
    advanceAgentById(agent.agentId, T0 + 120_000);

    const res = await feedRequest(agent.agentId);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.posts));
    assert.equal(body.posts.length, 2);

    for (const post of body.posts) {
      assert.deepEqual(
        Object.keys(post).sort(),
        ['createdAt', 'id', 'rationale', 'sources', 'text'],
        'each feed item must have exactly the contract keys'
      );
      assert.ok(isUlid(post.id));
      assert.match(post.createdAt, ISO_UTC_RE);
      assert.ok(post.text.length > 0);
      assert.ok(post.rationale.length > 0);
      assert.ok(Array.isArray(post.sources) && post.sources.length > 0);
      assert.ok(post.sources.every((s: string) => s.startsWith('https://')), 'sources must be canonical HTTPS');
    }

    // Reverse chronological ordering (newest first).
    const times = body.posts.map((p: { createdAt: string }) => Date.parse(p.createdAt));
    assert.ok(
      times.every((t: number, i: number) => i === 0 || t <= times[i - 1]),
      'feed must be reverse-chronological'
    );
  });

  it('is a pure read: repeated GETs never publish, discover, schedule, or create runs', async () => {
    const agent = initializeAgentInstance('ReadOnly Test', 'Robotics', undefined, undefined, 1_700_000_000_000);
    const agentId = agent.agentId;

    const snapshot = () => ({
      posts: getPostsByAgent(agentId).length,
      candidates: countRows('discovery_candidates'),
      decisions: countRows('discovery_decisions'),
      runs: countRowsByAgent('agent_runs', agentId),
      job: getScheduledJobByAgent(agentId) === null ? 0 : 1
    });
    const before = snapshot();

    for (let i = 0; i < 3; i++) {
      const res = await feedRequest(agentId);
      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), { posts: [] });
    }

    assert.deepEqual(snapshot(), before, 'GET /feed must be side-effect free (no publish/discover/schedule/runs)');
  });
});

function countRows(table: 'discovery_candidates' | 'discovery_decisions'): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return Number(row.n);
}

function countRowsByAgent(table: 'agent_runs', agentId: string): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE agent_id = ?`).get(agentId) as { n: number };
  return Number(row.n);
}
