import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import type { BackendAgentInstance, EngineMeta } from './agentTypes';
import { ulid } from './ids';

// Durable persistence via Node's built-in SQLite (node:sqlite — Node 24).
// Zero extra dependencies, real SQL, WAL mode, and a versioned migration
// runner (schema_migrations table) so the schema can evolve cleanly.
//
// Schema overview (see MIGRATIONS[0]):
//   agents               persona + engine timestamps + client snapshot blob
//   topics               scanned candidate topics (canonical dedup key)
//   sources              canonical HTTPS source URLs per topic
//   posts                published feed entries (ULID PK, unique per topic)
//   editorial_decisions  accept/reject verdicts with scores + explanation
//   persona_memory       knowledge-graph nodes
//   agent_runs           durable job history for each pipeline run
//
// Post/publication timestamps are ISO-8601 UTC strings. `next_run_at` is the
// scheduler's internal epoch-ms column (not an exposed timestamp).

export interface AgentRow {
  state: BackendAgentInstance;
  engine: EngineMeta;
  createdAt: string;
  updatedAt: string;
}

export interface TopicRow {
  id: string;
  agentId: string;
  title: string;
  canonicalSourceUrl: string;
  category: string | null;
  sourceName: string | null;
  credibilityScore: number | null;
  trendScore: number | null;
  noveltyScore: number | null;
  importanceScore: number | null;
  confidenceScore: number | null;
  recommendation: string | null;
  rejectionReason: string | null;
  detailedAnalysis: string | null;
  opinion: string | null;
  freshness: string | null;
  createdAt: string;
}

export interface FeedPost {
  id: string;
  createdAt: string; // ISO UTC
  title: string;
  body: string;
  opinion: string;
  rationale: string;
  topicId: string | null;
  sources: string[];
  /** True for demo/seed posts (excluded from the judged API feed). */
  isDemo: boolean;
}

export interface DecisionRow {
  id: string;
  agentId: string;
  topicId: string;
  decision: 'accept' | 'reject';
  credibilityScore: number | null;
  noveltyScore: number | null;
  importanceScore: number | null;
  confidenceScore: number | null;
  explanation: string;
  decidedAt: string; // ISO UTC
}

export interface MemoryRow {
  id: string;
  agentId: string;
  nodeLabel: string;
  nodeGroup: string;
  details: string | null;
  connections: string[];
  createdAt: string; // ISO UTC
}

