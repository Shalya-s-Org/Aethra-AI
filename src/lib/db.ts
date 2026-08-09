import { DatabaseSync } from 'node:sqlite';
import type { BackendAgentInstance, EngineMeta } from './agentTypes';
import { ulid } from './ids';
import { titleHash } from './memory/similarity';
import { sqliteStorage } from './storage';

// Synchronous DAO layer over the SQLite storage driver (src/lib/storage). The
// connection, WAL pragmas, and the versioned migration registry live in the
// storage module (schema_migrations tracks applied ids), so the schema is
// shared with the Postgres driver. This DAO is SQLite-only by design; the
// async StorageDriver interface is the path for Postgres deployments.
//
// Schema overview (see src/lib/storage/migrations.ts):
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
// Migrations — the shared registry (one schema, SQLite + Postgres dialects)
// lives in src/lib/storage/migrations.ts and is applied by the storage
// drivers; applied ids are tracked in `schema_migrations`.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Connection — owned by the SQLite storage driver (src/lib/storage/sqlite.ts),
// which applies the shared migrations on first connect. The DAO layer is
// SQLite-only; Postgres deployments go through the async StorageDriver
// interface instead (see src/lib/storage).
// ---------------------------------------------------------------------------

/** The synchronous DAO connection (lazy; safe during `next build`). */
export function getDb(): DatabaseSync {
  assertSqliteStorage();
  return sqliteStorage().raw();
}

/** Close the connection (used by tests to prove durability across reopen). */
export function closeDb(): void {
  sqliteStorage().closeSync();
}

/** The sync DAO must never silently run against a different store than the
 *  one configured. Postgres needs the async StorageDriver layer; mixing the
 *  two would write app data to a local file while the deployment expects a
 *  shared database. */
