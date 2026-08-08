import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-engine-test-'));
process.env.AETHRA_DB_PATH = path.join(TMP_DIR, 'engine.db');

import {
  advanceAgentById,
  destroyAgent,
  initializeAgentInstance,
  peekAgentState
} from '../src/lib/agentEngine';
import {
  closeDb,
  countPosts,
  getAgentRow,
  getDecisionsByAgent,
  getPostsByAgent,
  getRunsByAgent
} from '../src/lib/db';
import { isUlid } from '../src/lib/ids';

after(() => {
  closeDb();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const T0 = 1_700_000_000_000;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('initialization', () => {
  it('persists the agent with ULID seed posts and ISO UTC timestamps', () => {
    const state = initializeAgentInstance('Engine Test', 'AI Systems & Hardware', undefined, undefined, T0);
    const row = getAgentRow(state.agentId);
    assert.ok(row);
    assert.equal(row.state.config.name, 'Engine Test');

    const posts = getPostsByAgent(state.agentId);
    assert.ok(posts.length >= 1, 'seed posts must be in the posts table');
    for (const post of posts) {
      assert.ok(isUlid(post.id), `post id must be a ULID: ${post.id}`);
      assert.match(post.createdAt, ISO_UTC_RE, 'published_at must be ISO UTC');
      assert.ok(post.sources.every(s => s.startsWith('https://')), 'sources must be canonical HTTPS');
    }
    // Snapshot (client contract) uses the same ULID ids as the table.
    assert.equal(state.posts[0].id, posts[0].id);
  });
});

describe('pipeline cycle', () => {
  it('runs a full cycle deterministically and records run/decision rows', () => {
    const state = initializeAgentInstance('Cycle Test', 'AI Systems & Hardware', undefined, undefined, T0);
    const id = state.agentId;

    advanceAgentById(id, T0 + 30_000); // start run 1
    advanceAgentById(id, T0 + 60_000); // complete run 1

    const snap = peekAgentState(id, T0 + 60_000);
    assert.equal(snap?.status, 'idle');
    assert.equal(countPosts(id), 2); // seed + 1 published

    const posts = getPostsByAgent(id);
    const published = posts[0]; // newest
    assert.equal(posts.length, 2);
    assert.ok(isUlid(published.id));
    assert.match(published.createdAt, ISO_UTC_RE);

    const runs = getRunsByAgent(id);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'completed');
    assert.equal(runs[0].outcome, 'published');
    assert.match(runs[0].startedAt, ISO_UTC_RE);
    assert.match(runs[0].finishedAt ?? '', ISO_UTC_RE);

    const decisions = getDecisionsByAgent(id);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].decision, 'accept');
    assert.equal(typeof decisions[0].importanceScore, 'number');
    assert.ok(decisions[0].explanation.length > 0);
    assert.match(decisions[0].decidedAt, ISO_UTC_RE);
  });
});