export interface RunRow {
  id: string;
  agentId: string;
  topicId: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
  outcome: string | null;
  startedAt: string; // ISO UTC
  finishedAt: string | null;
  error: string | null;
  createdAt: string; // ISO UTC
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

interface Migration {
  id: string;
  sql: string;
}

// v1: initial relational schema. Deliberately DROPs the old single-table
// `agents` blob (pre-migration data is disposable hackathon state).
const MIGRATIONS: Migration[] = [
  {
    id: '001_initial_relational_schema',
    sql: `
      DROP TABLE IF EXISTS agents;

      CREATE TABLE agents (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        role        TEXT NOT NULL,
        domain      TEXT NOT NULL,
        mission     TEXT NOT NULL,
        frequency   TEXT NOT NULL,
        style       TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'idle',
        state_json  TEXT NOT NULL,
        engine_json TEXT NOT NULL,
        next_run_at INTEGER NOT NULL,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_agents_due ON agents (next_run_at);

      CREATE TABLE topics (
        id                   TEXT PRIMARY KEY,
        agent_id             TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        title                TEXT NOT NULL,
        canonical_source_url TEXT NOT NULL,
        category             TEXT,
        source_name          TEXT,
        credibility_score    INTEGER,
        trend_score          INTEGER,
        novelty_score        INTEGER,
        importance_score     INTEGER,
        confidence_score     INTEGER,
        recommendation       TEXT,
        rejection_reason     TEXT,
        detailed_analysis    TEXT,
        opinion              TEXT,
        freshness            TEXT,
        raw_json             TEXT NOT NULL,
        created_at           TEXT NOT NULL,
        UNIQUE (agent_id, canonical_source_url)
      );
      CREATE INDEX IF NOT EXISTS idx_topics_agent_created ON topics (agent_id, created_at DESC);

      CREATE TABLE sources (
        id          TEXT PRIMARY KEY,
        agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        topic_id    TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        url         TEXT NOT NULL,
        source_name TEXT,
        UNIQUE (agent_id, url)
      );
      CREATE INDEX IF NOT EXISTS idx_sources_topic ON sources (agent_id, topic_id);

      CREATE TABLE posts (
        id               TEXT PRIMARY KEY,
        agent_id         TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        topic_id         TEXT REFERENCES topics(id) ON DELETE SET NULL,
        title            TEXT NOT NULL,
        body             TEXT NOT NULL,
        opinion          TEXT,
        rationale        TEXT,
        confidence_score INTEGER,
        category         TEXT,
        importance_score INTEGER,
        novelty_score    INTEGER,
        publication_id   TEXT,
        published_at     TEXT NOT NULL,
        UNIQUE (agent_id, topic_id)
      );
      CREATE INDEX IF NOT EXISTS idx_posts_agent_published ON posts (agent_id, published_at DESC);

      CREATE TABLE editorial_decisions (
        id                TEXT PRIMARY KEY,
        agent_id          TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        topic_id          TEXT NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        decision          TEXT NOT NULL CHECK (decision IN ('accept','reject')),
        credibility_score INTEGER,
        novelty_score     INTEGER,
        importance_score  INTEGER,
        confidence_score  INTEGER,
        explanation       TEXT NOT NULL,
        decided_at        TEXT NOT NULL,
        UNIQUE (agent_id, topic_id)
      );
      CREATE INDEX IF NOT EXISTS idx_decisions_agent_decided ON editorial_decisions (agent_id, decided_at DESC);

      CREATE TABLE persona_memory (
        id               TEXT PRIMARY KEY,
        agent_id         TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        node_label       TEXT NOT NULL,
        node_group       TEXT NOT NULL,
        details          TEXT,
        connections_json TEXT NOT NULL,
        created_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_agent ON persona_memory (agent_id, created_at DESC);

      CREATE TABLE agent_runs (
        id          TEXT PRIMARY KEY,
        agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        topic_id    TEXT REFERENCES topics(id) ON DELETE SET NULL,
        status      TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed','skipped')),
        outcome     TEXT,
        started_at  TEXT NOT NULL,
        finished_at TEXT,
        error       TEXT,
        created_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_runs_agent_started ON agent_runs (agent_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_runs_agent_status ON agent_runs (agent_id, status);
    `
  },
  {
    id: '002_demo_posts_and_idempotency',
    sql: `
      -- Demo/seed posts are marked and excluded from the judged feed.
      ALTER TABLE posts ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0;

      -- Idempotency support for POST /api/agent/init: one row per
      -- Idempotency-Key header, holding the stored response for replay.
      CREATE TABLE init_requests (
        idempotency_key TEXT PRIMARY KEY,
        agent_id        TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
        response_json   TEXT NOT NULL,
        status          INTEGER NOT NULL,
        created_at      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_init_requests_agent ON init_requests (agent_id);
    `
  },
  {
    id: '003_init_requests_nullable_agent',
    // A claim row exists BEFORE the agent does, so agent_id must be nullable.
    // (002 shipped with NOT NULL + a placeholder value that violated the FK.)
    sql: `
      DROP TABLE IF EXISTS init_requests;
      CREATE TABLE init_requests (
        idempotency_key TEXT PRIMARY KEY,
        agent_id        TEXT REFERENCES agents(id) ON DELETE CASCADE,
        response_json   TEXT NOT NULL,
        status          INTEGER NOT NULL,
        created_at      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_init_requests_agent ON init_requests (agent_id);
    `
  },
  {
    id: '004_live_discovery',
    // Live topic discovery (AI Security persona). Candidates are deduplicated
    // by canonical https URL; per-fetch outcomes (success/failure) are kept so
    // source reliability is auditable. Neither table feeds GET /api/agent/feed
    // — the feed is a pure projection of posts.
    sql: `
      CREATE TABLE discovery_candidates (
        id            TEXT PRIMARY KEY,
        canonical_url TEXT NOT NULL UNIQUE,
        title         TEXT NOT NULL,
        summary       TEXT,
        published_at  TEXT NOT NULL,
        source_name   TEXT NOT NULL,
        source_type   TEXT NOT NULL,
        raw_evidence  TEXT NOT NULL,
        fetched_at    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_discovery_candidates_published
        ON discovery_candidates (published_at DESC);

      CREATE TABLE discovery_fetches (
        id          TEXT PRIMARY KEY,
        source_name TEXT NOT NULL,
        source_type TEXT NOT NULL,
        url         TEXT NOT NULL,
        status      TEXT NOT NULL CHECK (status IN ('success','failure')),
        item_count  INTEGER,
        error       TEXT,
        fetched_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_discovery_fetches_source
        ON discovery_fetches (source_name, fetched_at DESC);
    `
  },
  {
    id: '005_editorial_decisions',
    // Deterministic editorial decisions over discovered candidates. One row per
    // candidate (upserted on re-evaluation); every accepted/held/rejected
    // outcome is persisted with its seven component scores and a
    // human-readable explanation.
    sql: `
      CREATE TABLE discovery_decisions (
        id                  TEXT PRIMARY KEY,
        candidate_id        TEXT NOT NULL UNIQUE REFERENCES discovery_candidates(id) ON DELETE CASCADE,
        decision            TEXT NOT NULL CHECK (decision IN ('accepted','held','rejected')),
        total_score         INTEGER NOT NULL,
        persona_relevance   INTEGER NOT NULL,
        technical_impact    INTEGER NOT NULL,
        source_quality      INTEGER NOT NULL,
        recency             INTEGER NOT NULL,
        novelty             INTEGER NOT NULL,
        discussion_value    INTEGER NOT NULL,
        evidence_confidence INTEGER NOT NULL,
        explanation         TEXT NOT NULL,
        decided_at          TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_discovery_decisions_decided
        ON discovery_decisions (decided_at DESC);
      CREATE INDEX IF NOT EXISTS idx_discovery_decisions_decision
        ON discovery_decisions (decision);
    `
  }
];

function applyMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id         TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);
  const applied = new Set(
    db.prepare('SELECT id FROM schema_migrations').all().map(r => String(r.id))
  );
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec('BEGIN');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)').run(
        migration.id,
        new Date().toISOString()
      );
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Connection (lazy singleton; safe during `next build` and read-only FS)
// ---------------------------------------------------------------------------

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  const dbPath = process.env.AETHRA_DB_PATH || path.join(process.cwd(), '.data', 'aethra.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const connection = new DatabaseSync(dbPath);
  connection.exec('PRAGMA journal_mode = WAL;');
  connection.exec('PRAGMA busy_timeout = 5000;');
  connection.exec('PRAGMA foreign_keys = ON;');
  applyMigrations(connection);
  db = connection;
  return connection;
}