function assertSqliteStorage(): void {
  const kind = (process.env.AETHRA_STORAGE ?? 'sqlite').toLowerCase();
  if (kind !== 'sqlite') {
    throw new Error(
      `AETHRA_STORAGE=${process.env.AETHRA_STORAGE} is not supported by the synchronous DAO ` +
        '(src/lib/db.ts). This DAO layer is SQLite-only; use the async StorageDriver ' +
        '(src/lib/storage) for Postgres deployments.'
    );
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
  /** Delivery guard: UNIQUE(agent_id, idempotency_key). A re-delivered job
   *  occurrence (same key) can never insert the same post twice. */
  idempotencyKey?: string;
}

/** Insert a published post. Throws if (agent_id, topic_id) already has a real
 *  (non-demo) post — the DB-level duplicate-publication backstop. */
export function insertPost(input: PostInput): void {
  getDb()
    .prepare(
      `INSERT INTO posts (id, agent_id, topic_id, title, title_hash, body, opinion, rationale,
                          confidence_score, category, importance_score, novelty_score,
                          publication_id, published_at, is_demo, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.id,
      input.agentId,
      input.topicId,
      input.title,
      titleHash(input.title),
      input.body,
      input.opinion,
      input.rationale,
      input.confidenceScore,
      input.category,
      input.importanceScore,
      input.noveltyScore,
      input.publicationId,
      iso(input.publishedAtMs),
      input.isDemo ? 1 : 0,
      input.idempotencyKey ?? null
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
  /** Candidate headline (joined from discovery_candidates). */
  title: string;
  /** Candidate canonical URL + source (joined from discovery_candidates). */
  candidateUrl: string | null;
  sourceName: string | null;
  sourceType: string | null;
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
  generationStatus: 'none' | 'generated' | 'failed';
  generatedJson: string | null;
  generationFailure: string | null;
  qualityStatus: 'pending' | 'passed' | 'held' | 'rejected';
  qualityJson: string | null;
  publishedPostId: string | null;
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
  /** LLM generation outcome (schema-validated JSON, or the failure). */
  generation?: {
    status: 'none' | 'generated' | 'failed';
    json?: string | null;
    failure?: string | null;
  };
  /** Pre-publication quality gate outcome (full report JSON). */
  quality?: {
    status: 'pending' | 'passed' | 'held' | 'rejected';
    json?: string | null;
  };
}

/** Upsert one decision per candidate (re-evaluation updates in place). */
export function upsertDiscoveryDecision(input: DiscoveryDecisionInput): void {
  getDb()
    .prepare(
      `INSERT INTO discovery_decisions
         (id, candidate_id, decision, total_score, persona_relevance, technical_impact,
          source_quality, recency, novelty, discussion_value, evidence_confidence,
          explanation, decided_at, generated_json, generation_status, generation_failure,
          quality_json, quality_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
         decided_at = excluded.decided_at,
         generated_json = excluded.generated_json,
         generation_status = excluded.generation_status,
         generation_failure = excluded.generation_failure,
         quality_json = excluded.quality_json,
         quality_status = excluded.quality_status`
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
      iso(input.decidedAtMs),
      input.generation?.json ?? null,
      input.generation?.status ?? 'none',
      input.generation?.failure ?? null,
      input.quality?.json ?? null,
      input.quality?.status ?? 'pending'
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

/** Accepted candidates as short-term editorial memory (id, title, summary,
 *  canonical URL), newest first, bounded — the duplicate ladder's memory set
 *  for the persona scope. */
export function getAcceptedDecisionCandidates(): Array<{
  id: string;
  title: string;
  summary: string;
  canonicalUrl: string;
}> {
  return getDb()
    .prepare(
      `SELECT dc.id, dc.title, dc.summary, dc.canonical_url
       FROM discovery_candidates dc
       JOIN discovery_decisions dd ON dd.candidate_id = dc.id
       WHERE dd.decision = 'accepted'
       ORDER BY dd.decided_at DESC
       LIMIT 500`
    )
    .all()
    .map(r => ({
      id: String(r.id),
      title: String(r.title),
      summary: r.summary == null ? '' : String(r.summary),
      canonicalUrl: String(r.canonical_url)
    }));
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
    `SELECT dd.id, dd.candidate_id, dc.title, dc.canonical_url, dc.source_name, dc.source_type,
            dd.decision, dd.total_score, dd.persona_relevance,
            dd.technical_impact, dd.source_quality, dd.recency, dd.novelty, dd.discussion_value,
            dd.evidence_confidence, dd.explanation, dd.decided_at, dd.generated_json,
            dd.generation_status, dd.generation_failure, dd.quality_json, dd.quality_status,
            dd.published_post_id
     FROM discovery_decisions dd
     JOIN discovery_candidates dc ON dc.id = dd.candidate_id`;
  const args: Array<string | number> = [];
  if (options.decision) {
    sql += ' WHERE dd.decision = ?';
    args.push(options.decision);
  }
  sql += ' ORDER BY dd.decided_at DESC LIMIT ?';
  args.push(limit);
  return getDb()
    .prepare(sql)
    .all(...args)
    .map(r => ({
      id: String(r.id),
      candidateId: String(r.candidate_id),
      title: String(r.title),
      candidateUrl: r.canonical_url == null ? null : String(r.canonical_url),
      sourceName: r.source_name == null ? null : String(r.source_name),
      sourceType: r.source_type == null ? null : String(r.source_type),
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
      decidedAt: String(r.decided_at),
      generationStatus: String(r.generation_status) as 'none' | 'generated' | 'failed',
      generatedJson: r.generated_json == null ? null : String(r.generated_json),
      generationFailure: r.generation_failure == null ? null : String(r.generation_failure),
      qualityStatus: String(r.quality_status) as 'pending' | 'passed' | 'held' | 'rejected',
      qualityJson: r.quality_json == null ? null : String(r.quality_json),
      publishedPostId: r.published_post_id == null ? null : String(r.published_post_id)
    }));
}

/** Recently accepted decisions that carry generated output (draft openings
 *  and titles feed the quality gate's framing/variation checks). */
export function getRecentGeneratedAccepted(limit = 20): Array<{
  title: string;
  generatedJson: string;
  decidedAt: string;
}> {
  return getDb()
    .prepare(
      `SELECT dc.title, dd.generated_json, dd.decided_at
       FROM discovery_decisions dd
       JOIN discovery_candidates dc ON dc.id = dd.candidate_id
       WHERE dd.decision = 'accepted' AND dd.generation_status = 'generated'
         AND dd.generated_json IS NOT NULL
       ORDER BY dd.decided_at DESC
       LIMIT ?`
    )
    .all(limit)
    .map(r => ({
      title: String(r.title),
      generatedJson: String(r.generated_json),
      decidedAt: String(r.decided_at)
    }));
}

// ---------------------------------------------------------------------------
// Durable memory (migration 006): memory_entries + post_links
// ---------------------------------------------------------------------------

export type MemoryKind = 'short_term' | 'long_term' | 'editorial';

export interface MemoryEntryRow {
  id: string;
  agentId: string | null; // null = persona scope (discovery/editorial pipeline)
  kind: MemoryKind;
  subject: string;
  content: string;
  importance: number;
  occurrences: number;
  metadata: Record<string, unknown>;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
}

function mapMemoryEntryRow(r: Record<string, unknown>): MemoryEntryRow {
  const metaRaw = r.metadata_json == null ? null : String(r.metadata_json);
  let metadata: Record<string, unknown> = {};
  if (metaRaw) {
    try {
      metadata = JSON.parse(metaRaw) as Record<string, unknown>;
    } catch {
      metadata = {};
    }
  }
  return {
    id: String(r.id),
    agentId: r.agent_id == null ? null : String(r.agent_id),
    kind: String(r.kind) as MemoryKind,
    subject: String(r.subject),
    content: String(r.content),
    importance: Number(r.importance),
    occurrences: Number(r.occurrences),
    metadata,
    firstSeenAt: String(r.first_seen_at),
    lastSeenAt: String(r.last_seen_at),
    createdAt: String(r.created_at)
  };
}

export interface UpsertMemoryEntryInput {
  agentId: string | null;
  kind: MemoryKind;
  subject: string;
  content: string;
  importance?: number;
  metadata?: Record<string, unknown>;
  nowMs: number;
}

/** Upsert a memory entry keyed by (scope, kind, subject): the first sighting
 *  creates it; later sightings bump occurrences + last_seen_at and refresh the
 *  content (e.g. the persona's latest stance on a story). */
export function upsertMemoryEntry(input: UpsertMemoryEntryInput): void {
  const d = getDb();
  const existing = d
    .prepare(
      `SELECT id, occurrences FROM memory_entries
       WHERE COALESCE(agent_id, '') = COALESCE(?, '') AND kind = ? AND subject = ?`
    )
    .get(input.agentId ?? '', input.kind, input.subject);
  const nowIso = iso(input.nowMs);
  const importance = input.importance ?? 1;
  const meta = JSON.stringify(input.metadata ?? null);
  if (existing) {
    d.prepare(
      `UPDATE memory_entries
       SET content = ?, importance = ?, occurrences = occurrences + 1,
           metadata_json = ?, last_seen_at = ?
       WHERE id = ?`
    ).run(input.content, importance, meta, nowIso, String(existing.id));
  } else {
    d.prepare(
      `INSERT INTO memory_entries
       (id, agent_id, kind, subject, content, importance, occurrences,
        metadata_json, first_seen_at, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
    ).run(
      ulid(),
      input.agentId,
      input.kind,
      input.subject,
      input.content,
      importance,
      meta,
      nowIso,
      nowIso,
      nowIso
    );
  }
}

export function getMemoryEntryBySubject(
  agentId: string | null,
  kind: MemoryKind,
  subject: string
): MemoryEntryRow | null {
  const row = getDb()
    .prepare(
      `SELECT * FROM memory_entries
       WHERE COALESCE(agent_id, '') = COALESCE(?, '') AND kind = ? AND subject = ?`
    )
    .get(agentId ?? '', kind, subject);
  return row ? mapMemoryEntryRow(row) : null;
}

export function getRecentMemoryEntries(opts: {
  agentId: string | null;
  kinds: MemoryKind[];
  limit: number;
}): MemoryEntryRow[] {
  const placeholders = opts.kinds.map(() => '?').join(',');
  const rows = getDb()
    .prepare(
      `SELECT * FROM memory_entries
       WHERE COALESCE(agent_id, '') = COALESCE(?, '') AND kind IN (${placeholders})
       ORDER BY last_seen_at DESC
       LIMIT ?`
    )
    .all(opts.agentId ?? '', ...opts.kinds, opts.limit);
  return rows.map(mapMemoryEntryRow);
}

/** Recent real (non-demo) posts of an agent, with canonical source URLs —
 *  short-term memory and the link-ladder's memory set for an agent scope. */
export interface PostMemoryRow {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  canonicalUrl: string | null;
  titleHash: string | null;
}

export function getRecentPostsForMemory(agentId: string, limit = 100): PostMemoryRow[] {
  const rows = getDb()
    .prepare(
      `SELECT p.id, p.title, p.body, p.published_at, p.title_hash, t.canonical_source_url
       FROM posts p LEFT JOIN topics t ON t.id = p.topic_id
       WHERE p.agent_id = ? AND p.is_demo = 0
       ORDER BY p.published_at DESC
       LIMIT ?`
    )
    .all(agentId, limit);
  return rows.map(r => ({
    id: String(r.id),
    title: String(r.title),
    body: String(r.body),
    publishedAt: String(r.published_at),
    canonicalUrl: r.canonical_source_url == null ? null : String(r.canonical_source_url),
    titleHash: r.title_hash == null ? null : String(r.title_hash)
  }));
}

export type PostLinkRelation = 'follow_up' | 'confirms' | 'updates' | 'contradicts' | 'related';

export interface PostLinkRow {
  id: string;
  postId: string;
  relatedPostId: string;
  relationType: PostLinkRelation;
  similarity: number | null;
  reason: string | null;
  createdAt: string;
}

export function insertPostLink(input: {
  postId: string;
  relatedPostId: string;
  relationType: PostLinkRelation;
  similarity: number | null;
  reason: string | null;
  nowMs: number;
}): void {
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO post_links
       (id, post_id, related_post_id, relation_type, similarity, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      ulid(),
      input.postId,
      input.relatedPostId,
      input.relationType,
      input.similarity,
      input.reason,
      iso(input.nowMs)
    );
}

export function getPostLinks(postId: string): PostLinkRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM post_links WHERE post_id = ? ORDER BY similarity DESC, created_at ASC`)
    .all(postId);
  return rows.map(r => ({
    id: String(r.id),
    postId: String(r.post_id),
    relatedPostId: String(r.related_post_id),
    relationType: String(r.relation_type) as PostLinkRelation,
    similarity: r.similarity == null ? null : Number(r.similarity),
    reason: r.reason == null ? null : String(r.reason),
    createdAt: String(r.created_at)
  }));
}

// ---------------------------------------------------------------------------
// Durable job queue (migration 009): scheduled_jobs + publication markers
// ---------------------------------------------------------------------------

export type ScheduledJobStatus = 'active' | 'paused' | 'terminal';

export interface ScheduledJobRow {
  id: string;
  agentId: string;
  jobType: string;
  status: ScheduledJobStatus;
  scheduleMs: number;
  nextRunAtMs: number;
  leaseOwner: string | null;
  leaseExpiresAtMs: number | null;
  attempts: number;
  maxAttempts: number;
  backoffMs: number;
  idempotencyKey: string | null;
  lastRunAtMs: number | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapScheduledJobRow(r: Record<string, unknown>): ScheduledJobRow {
  return {
    id: String(r.id),
    agentId: String(r.agent_id),
    jobType: String(r.job_type),
    status: String(r.status) as ScheduledJobStatus,
    scheduleMs: Number(r.schedule_ms),
    nextRunAtMs: Number(r.next_run_at),
    leaseOwner: r.lease_owner == null ? null : String(r.lease_owner),
    leaseExpiresAtMs: r.lease_expires_at == null ? null : Number(r.lease_expires_at),
    attempts: Number(r.attempts),
    maxAttempts: Number(r.max_attempts),
    backoffMs: Number(r.backoff_ms),
    idempotencyKey: r.idempotency_key == null ? null : String(r.idempotency_key),
    lastRunAtMs: r.last_run_at == null ? null : Number(r.last_run_at),
    lastError: r.last_error == null ? null : String(r.last_error),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at)
  };
}

export interface ScheduleJobInput {
  agentId: string;
  scheduleMs: number;
  firstRunAtMs: number;
  maxAttempts?: number;
  backoffMs?: number;
}

/** Create or refresh the agent's recurring job (idempotent upsert on agent_id). */
export function upsertScheduledJob(input: ScheduleJobInput): string {
  const existing = getDb()
    .prepare('SELECT id FROM scheduled_jobs WHERE agent_id = ?')
    .get(input.agentId);
  const nowIso = iso(input.firstRunAtMs);
  if (existing) {
    getDb()
      .prepare(
        `UPDATE scheduled_jobs
         SET schedule_ms = ?, next_run_at = ?, max_attempts = ?, backoff_ms = ?,
             status = 'active', lease_owner = NULL, lease_expires_at = NULL,
             attempts = 0, last_error = NULL, updated_at = ?
         WHERE id = ?`
      )
      .run(input.scheduleMs, input.firstRunAtMs, input.maxAttempts ?? 5, input.backoffMs ?? 1000, nowIso, String(existing.id));
    return String(existing.id);
  }
  const id = ulid(input.firstRunAtMs);
  getDb()
    .prepare(
      `INSERT INTO scheduled_jobs
         (id, agent_id, job_type, status, schedule_ms, next_run_at, max_attempts, backoff_ms, created_at, updated_at)
       VALUES (?, ?, 'agent_cycle', 'active', ?, ?, ?, ?, ?, ?)`
    )
    .run(id, input.agentId, input.scheduleMs, input.firstRunAtMs, input.maxAttempts ?? 5, input.backoffMs ?? 1000, nowIso, nowIso);
  return id;
}

export function getScheduledJobByAgent(agentId: string): ScheduledJobRow | null {
  const r = getDb().prepare('SELECT * FROM scheduled_jobs WHERE agent_id = ?').get(agentId);
  return r == null ? null : mapScheduledJobRow(r as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Scheduler health (GET /api/health)
// ---------------------------------------------------------------------------

export interface SchedulerHealth {
  agents: number;
  /** Jobs whose recurring cadence is live. */
  activeJobs: number;
  /** Jobs whose most recent occurrence failed (last_error set). */
  degradedJobs: number;
  /** Last successful run across all jobs (last_run_at is set only on success). */
  lastRunAtMs: number | null;
  /** Earliest next occurrence among active jobs. */
  nextDueAtMs: number | null;
}

/** Aggregate scheduler status for the health endpoint. */
export function getSchedulerHealth(): SchedulerHealth {
  const d = getDb();
  const agents = Number((d.prepare('SELECT COUNT(*) AS n FROM agents').get() as { n: number }).n);
  const counts = d
    .prepare(`SELECT status, COUNT(*) AS n FROM scheduled_jobs GROUP BY status`)
    .all() as Array<{ status: string; n: number }>;
  const byStatus = Object.fromEntries(counts.map(c => [c.status, Number(c.n)]));
  const degraded = d
    .prepare(`SELECT COUNT(*) AS n FROM scheduled_jobs WHERE last_error IS NOT NULL`)
    .get() as { n: number };
  const lastRun = d.prepare('SELECT MAX(last_run_at) AS v FROM scheduled_jobs').get() as { v: number | null };
  const nextDue = d
    .prepare(`SELECT MIN(next_run_at) AS v FROM scheduled_jobs WHERE status = 'active'`)
    .get() as { v: number | null };
  return {
    agents,
    activeJobs: byStatus.active ?? 0,
    degradedJobs: Number(degraded.n),
    lastRunAtMs: lastRun.v == null ? null : Number(lastRun.v),
    nextDueAtMs: nextDue.v == null ? null : Number(nextDue.v)
  };
}

/**
 * Atomically claim one due occurrence. The guard lives in the WHERE clause, so
 * only one worker (this process) wins even under concurrent claims; expired
 * leases (crashed workers) become claimable again — restart recovery.
 */
export function claimScheduledJob(
  jobId: string,
  now: number,
  owner: string,
  leaseExpiresAtMs: number,
  idempotencyKey: string,
  expectedNextRunAtMs: number
): boolean {
  const res = getDb()
    .prepare(
      `UPDATE scheduled_jobs
       SET lease_owner = ?, lease_expires_at = ?, idempotency_key = ?, updated_at = ?
       WHERE id = ? AND status = 'active' AND next_run_at = ?
         AND next_run_at <= ?
         AND (lease_expires_at IS NULL OR lease_expires_at <= ?)`
    )
    .run(owner, leaseExpiresAtMs, idempotencyKey, iso(now), jobId, expectedNextRunAtMs, now, now);
  return res.changes === 1;
}

/** Release the lease on completion/failure (next_run_at already set). */
export function releaseScheduledJobLease(jobId: string, now: number): void {
  getDb()
    .prepare(
      `UPDATE scheduled_jobs SET lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?`
    )
    .run(iso(now), jobId);
}

export interface ScheduledJobOutcome {
  /** Occurrence succeeded: schedule the next regular occurrence. */
  ok: boolean;
  /** Next regular occurrence (ok=true) or retry-at (transient failure). */
  nextRunAtMs: number;
  /** Terminal failure recorded (attempts exhausted) — cadence continues. */
  terminal?: boolean;
  error?: string;
}

/** Record an occurrence outcome: advances the schedule, backoff, or terminal
 *  failure, and clears the lease in one UPDATE. */
export function settleScheduledJob(jobId: string, outcome: ScheduledJobOutcome, now: number): void {
  const sets = [
    'lease_owner = NULL',
    'lease_expires_at = NULL',
    'updated_at = ?'
  ];
  const values: Array<string | number | null> = [iso(now)];
  if (outcome.ok) {
    sets.push('next_run_at = ?', 'attempts = 0', 'last_error = NULL', 'last_run_at = ?');
    values.push(outcome.nextRunAtMs, now);
  } else {
    sets.push('next_run_at = ?');
    values.push(outcome.nextRunAtMs);
    if (outcome.terminal) {
      sets.push('last_error = ?', 'attempts = 0');
      values.push(outcome.error ?? 'occurrence failed');
    } else {
      sets.push('attempts = attempts + 1');
      if (outcome.error != null) {
        sets.push('last_error = ?');
        values.push(outcome.error);
      }
    }
  }
  values.push(jobId);
  getDb().prepare(`UPDATE scheduled_jobs SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

// ---------------------------------------------------------------------------
// Transactional gated publication (decision -> post)
// ---------------------------------------------------------------------------

export interface PublishableDecisionRow {
  decisionId: string;
  candidateId: string;
  title: string;
  canonicalUrl: string;
  sourceName: string;
  sourceType: string;
  generatedJson: string;
  qualityJson: string;
  totalScore: number;
}

/** Gate-passed, generated, accepted decisions that have not been published
 *  yet — the ONLY candidates for publication. */
export function getPublishableDecisions(limit = 25): PublishableDecisionRow[] {
  // The discovery/editorial pipeline is persona-global (one Ada persona):
  // candidates and decisions carry no agent_id. Publication is per-agent but
  // the global once-only guard (published_post_id) means a decision publishes
  // at most once across all agents — the first agent's cycle to claim it wins.
  return getDb()
    .prepare(
      `SELECT dd.id AS decision_id, dd.candidate_id, dc.title, dc.canonical_url,
              dc.source_name, dc.source_type, dd.generated_json, dd.quality_json, dd.total_score
       FROM discovery_decisions dd
       JOIN discovery_candidates dc ON dc.id = dd.candidate_id
       WHERE dd.decision = 'accepted'
         AND dd.generation_status = 'generated'
         AND dd.quality_status = 'passed'
         AND dd.published_post_id IS NULL
       ORDER BY dd.decided_at ASC
       LIMIT ?`
    )
    .all(limit)
    .map(r => ({
      decisionId: String(r.decision_id),
      candidateId: String(r.candidate_id),
      title: String(r.title),
      canonicalUrl: String(r.canonical_url),
      sourceName: String(r.source_name),
      sourceType: String(r.source_type),
      generatedJson: String(r.generated_json),
      qualityJson: String(r.quality_json),
      totalScore: Number(r.total_score)
    }));
}

/** Mark a decision as published (global once-only guard). Returns false if
 *  another worker already published it — callers roll back their transaction. */
export function markDecisionPublished(decisionId: string, postId: string): boolean {
  const res = getDb()
    .prepare(
      `UPDATE discovery_decisions SET published_post_id = ? WHERE id = ? AND published_post_id IS NULL`
    )
    .run(postId, decisionId);
  return res.changes === 1;
}

export function getScheduledJobRow(jobId: string): ScheduledJobRow | null {
  const r = getDb().prepare('SELECT * FROM scheduled_jobs WHERE id = ?').get(jobId);
  return r == null ? null : mapScheduledJobRow(r as Record<string, unknown>);
}

/** Due occurrences: lease free or expired (crash recovery), scheduled at/before now. */
export function listDueJobIdsSql(now: number, limit: number): string[] {
  return getDb()
    .prepare(
      `SELECT id FROM scheduled_jobs
       WHERE status = 'active' AND next_run_at <= ?
         AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
       ORDER BY next_run_at ASC
       LIMIT ?`
    )
    .all(now, now, limit)
    .map(r => String(r.id));
}
