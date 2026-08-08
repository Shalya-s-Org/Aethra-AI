import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Each test file runs in its own process, so pointing the store at a scratch
// database before any DB call is safe (the connection is opened lazily).
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'aethra-db-test-'));
process.env.AETHRA_DB_PATH = path.join(TMP_DIR, 'test.db');

import {
  closeDb,
  countPosts,
  deleteAgentRow,
  findPublishedByCanonicalSource,
  getAgentRow,
  getDb,
  getMemoryNodesByAgent,
  getPostsByAgent,
  getRunsByAgent,
  hasDecision,
  hasPublishedTopic,
  insertDecision,
  insertMemoryNode,
  insertPost,
  insertRun,
  insertSource,
  listDueAgentIds,
  updateRun,
  upsertTopicRow
} from '../src/lib/db';
import { initializeAgentInstance } from '../src/lib/agentEngine';
import { ulid } from '../src/lib/ids';

after(() => {
  closeDb();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const T0 = 1_700_000_000_000;

function createAgent(): string {
  const state = initializeAgentInstance('DB Test', 'AI Systems & Hardware', undefined, undefined, T0);
  return state.agentId;
}

describe('migrations', () => {
  it('applies the schema and is idempotent across reopens', () => {
    const tables = getDb()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map(r => String(r.name));
    for (const t of ['agents', 'topics', 'sources', 'posts', 'editorial_decisions', 'persona_memory', 'agent_runs', 'schema_migrations']) {
      assert.ok(tables.includes(t), `missing table ${t}`);
    }
    // Reopen: migrations must not re-run or error.
    closeDb();
    getDb();
  });
});

describe('agent persistence', () => {
  it('survives a close/reopen of the database file', () => {
    const agentId = createAgent();
    closeDb(); // drop the connection, keep the file
    const row = getAgentRow(agentId); // reopens the same file
    assert.ok(row, 'agent must exist after reopen');
    assert.equal(row.state.config.name, 'DB Test');
    assert.equal(row.state.posts.length, 1); // seed post survived
    assert.equal(getPostsByAgent(agentId).length, 1);
  });

  it('shows up in the due list after its next_run_at', () => {
    const agentId = createAgent();
    assert.ok(!listDueAgentIds(T0).includes(agentId)); // not due at init
    assert.ok(listDueAgentIds(T0 + 20_000).includes(agentId)); // due after cadence
  });
});

describe('posts', () => {  it('orders feed newest-first', () => {
    const agentId = createAgent();
    // One post per topic (UNIQUE(agent_id, topic_id)), so give each its own
    // topic with a distinct canonical source.
    const entries: Array<[string, number]> = [
      ['Oldest', T0],
      ['Newest', T0 + 999_000],
      ['Middle', T0 + 500_000]
    ];
    entries.forEach(([title, at], i) => {
      const topicId = upsertTopicRow({
        agentId,
        title: `Topic ${title}`,
        canonicalSourceUrl: `https://example.com/post-${i}`,
        category: null,
        sourceName: null,
        credibilityScore: 90,
        trendScore: null,
        noveltyScore: 80,
        importanceScore: 85,
        confidenceScore: 88,
        recommendation: 'Accept',
        rejectionReason: null,
        detailedAnalysis: null,
        opinion: null,
        freshness: null,
        rawJson: '{}',
        createdAtMs: T0
      });
      insertPost({
        id: ulid(T0 + i),
        agentId,
        topicId,
        title,
        body: `body ${title}`,
        opinion: 'op',
        rationale: 'why',
        confidenceScore: 90,
        category: 'Test',
        importanceScore: 85,
        noveltyScore: 80,
        publicationId: `PUB-${title}`,
        publishedAtMs: at
      });
    });

    const posts = getPostsByAgent(agentId);
    const titles = posts.map(p => p.title);
    // createAgent() also seeds one post (2h in the past), so it sorts last.
    assert.deepEqual(titles.slice(0, 3), ['Newest', 'Middle', 'Oldest'], 'expected newest-first feed order');
    assert.equal(titles.length, 4, 'seed post should sort after the three inserted');
  });

  it('rejects a second post for the same agent + topic (UNIQUE backstop)', () => {
    const agentId = createAgent();
    const topicId = upsertTopicRow({
      agentId,
      title: 'Dup Topic',
      canonicalSourceUrl: 'https://example.com/dup',
      category: null,
      sourceName: null,
      credibilityScore: null,
      trendScore: null,
      noveltyScore: null,
      importanceScore: null,
      confidenceScore: null,
      recommendation: null,
      rejectionReason: null,
      detailedAnalysis: null,
      opinion: null,
      freshness: null,
      rawJson: '{}',
      createdAtMs: T0
    });
    insertPost({
      id: ulid(T0),
      agentId,
      topicId,
      title: 'Once',
      body: 'b',
      opinion: null,
      rationale: null,
      confidenceScore: null,
      category: null,
      importanceScore: null,
      noveltyScore: null,
      publicationId: null,
      publishedAtMs: T0
    });
    assert.throws(
      () =>
        insertPost({
          id: ulid(T0 + 1),
          agentId,
          topicId,
          title: 'Twice',
          body: 'b',
          opinion: null,
          rationale: null,
          confidenceScore: null,
          category: null,
          importanceScore: null,
          noveltyScore: null,
          publicationId: null,
          publishedAtMs: T0 + 1000
        }),
      /UNIQUE/
    );
    // Seed post + the one we inserted = 2; the duplicate insert must not land.
    assert.equal(countPosts(agentId), 2);
    assert.ok(hasPublishedTopic(agentId, topicId));
  });
});

describe('topics + duplicate canonical sources', () => {
  it('reuses the existing topic id for the same canonical source (dedup)', () => {
    const agentId = createAgent();
    const input = {
      agentId,
      title: 'First Title',
      canonicalSourceUrl: 'https://arxiv.org/abs/2608.1092',
      category: null,
      sourceName: null,
      credibilityScore: 90,
      trendScore: null,
      noveltyScore: 80,
      importanceScore: 85,
      confidenceScore: 88,
      recommendation: 'Accept',
      rejectionReason: null,
      detailedAnalysis: null,
      opinion: null,
      freshness: null,
      rawJson: '{}',
      createdAtMs: T0
    };
    const first = upsertTopicRow(input);
    const second = upsertTopicRow({ ...input, title: 'Renamed Title' });
    assert.equal(second, first, 'same canonical source must map to one topic row');
  });

  it('findPublishedByCanonicalSource detects a published canonical URL', () => {
    const agentId = createAgent();
    const topicId = upsertTopicRow({
      agentId,
      title: 'Canonical Topic',
      canonicalSourceUrl: 'https://example.com/canonical',
      category: null,
      sourceName: null,
      credibilityScore: null,
      trendScore: null,
      noveltyScore: null,
      importanceScore: null,
      confidenceScore: null,
      recommendation: null,
      rejectionReason: null,
      detailedAnalysis: null,
      opinion: null,
      freshness: null,
      rawJson: '{}',
      createdAtMs: T0
    });
    insertSource({ agentId, topicId, url: 'https://example.com/canonical', sourceName: 'Example' });
    assert.ok(!findPublishedByCanonicalSource(agentId, ['https://example.com/canonical']));
    insertPost({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FA3',
      agentId,
      topicId,
      title: 'Canonical Post',
      body: 'b',
      opinion: null,
      rationale: null,
      confidenceScore: null,
      category: null,
      importanceScore: null,
      noveltyScore: null,
      publicationId: null,
      publishedAtMs: T0
    });
    assert.ok(findPublishedByCanonicalSource(agentId, ['https://example.com/canonical']));
  });
});

describe('editorial decisions', () => {
  it('stores scores + explanation and rejects duplicates', () => {
    const agentId = createAgent();
    const topicId = upsertTopicRow({
      agentId,
      title: 'Decided Topic',
      canonicalSourceUrl: 'https://example.com/decided',
      category: null,
      sourceName: null,
      credibilityScore: null,
      trendScore: null,
      noveltyScore: null,
      importanceScore: null,
      confidenceScore: null,
      recommendation: null,
      rejectionReason: null,
      detailedAnalysis: null,
      opinion: null,
      freshness: null,
      rawJson: '{}',
      createdAtMs: T0
    });
    insertDecision({
      agentId,
      topicId,
      decision: 'reject',
      credibilityScore: 60,
      noveltyScore: 10,
      importanceScore: 15,
      confidenceScore: 85,
      explanation: 'Marketing hype with zero engineering depth.',
      decidedAtMs: T0
    });
    assert.ok(hasDecision(agentId, topicId));
    assert.throws(
      () =>
        insertDecision({
          agentId,
          topicId,
          decision: 'accept',
          credibilityScore: 90,
          noveltyScore: 90,
          importanceScore: 90,
          confidenceScore: 90,
          explanation: 'Duplicate decision.',
          decidedAtMs: T0 + 1000
        }),
      /UNIQUE/
    );
  });
});

describe('memory + runs + cascade delete', () => {
  it('persists memory nodes and run history, then cascades on delete', () => {
    const agentId = createAgent();
    insertMemoryNode({
      id: 'node-x',
      agentId,
      nodeLabel: 'X',
      nodeGroup: 'topic',
      details: 'details',
      connections: ['node-y'],
      createdAtMs: T0
    });
    const runId = insertRun({ agentId, topicId: null, status: 'running', outcome: null, startedAtMs: T0 });
    updateRun(runId, { status: 'completed', finishedAtMs: T0 + 5000, outcome: 'published' });

    assert.equal(getMemoryNodesByAgent(agentId).length, 3); // 2 seeds + 1
    const runs = getRunsByAgent(agentId);
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'completed');
    assert.equal(runs[0].outcome, 'published');

    // Cascade: deleting the agent wipes all content rows.
    deleteAgentRow(agentId);
    assert.equal(getAgentRow(agentId), null);
    assert.equal(countPosts(agentId), 0);
    assert.equal(getMemoryNodesByAgent(agentId).length, 0);
    assert.equal(getRunsByAgent(agentId).length, 0);
    const sourceCount = getDb()
      .prepare('SELECT COUNT(*) AS n FROM sources WHERE agent_id = ?')
      .get(agentId);
    assert.equal(Number((sourceCount as { n: number }).n), 0);
    const decisionCount = getDb()
      .prepare('SELECT COUNT(*) AS n FROM editorial_decisions WHERE agent_id = ?')
      .get(agentId);
    assert.equal(Number((decisionCount as { n: number }).n), 0);
  });
});