describe('duplicate publication prevention', () => {
  it('never republishes a canonical source already published (seed collision)', () => {
    // "AI Security": the seed post shares arxiv.org/abs/2608.1092 with pool
    // topic sec-1, so run 1 must be blocked as a duplicate.
    const state = initializeAgentInstance('Dup Test', 'AI Security', undefined, undefined, T0);
    const id = state.agentId;
    assert.equal(countPosts(id), 1); // seed only

    advanceAgentById(id, T0 + 30_000); // start run 1 (sec-1)
    advanceAgentById(id, T0 + 60_000); // complete run 1 -> duplicate
    assert.equal(countPosts(id), 1, 'seed-duplicate topic must not publish');

    advanceAgentById(id, T0 + 90_000); // start run 2 (sec-2)
    advanceAgentById(id, T0 + 120_000); // complete run 2 -> published

    assert.equal(countPosts(id), 2, 'second topic should publish');

    const runs = getRunsByAgent(id); // ordered newest first
    assert.equal(runs.length, 2);
    assert.equal(runs[0].outcome, 'published');
    assert.equal(runs[1].outcome, 'duplicate');

    // Both runs still record full editorial decisions with scores.
    const decisions = getDecisionsByAgent(id);
    assert.equal(decisions.length, 2);
    for (const d of decisions) {
      assert.equal(d.decision, 'accept');
      assert.ok(d.importanceScore != null && d.noveltyScore != null);
      assert.ok(d.explanation.length > 0);
    }
  });

  it('does not publish the same topic twice after pool regeneration', () => {
    // Small pool (3 topics: os-1/os-2 accepted, os-3 rejected) + regeneration:
    // every clone reuses the same canonical topic rows, so only the two unique
    // accepted topics ever publish, no matter how many cycles run.
    const state = initializeAgentInstance('Regen Test', 'Open Source AI', undefined, undefined, T0);
    const id = state.agentId;

    // Each cycle needs two advances (start + finish). 12 advances = 6 runs:
    // 3 originals (os-1 published, os-2 published, os-3 rejected) + 3 clones
    // (all duplicates).
    for (let i = 0; i < 12; i++) {
      advanceAgentById(id, T0 + (i + 1) * 30_000);
    }

    const posts = getPostsByAgent(id);
    // Seed + os-1 + os-2 = 3; os-3 rejected; regenerated clones are duplicates.
    assert.equal(posts.length, 3, `expected seed + 2 unique posts, got ${posts.length}`);

    const runs = getRunsByAgent(id);
    assert.equal(runs.length, 6);
    const outcomes = new Set(runs.map(r => r.outcome));
    assert.ok(outcomes.has('published'));
    assert.ok(outcomes.has('rejected'));
    assert.ok(outcomes.has('duplicate'));

    // Post ids remain ULID, timestamps remain ISO UTC after 6 cycles.
    for (const post of posts) {
      assert.ok(isUlid(post.id));
      assert.match(post.createdAt, ISO_UTC_RE);
    }
  });
});

describe('durability across restarts', () => {
  it('keeps posts and engine state after closing and reopening the DB', () => {
    const state = initializeAgentInstance('Restart Test', 'Robotics', undefined, undefined, T0);
    const id = state.agentId;

    advanceAgentById(id, T0 + 30_000);
    advanceAgentById(id, T0 + 60_000); // publish run 1
    assert.equal(countPosts(id), 2);

    // Simulate a server restart: drop the connection entirely.
    closeDb();
    const row = getAgentRow(id); // reopens the file
    assert.ok(row);
    assert.equal(countPosts(id), 2, 'posts must survive a restart');

    // The simulation continues from persisted timestamps.
    advanceAgentById(id, T0 + 90_000); // run 2 (robot-2 accepted)
    advanceAgentById(id, T0 + 120_000); // complete run 2
    assert.equal(countPosts(id), 3);
    assert.equal(getRunsByAgent(id).length, 2);

    destroyAgent(id);
    assert.equal(getAgentRow(id), null);
    assert.equal(countPosts(id), 0);
  });

  it('recovers a mid-run pipeline after a restart', () => {
    // Robotics is used here because robot-1's canonical source does NOT collide
    // with the seed post (Cricket's would — a duplicate by design).
    const state = initializeAgentInstance('MidRun Test', 'Robotics', undefined, undefined, T0);
    const id = state.agentId;

    advanceAgentById(id, T0 + 12_000); // start run, mid-scanning
    const mid = peekAgentState(id, T0 + 12_500);
    assert.equal(mid?.status, 'scanning');

    closeDb(); // crash mid-pipeline
    const after = advanceAgentById(id, T0 + 40_000); // restart, wall clock advanced
    assert.ok(after);
    assert.equal(after.status, 'idle', 'fast-forwarded run should finish after restart');
    assert.equal(countPosts(id), 2); // seed + robot-1 published
  });
});