/** Close the connection (used by tests to prove durability across reopen). */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** Run `fn` inside a SQLite transaction (BEGIN/COMMIT/ROLLBACK). Because
 *  DatabaseSync is synchronous, the transaction is atomic against the event
 *  loop: concurrent route handlers cannot observe a partial state. */
export function withTransaction<T>(fn: () => T): T {
  const d = getDb();
  d.exec('BEGIN');
  try {
    const result = fn();
    d.exec('COMMIT');
    return result;
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

const iso = (ms: number): string => new Date(ms).toISOString();

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

/** Upsert an agent row (create + update). Config columns are mirrored from
 *  the snapshot for queryability; state_json remains the client contract. */
export function putAgentRow(
  state: BackendAgentInstance,
  engine: EngineMeta,
  updatedAt: number = Date.now()
): void {
  const d = getDb();
  d.prepare(
    `INSERT INTO agents (id, name, role, domain, mission, frequency, style, status,
                         state_json, engine_json, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name        = excluded.name,
       role        = excluded.role,
       domain      = excluded.domain,
       mission     = excluded.mission,
       frequency   = excluded.frequency,
       style       = excluded.style,
       status      = excluded.status,
       state_json  = excluded.state_json,
       engine_json = excluded.engine_json,
       next_run_at = excluded.next_run_at,
       updated_at  = excluded.updated_at`
  ).run(
    state.agentId,
    state.config.name,
    state.config.role,
    state.config.domain,
    state.config.mission,
    state.config.frequency,
    state.config.style,
    state.status,
    JSON.stringify(state),
    JSON.stringify(engine),
    engine.nextRunAt,
    iso(updatedAt),
    iso(updatedAt)
  );
}

export function getAgentRow(agentId: string): AgentRow | null {
  const row = getDb()
    .prepare('SELECT state_json, engine_json, created_at, updated_at FROM agents WHERE id = ?')
    .get(agentId);
  if (!row) return null;
  return {
    state: JSON.parse(String(row.state_json)) as BackendAgentInstance,
    engine: JSON.parse(String(row.engine_json)) as EngineMeta,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function deleteAgentRow(agentId: string): void {
  getDb().prepare('DELETE FROM agents WHERE id = ?').run(agentId);
}

/** Scheduler's "due jobs" query — agents whose next run is due. */
export function listDueAgentIds(now: number): string[] {
  const rows = getDb().prepare('SELECT id FROM agents WHERE next_run_at <= ?').all(now);
  return rows.map(r => String(r.id));
}

// ---------------------------------------------------------------------------
// Topics
// ---------------------------------------------------------------------------

export interface UpsertTopicInput {
  agentId: string;
  title: string;
  canonicalSourceUrl: string;
  category: string | null;
  sourceName: string | null;
  credibilityScore: number | null;
  trendScore: number | null;
  noveltyScore: number | null;
  importanceScore: number | null;
  confidenceScore: number | null;
  recommendation: string | null;
  rejectionReason: string | null;
  detailedAnalysis: string | null;
  opinion: string | null;
  freshness: string | null;
  rawJson: string;
  createdAtMs: number;
}

/** Insert a topic if this agent has never scanned its canonical source before;
 *  otherwise return the existing topic id. This is the DB-level dedup key for
 *  "same canonical topic/source per agent". */
export function upsertTopicRow(input: UpsertTopicInput): string {
  const d = getDb();
  const existing = d
    .prepare('SELECT id FROM topics WHERE agent_id = ? AND canonical_source_url = ?')
    .get(input.agentId, input.canonicalSourceUrl);
  if (existing) return String(existing.id);

  const id = ulid();
  d.prepare(
    `INSERT INTO topics (id, agent_id, title, canonical_source_url, category, source_name,
                         credibility_score, trend_score, novelty_score, importance_score,
                         confidence_score, recommendation, rejection_reason, detailed_analysis,
                         opinion, freshness, raw_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.agentId,
    input.title,
    input.canonicalSourceUrl,
    input.category,
    input.sourceName,
    input.credibilityScore,
    input.trendScore,
    input.noveltyScore,
    input.importanceScore,
    input.confidenceScore,
    input.recommendation,
    input.rejectionReason,
    input.detailedAnalysis,
    input.opinion,
    input.freshness,
    input.rawJson,
    iso(input.createdAtMs)
  );
  return id;
}

export function getTopicRow(agentId: string, topicId: string): TopicRow | null {
  const row = getDb()
    .prepare('SELECT * FROM topics WHERE agent_id = ? AND id = ?')
    .get(agentId, topicId);
  if (!row) return null;
  return mapTopicRow(row);
}

function mapTopicRow(row: Record<string, unknown>): TopicRow {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    title: String(row.title),
    canonicalSourceUrl: String(row.canonical_source_url),
    category: row.category == null ? null : String(row.category),
    sourceName: row.source_name == null ? null : String(row.source_name),
    credibilityScore: row.credibility_score == null ? null : Number(row.credibility_score),
    trendScore: row.trend_score == null ? null : Number(row.trend_score),
    noveltyScore: row.novelty_score == null ? null : Number(row.novelty_score),
    importanceScore: row.importance_score == null ? null : Number(row.importance_score),
    confidenceScore: row.confidence_score == null ? null : Number(row.confidence_score),
    recommendation: row.recommendation == null ? null : String(row.recommendation),
    rejectionReason: row.rejection_reason == null ? null : String(row.rejection_reason),
    detailedAnalysis: row.detailed_analysis == null ? null : String(row.detailed_analysis),
    opinion: row.opinion == null ? null : String(row.opinion),
    freshness: row.freshness == null ? null : String(row.freshness),
    createdAt: String(row.created_at)
  };
}

// ---------------------------------------------------------------------------
// Sources (canonical HTTPS URLs)
// ---------------------------------------------------------------------------

export interface SourceInput {
  agentId: string;
  topicId: string;
  url: string;
  sourceName: string | null;
}

/** Idempotent insert: a (agent, url) pair is stored once. */
export function insertSource(input: SourceInput): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO sources (id, agent_id, topic_id, url, source_name)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(ulid(), input.agentId, input.topicId, input.url, input.sourceName);
}

function getSourceUrlsForTopic(agentId: string, topicId: string): string[] {
  if (!topicId) return [];
  const rows = getDb()
    .prepare('SELECT url FROM sources WHERE agent_id = ? AND topic_id = ? ORDER BY rowid')
    .all(agentId, topicId);
  return rows.map(r => String(r.url));
}

// ---------------------------------------------------------------------------
// Posts
// ---------------------------------------------------------------------------

export interface PostInput {
  id: string; // ULID, generated by the caller
  agentId: string;
  topicId: string | null;
  title: string;
  body: string;
  opinion: string | null;
  rationale: string | null;
  confidenceScore: number | null;
  category: string | null;
  importanceScore: number | null;
  noveltyScore: number | null;
  publicationId: string | null;
  publishedAtMs: number;
  /** Mark demo/seed posts. Demo posts are excluded from the judged feed and
   *  never count toward duplicate prevention. */
  isDemo?: boolean;
}

/** Insert a published post. Throws if (agent_id, topic_id) already has a real
 *  (non-demo) post — the DB-level duplicate-publication backstop. */
export function insertPost(input: PostInput): void {
  getDb()
    .prepare(
      `INSERT INTO posts (id, agent_id, topic_id, title, body, opinion, rationale,
                          confidence_score, category, importance_score, novelty_score,
                          publication_id, published_at, is_demo)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.agentId,
      input.topicId,
      input.title,
      input.body,
      input.opinion,
      input.rationale,
      input.confidenceScore,
      input.category,
      input.importanceScore,
      input.noveltyScore,
      input.publicationId,
      iso(input.publishedAtMs),
      input.isDemo ? 1 : 0
    );
}

/** Feed ordering: newest first (uses idx_posts_agent_published). Demo/seed
 *  posts are excluded by default (the judged API feed). */
export function getPostsByAgent(
  agentId: string,
  options: { includeDemo?: boolean } = {}
): FeedPost[] {
  const rows = getDb()
    .prepare(
      `SELECT id, published_at, title, body, opinion, rationale, topic_id, is_demo
       FROM posts WHERE agent_id = ? ${options.includeDemo ? '' : 'AND is_demo = 0'}
       ORDER BY published_at DESC, id DESC`
    )
    .all(agentId);
  return rows.map(r => {
    const topicId = r.topic_id == null ? null : String(r.topic_id);
    return {
      id: String(r.id),
      createdAt: String(r.published_at),
      title: String(r.title),
      body: String(r.body),
      opinion: r.opinion == null ? '' : String(r.opinion),
      rationale: r.rationale == null ? '' : String(r.rationale),
      topicId,
      sources: getSourceUrlsForTopic(agentId, topicId ?? ''),
      isDemo: Number(r.is_demo) === 1
    };
  });
}

/** Count real (non-demo) posts — the judged feed size. */
export function countPosts(agentId: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS n FROM posts WHERE agent_id = ? AND is_demo = 0')
    .get(agentId);
  return Number((row as { n: number }).n);
}

export function hasPublishedTopic(agentId: string, topicId: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM posts WHERE agent_id = ? AND topic_id = ? AND is_demo = 0 LIMIT 1')
    .get(agentId, topicId);
  return row != null;
}

/** True if this agent already published a REAL post whose topic carries one of
 *  the given canonical source URLs (cross-topic duplicate prevention). Demo
 *  posts are ignored. */
export function findPublishedByCanonicalSource(agentId: string, canonicalUrls: string[]): boolean {
  const urls = canonicalUrls.filter(Boolean);
  if (urls.length === 0) return false;
  const placeholders = urls.map(() => '?').join(', ');
  const row = getDb()
    .prepare(
      `SELECT 1 FROM posts p
       JOIN topics t ON t.id = p.topic_id
       WHERE p.agent_id = ? AND p.is_demo = 0 AND t.canonical_source_url IN (${placeholders})
       LIMIT 1`
    )
    .get(agentId, ...urls);
  return row != null;
}

// ---------------------------------------------------------------------------
// Editorial decisions
// ---------------------------------------------------------------------------

export interface DecisionInput {
  agentId: string;
  topicId: string;
  decision: 'accept' | 'reject';
  credibilityScore: number | null;
  noveltyScore: number | null;
  importanceScore: number | null;
  confidenceScore: number | null;
  explanation: string;
  decidedAtMs: number;
}

/** Insert a decision. Throws on (agent_id, topic_id) duplicates. */
export function insertDecision(input: DecisionInput): void {
  getDb()
    .prepare(
      `INSERT INTO editorial_decisions (id, agent_id, topic_id, decision, credibility_score,
                                        novelty_score, importance_score, confidence_score,
                                        explanation, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ulid(),
      input.agentId,
      input.topicId,
      input.decision,
      input.credibilityScore,
      input.noveltyScore,
      input.importanceScore,
      input.confidenceScore,
      input.explanation,
      iso(input.decidedAtMs)
    );
}

export function hasDecision(agentId: string, topicId: string): boolean {
  const row = getDb()
    .prepare('SELECT 1 FROM editorial_decisions WHERE agent_id = ? AND topic_id = ? LIMIT 1')
    .get(agentId, topicId);
  return row != null;
}

export function getDecisionsByAgent(agentId: string): DecisionRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, agent_id, topic_id, decision, credibility_score, novelty_score,
              importance_score, confidence_score, explanation, decided_at
       FROM editorial_decisions WHERE agent_id = ? ORDER BY decided_at DESC`
    )
    .all(agentId);
  return rows.map(r => ({
    id: String(r.id),
    agentId: String(r.agent_id),
    topicId: String(r.topic_id),
    decision: String(r.decision) as 'accept' | 'reject',
    credibilityScore: r.credibility_score == null ? null : Number(r.credibility_score),
    noveltyScore: r.novelty_score == null ? null : Number(r.novelty_score),
    importanceScore: r.importance_score == null ? null : Number(r.importance_score),
    confidenceScore: r.confidence_score == null ? null : Number(r.confidence_score),
    explanation: String(r.explanation),
    decidedAt: String(r.decided_at)
  }));
}

// ---------------------------------------------------------------------------
// Persona memory
// ---------------------------------------------------------------------------

export interface MemoryInput {
  id: string;
  agentId: string;
  nodeLabel: string;
  nodeGroup: string;
  details: string | null;
  connections: string[];
  createdAtMs: number;
}

export function insertMemoryNode(input: MemoryInput): void {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO persona_memory (id, agent_id, node_label, node_group, details, connections_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.agentId,
      input.nodeLabel,
      input.nodeGroup,
      input.details,
      JSON.stringify(input.connections),
      iso(input.createdAtMs)
    );
}

export function getMemoryNodesByAgent(agentId: string): MemoryRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, agent_id, node_label, node_group, details, connections_json, created_at
       FROM persona_memory WHERE agent_id = ? ORDER BY created_at DESC`
    )
    .all(agentId);
  return rows.map(r => ({
    id: String(r.id),
    agentId: String(r.agent_id),
    nodeLabel: String(r.node_label),
    nodeGroup: String(r.node_group),
    details: r.details == null ? null : String(r.details),
    connections: JSON.parse(String(r.connections_json)) as string[],
    createdAt: String(r.created_at)
  }));
}

// ---------------------------------------------------------------------------
// Agent runs (durable job history)
// ---------------------------------------------------------------------------

export interface RunInput {
  agentId: string;
  topicId: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
  outcome: string | null;
  startedAtMs: number;
}

/** Create a run row; returns its ULID id. */
export function insertRun(input: RunInput): string {
  const id = ulid();
  getDb()
    .prepare(
      `INSERT INTO agent_runs (id, agent_id, topic_id, status, outcome, started_at, finished_at, error, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      input.agentId,
      input.topicId,
      input.status,
      input.outcome,
      iso(input.startedAtMs),
      null,
      null,
      iso(input.startedAtMs)
    );
  return id;
}

export function updateRun(
  runId: string,
  fields: { status?: RunRow['status']; outcome?: string | null; finishedAtMs?: number; error?: string | null }
): void {
  const sets: string[] = [];
  const values: Array<string | number | null> = [];
  if (fields.status !== undefined) {
    sets.push('status = ?');
    values.push(fields.status);
  }
  if (fields.outcome !== undefined) {
    sets.push('outcome = ?');
    values.push(fields.outcome);
  }
  if (fields.error !== undefined) {
    sets.push('error = ?');
    values.push(fields.error);
  }
  if (fields.finishedAtMs !== undefined) {
    sets.push('finished_at = ?');
    values.push(iso(fields.finishedAtMs));
  }
  if (sets.length === 0) return;
  values.push(runId);
  getDb().prepare(`UPDATE agent_runs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

export function getRunsByAgent(agentId: string): RunRow[] {
  const rows = getDb()
    .prepare(
      `SELECT id, agent_id, topic_id, status, outcome, started_at, finished_at, error, created_at
       FROM agent_runs WHERE agent_id = ? ORDER BY started_at DESC`
    )
    .all(agentId);
  return rows.map(r => ({
    id: String(r.id),
    agentId: String(r.agent_id),
    topicId: r.topic_id == null ? null : String(r.topic_id),
    status: String(r.status) as RunRow['status'],
    outcome: r.outcome == null ? null : String(r.outcome),
    startedAt: String(r.started_at),
    finishedAt: r.finished_at == null ? null : String(r.finished_at),
    error: r.error == null ? null : String(r.error),
    createdAt: String(r.created_at)
  }));
}

// ---------------------------------------------------------------------------
// Init idempotency (POST /api/agent/init + Idempotency-Key)
// ---------------------------------------------------------------------------

export interface InitResponseRecord {
  /** Null while the key is claimed but the agent is not yet created. */
  agentId: string | null;
  responseJson: string;
  status: number;
}

/** Look up a stored idempotent response for a key. Rows claimed but not yet
 *  completed carry an empty response_json and are treated as stale. */
export function getInitResponse(idempotencyKey: string): InitResponseRecord | null {
  const row = getDb()
    .prepare('SELECT agent_id, response_json, status FROM init_requests WHERE idempotency_key = ?')
    .get(idempotencyKey);
  if (!row) return null;
  return {
    agentId: row.agent_id == null ? null : String(row.agent_id),
    responseJson: String(row.response_json),
    status: Number(row.status)
  };
}

/** Atomically claim a key. Returns true if THIS caller won the claim.
 *  Concurrency-safe: a second caller with the same key gets false and must
 *  replay the winner's stored response. The claim row precedes the agent, so
 *  agent_id is null until the winner stores its response. */
export function claimInitKey(idempotencyKey: string): boolean {
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO init_requests (idempotency_key, agent_id, response_json, status, created_at)
       VALUES (?, NULL, '', 0, ?)`
    )
    .run(idempotencyKey, new Date().toISOString());
  return result.changes > 0;
}

export function storeInitResponse(idempotencyKey: string, agentId: string, responseJson: string, status: number): void {
  getDb()
    .prepare('UPDATE init_requests SET agent_id = ?, response_json = ?, status = ? WHERE idempotency_key = ?')
    .run(agentId, responseJson, status, idempotencyKey);
}

/** Release a stale/aborted claim so the key can be retried. */
export function releaseInitKey(idempotencyKey: string): void {
  getDb().prepare('DELETE FROM init_requests WHERE idempotency_key = ?').run(idempotencyKey);
}

// ---------------------------------------------------------------------------
// Live discovery (discovery_candidates + discovery_fetches)
// ---------------------------------------------------------------------------

export interface DiscoveryCandidateRow {
  id: string;
  canonicalUrl: string;
  title: string;
  summary: string | null;
  publishedAt: string; // ISO UTC
  sourceName: string;
  sourceType: string;
  rawEvidence: string;
  fetchedAt: string; // ISO UTC
}

export interface DiscoveryFetchRow {
  id: string;
  sourceName: string;
  sourceType: string;
  url: string;
  status: 'success' | 'failure';
  itemCount: number | null;
  error: string | null;
  fetchedAt: string; // ISO UTC
}

/** Insert a discovered candidate; returns false when the canonical URL is
 *  already known (cross-run/cross-source dedup). */
export function insertDiscoveryCandidate(
  candidate: {
    id: string;
    canonicalUrl: string;
    title: string;
    summary: string;
    publishedAt: string;
    sourceName: string;
    sourceType: string;
    rawEvidence: string;
  },
  fetchedAtMs: number
): boolean {
  const result = getDb()
    .prepare(
      `INSERT OR IGNORE INTO discovery_candidates
         (id, canonical_url, title, summary, published_at, source_name, source_type, raw_evidence, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      candidate.id,
      candidate.canonicalUrl,
      candidate.title,
      candidate.summary,
      candidate.publishedAt,
      candidate.sourceName,
      candidate.sourceType,
      candidate.rawEvidence,
      iso(fetchedAtMs)
    );
  return result.changes > 0;
}

export function insertDiscoveryFetch(input: {
  id: string;
  sourceName: string;
  sourceType: string;
  url: string;
  status: 'success' | 'failure';
  itemCount: number | null;
  error: string | null;
  fetchedAtMs: number;
}): void {
  getDb()
    .prepare(
      `INSERT INTO discovery_fetches (id, source_name, source_type, url, status, item_count, error, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.sourceName,
      input.sourceType,
      input.url,
      input.status,
      input.itemCount,
      input.error,
      iso(input.fetchedAtMs)
    );
}

export function getDiscoveryCandidates(options: { limit?: number; sinceMs?: number } = {}): DiscoveryCandidateRow[] {
  const limit = Math.min(500, options.limit ?? 100);
  let sql = 'SELECT * FROM discovery_candidates';
  const args: Array<string | number> = [];
  if (options.sinceMs !== undefined) {
    sql += ' WHERE fetched_at >= ?';
    args.push(iso(options.sinceMs));
  }
  sql += ' ORDER BY published_at DESC LIMIT ?';
  args.push(limit);
  return getDb()
    .prepare(sql)
    .all(...args)
    .map(r => ({
      id: String(r.id),
      canonicalUrl: String(r.canonical_url),
      title: String(r.title),
      summary: r.summary == null ? null : String(r.summary),
      publishedAt: String(r.published_at),
      sourceName: String(r.source_name),
      sourceType: String(r.source_type),
      rawEvidence: String(r.raw_evidence),
      fetchedAt: String(r.fetched_at)
    }));
}

export function getDiscoveryFetches(options: { limit?: number } = {}): DiscoveryFetchRow[] {
  const limit = Math.min(500, options.limit ?? 50);
  return getDb()
    .prepare(
      `SELECT id, source_name, source_type, url, status, item_count, error, fetched_at
       FROM discovery_fetches ORDER BY fetched_at DESC LIMIT ?`
    )
    .all(limit)
    .map(r => ({
      id: String(r.id),
      sourceName: String(r.source_name),
      sourceType: String(r.source_type),
      url: String(r.url),
      status: String(r.status) as 'success' | 'failure',
      itemCount: r.item_count == null ? null : Number(r.item_count),
      error: r.error == null ? null : String(r.error),
      fetchedAt: String(r.fetched_at)
    }));
}

// ---------------------------------------------------------------------------
// Editorial decisions (discovery_decisions)
// ---------------------------------------------------------------------------

export type EditorialDecisionKind = 'accepted' | 'held' | 'rejected';

export interface DiscoveryDecisionRow {
  id: string;
  candidateId: string;
  decision: EditorialDecisionKind;
  totalScore: number;
  personaRelevance: number;
  technicalImpact: number;
  sourceQuality: number;
  recency: number;
  novelty: number;
  discussionValue: number;
  evidenceConfidence: number;
  explanation: string;
  decidedAt: string; // ISO UTC
}

export interface DiscoveryDecisionInput {
  id: string;
  candidateId: string;
  decision: EditorialDecisionKind;
  totalScore: number;
  components: {
    personaRelevance: number;
    technicalImpact: number;
    sourceQuality: number;
    recency: number;
    novelty: number;
    discussionValue: number;
    evidenceConfidence: number;
  };
  explanation: string;
  decidedAtMs: number;
}

/** Upsert one decision per candidate (re-evaluation updates in place). */
export function upsertDiscoveryDecision(input: DiscoveryDecisionInput): void {
  getDb()
    .prepare(
      `INSERT INTO discovery_decisions
         (id, candidate_id, decision, total_score, persona_relevance, technical_impact,
          source_quality, recency, novelty, discussion_value, evidence_confidence,
          explanation, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(candidate_id) DO UPDATE SET
         decision = excluded.decision,
         total_score = excluded.total_score,
         persona_relevance = excluded.persona_relevance,
         technical_impact = excluded.technical_impact,
         source_quality = excluded.source_quality,
         recency = excluded.recency,
         novelty = excluded.novelty,
         discussion_value = excluded.discussion_value,
         evidence_confidence = excluded.evidence_confidence,
         explanation = excluded.explanation,
         decided_at = excluded.decided_at`
    )
    .run(
      input.id,
      input.candidateId,
      input.decision,
      input.totalScore,
      input.components.personaRelevance,
      input.components.technicalImpact,
      input.components.sourceQuality,
      input.components.recency,
      input.components.novelty,
      input.components.discussionValue,
      input.components.evidenceConfidence,
      input.explanation,
      iso(input.decidedAtMs)
    );
}

function mapDiscoveryCandidateRow(row: Record<string, unknown>): DiscoveryCandidateRow {
  return {
    id: String(row.id),
    canonicalUrl: String(row.canonical_url),
    title: String(row.title),
    summary: row.summary == null ? '' : String(row.summary),
    publishedAt: String(row.published_at),
    sourceName: String(row.source_name),
    sourceType: String(row.source_type),
    rawEvidence: String(row.raw_evidence),
    fetchedAt: String(row.fetched_at)
  };
}

/** Candidates with no decision yet, or a held decision (retried each run). */
export function getPendingDecisionCandidates(limit: number): DiscoveryCandidateRow[] {
  return getDb()
    .prepare(
      `SELECT dc.id, dc.canonical_url, dc.title, dc.summary, dc.published_at, dc.source_name,
              dc.source_type, dc.raw_evidence, dc.fetched_at
       FROM discovery_candidates dc
       LEFT JOIN discovery_decisions dd ON dd.candidate_id = dc.id
       WHERE dd.id IS NULL OR dd.decision = 'held'
       ORDER BY dc.published_at DESC
       LIMIT ?`
    )
    .all(limit)
    .map(r => mapDiscoveryCandidateRow(r as Record<string, unknown>));
}

/** Titles + canonical URLs of previously ACCEPTED candidates (editorial memory). */
export function getAcceptedDecisionCandidates(): Array<{ title: string; canonicalUrl: string }> {
  return getDb()
    .prepare(
      `SELECT dc.title, dc.canonical_url
       FROM discovery_candidates dc
       JOIN discovery_decisions dd ON dd.candidate_id = dc.id
       WHERE dd.decision = 'accepted'`
    )
    .all()
    .map(r => ({ title: String(r.title), canonicalUrl: String(r.canonical_url) }));
}

/** Latest decided_at (ms) of an accepted decision within [sinceMs, now]; null if none. */
export function getLatestAcceptedAtMs(sinceMs: number): number | null {
  const row = getDb()
    .prepare(
      `SELECT MAX(decided_at) AS m FROM discovery_decisions
       WHERE decision = 'accepted' AND decided_at >= ?`
    )
    .get(iso(sinceMs));
  if (!row || row.m == null) return null;
  const parsed = Date.parse(String(row.m));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Count of accepted decisions decided at or after sinceMs. */
export function countAcceptedSinceMs(sinceMs: number): number {
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM discovery_decisions
       WHERE decision = 'accepted' AND decided_at >= ?`
    )
    .get(iso(sinceMs));
  return Number((row as { n: number }).n);
}

/** True if any agent already published a real post for this canonical URL. */
export function hasPublishedCanonicalUrl(url: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM posts p
       JOIN topics t ON t.id = p.topic_id
       WHERE p.is_demo = 0 AND t.canonical_source_url = ?
       LIMIT 1`
    )
    .get(url);
  return row != null;
}

export function getDiscoveryDecisions(options: { limit?: number; decision?: EditorialDecisionKind } = {}): DiscoveryDecisionRow[] {
  const limit = Math.min(500, options.limit ?? 100);
  let sql =
    `SELECT id, candidate_id, decision, total_score, persona_relevance, technical_impact,
            source_quality, recency, novelty, discussion_value, evidence_confidence,
            explanation, decided_at
     FROM discovery_decisions`;
  const args: Array<string | number> = [];
  if (options.decision) {
    sql += ' WHERE decision = ?';
    args.push(options.decision);
  }
  sql += ' ORDER BY decided_at DESC LIMIT ?';
  args.push(limit);
  return getDb()
    .prepare(sql)
    .all(...args)
    .map(r => ({
      id: String(r.id),
      candidateId: String(r.candidate_id),
      decision: String(r.decision) as EditorialDecisionKind,
      totalScore: Number(r.total_score),
      personaRelevance: Number(r.persona_relevance),
      technicalImpact: Number(r.technical_impact),
      sourceQuality: Number(r.source_quality),
      recency: Number(r.recency),
      novelty: Number(r.novelty),
      discussionValue: Number(r.discussion_value),
      evidenceConfidence: Number(r.evidence_confidence),
      explanation: String(r.explanation),
      decidedAt: String(r.decided_at)
    }));
}
