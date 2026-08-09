// Shared migration registry.
//
// One schema, two dialects: each migration carries the SQL for SQLite
// (node:sqlite, the local dev/test driver) and for Postgres (the shared,
// multi-instance driver). The ids are stable and tracked in a
// `schema_migrations (id, applied_at)` table by both drivers, so an existing
// SQLite database keeps its applied state when this registry is used.
//
// The schema preserves the app's domain concepts: agents, topics, sources,
// posts (feed ordering + demo flag), editorial decisions, persona memory +
// post links, discovery candidates/fetches/decisions (with generation and
// quality-gate columns), agent runs, scheduled jobs (leases, backoff, terminal
// failures), and idempotency (init_requests, posts.idempotency_key, the global
// published_post_id marker).

export interface Migration {
  id: string;
  sqlite: string;
  postgres: string;
}

export const MIGRATIONS: Migration[] = [
  {
    id: '001_initial_relational_schema',
    sqlite: `
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
    `,
    postgres: `
      DROP TABLE IF EXISTS agents CASCADE;

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
        next_run_at BIGINT NOT NULL,
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
    sqlite: `
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
    `,
    postgres: `
      ALTER TABLE posts ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT FALSE;

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
    sqlite: `
      DROP TABLE IF EXISTS init_requests;
      CREATE TABLE init_requests (
        idempotency_key TEXT PRIMARY KEY,
        agent_id        TEXT REFERENCES agents(id) ON DELETE CASCADE,
        response_json   TEXT NOT NULL,
        status          INTEGER NOT NULL,
        created_at      TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_init_requests_agent ON init_requests (agent_id);
    `,
    postgres: `
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
    sqlite: `
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
    `,
    postgres: `
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
    sqlite: `
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
    `,
    postgres: `
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
  },
  {
    id: '006_durable_memory',
    // Durable agent/persona memory + post-to-post links.
    //   memory_entries  short-term / long-term / editorial memory, keyed by
    //                   (COALESCE(agent_id,''), kind, subject). agent_id NULL
    //                   = persona scope (the discovery/editorial pipeline); a
    //                   real agent id = that agent's scope. UNIQUE via the
    //                   expression index so NULL agent_ids still dedupe.
    //   post_links      which earlier posts a new post relates to, and how
    //                   (follow_up / confirms / updates / contradicts / related).
    //   posts.title_hash  normalized-title hash for the level-2 duplicate
    //                   check (exact normalized-title matches, indexable).
    sqlite: `
      CREATE TABLE memory_entries (
        id            TEXT PRIMARY KEY,
        agent_id      TEXT REFERENCES agents(id) ON DELETE CASCADE,
        kind          TEXT NOT NULL CHECK (kind IN ('short_term','long_term','editorial')),
        subject       TEXT NOT NULL,
        content       TEXT NOT NULL,
        importance    INTEGER NOT NULL DEFAULT 1,
        occurrences   INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at  TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_memory_scope_subject
        ON memory_entries (COALESCE(agent_id, ''), kind, subject);
      CREATE INDEX idx_memory_scope_kind
        ON memory_entries (agent_id, kind, last_seen_at DESC);

      CREATE TABLE post_links (
        id              TEXT PRIMARY KEY,
        post_id         TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        related_post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        relation_type   TEXT NOT NULL CHECK (relation_type IN ('follow_up','confirms','updates','contradicts','related')),
        similarity      REAL,
        reason          TEXT,
        created_at      TEXT NOT NULL,
        UNIQUE (post_id, related_post_id, relation_type)
      );
      CREATE INDEX idx_post_links_post ON post_links (post_id);
      CREATE INDEX idx_post_links_related ON post_links (related_post_id);

      ALTER TABLE posts ADD COLUMN title_hash TEXT;
      CREATE INDEX idx_posts_title_hash ON posts (title_hash);
    `,
    postgres: `
      CREATE TABLE memory_entries (
        id            TEXT PRIMARY KEY,
        agent_id      TEXT REFERENCES agents(id) ON DELETE CASCADE,
        kind          TEXT NOT NULL CHECK (kind IN ('short_term','long_term','editorial')),
        subject       TEXT NOT NULL,
        content       TEXT NOT NULL,
        importance    INTEGER NOT NULL DEFAULT 1,
        occurrences   INTEGER NOT NULL DEFAULT 1,
        metadata_json TEXT,
        first_seen_at TEXT NOT NULL,
        last_seen_at  TEXT NOT NULL,
        created_at    TEXT NOT NULL
      );
      CREATE UNIQUE INDEX idx_memory_scope_subject
        ON memory_entries (COALESCE(agent_id, ''), kind, subject);
      CREATE INDEX idx_memory_scope_kind
        ON memory_entries (agent_id, kind, last_seen_at DESC);

      CREATE TABLE post_links (
        id              TEXT PRIMARY KEY,
        post_id         TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        related_post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
        relation_type   TEXT NOT NULL CHECK (relation_type IN ('follow_up','confirms','updates','contradicts','related')),
        similarity      DOUBLE PRECISION,
        reason          TEXT,
        created_at      TEXT NOT NULL,
        UNIQUE (post_id, related_post_id, relation_type)
      );
      CREATE INDEX idx_post_links_post ON post_links (post_id);
      CREATE INDEX idx_post_links_related ON post_links (related_post_id);

      ALTER TABLE posts ADD COLUMN IF NOT EXISTS title_hash TEXT;
      CREATE INDEX IF NOT EXISTS idx_posts_title_hash ON posts (title_hash);
    `
  },
  {
    id: '007_llm_generation',
    // Server-side LLM post generation. Every accepted editorial decision may
    // carry generated output; the status records whether generation succeeded
    // (schema-validated JSON persisted) or failed (the decision was flipped to
    // rejected rather than publishing weak content).
    sqlite: `
      ALTER TABLE discovery_decisions ADD COLUMN generated_json TEXT;
      ALTER TABLE discovery_decisions ADD COLUMN generation_status TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE discovery_decisions ADD COLUMN generation_failure TEXT;
      CREATE INDEX IF NOT EXISTS idx_discovery_decisions_generation
        ON discovery_decisions (generation_status);
    `,
    postgres: `
      ALTER TABLE discovery_decisions ADD COLUMN IF NOT EXISTS generated_json TEXT;
      ALTER TABLE discovery_decisions ADD COLUMN IF NOT EXISTS generation_status TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE discovery_decisions ADD COLUMN IF NOT EXISTS generation_failure TEXT;
      CREATE INDEX IF NOT EXISTS idx_discovery_decisions_generation
        ON discovery_decisions (generation_status);
    `
  },
  {
    id: '008_quality_gate',
    // Pre-publication quality gate over generated drafts. Every decision that
    // went through generation carries a gate verdict (passed/held/rejected)
    // and the full check report; gate failures flip the decision to held
    // (retry next run) or rejected (never publish weak content).
    sqlite: `
      ALTER TABLE discovery_decisions ADD COLUMN quality_json TEXT;
      ALTER TABLE discovery_decisions ADD COLUMN quality_status TEXT NOT NULL DEFAULT 'pending';
      CREATE INDEX IF NOT EXISTS idx_discovery_decisions_quality
        ON discovery_decisions (quality_status);
    `,
    postgres: `
      ALTER TABLE discovery_decisions ADD COLUMN IF NOT EXISTS quality_json TEXT;
      ALTER TABLE discovery_decisions ADD COLUMN IF NOT EXISTS quality_status TEXT NOT NULL DEFAULT 'pending';
      CREATE INDEX IF NOT EXISTS idx_discovery_decisions_quality
        ON discovery_decisions (quality_status);
    `
  },
  {
    id: '009_durable_jobs',
    // Durable autonomous orchestration.
    //   scheduled_jobs       one recurring job per agent; occurrences are
    //                        claimed with a DB-backed lease (lease_owner +
    //                        lease_expires_at), so duplicate deliveries and
    //                        crashed workers can never process the same
    //                        occurrence twice. idempotency_key is stamped at
    //                        claim time and identifies the occurrence across
    //                        duplicate deliveries. attempts/max_attempts/
    //                        backoff_ms give bounded exponential backoff for
    //                        transient failures; exhausting attempts records a
    //                        terminal failure and the recurring cadence
    //                        continues.
    //   posts.idempotency_key  delivery guard: UNIQUE(agent_id, idempotency_key)
    //                        means a re-delivered occurrence can never publish
    //                        the same decision twice.
    //   discovery_decisions.published_post_id  global publication marker; a
    //                        decision publishes at most once across agents.
    sqlite: `
      CREATE TABLE scheduled_jobs (
        id               TEXT PRIMARY KEY,
        agent_id         TEXT NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
        job_type         TEXT NOT NULL DEFAULT 'agent_cycle',
        status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','terminal')),
        schedule_ms      INTEGER NOT NULL,
        next_run_at      INTEGER NOT NULL,
        lease_owner      TEXT,
        lease_expires_at INTEGER,
        attempts         INTEGER NOT NULL DEFAULT 0,
        max_attempts     INTEGER NOT NULL DEFAULT 5,
        backoff_ms       INTEGER NOT NULL DEFAULT 1000,
        idempotency_key  TEXT,
        last_run_at      INTEGER,
        last_error       TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_due ON scheduled_jobs (status, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_lease ON scheduled_jobs (lease_expires_at);

      ALTER TABLE posts ADD COLUMN idempotency_key TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_idempotency
        ON posts (agent_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

      ALTER TABLE discovery_decisions ADD COLUMN published_post_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_discovery_decisions_published
        ON discovery_decisions (published_post_id);
    `,
    postgres: `
      CREATE TABLE scheduled_jobs (
        id               TEXT PRIMARY KEY,
        agent_id         TEXT NOT NULL UNIQUE REFERENCES agents(id) ON DELETE CASCADE,
        job_type         TEXT NOT NULL DEFAULT 'agent_cycle',
        status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','terminal')),
        schedule_ms      BIGINT NOT NULL,
        next_run_at      BIGINT NOT NULL,
        lease_owner      TEXT,
        lease_expires_at BIGINT,
        attempts         INTEGER NOT NULL DEFAULT 0,
        max_attempts     INTEGER NOT NULL DEFAULT 5,
        backoff_ms       BIGINT NOT NULL DEFAULT 1000,
        idempotency_key  TEXT,
        last_run_at      BIGINT,
        last_error       TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_due ON scheduled_jobs (status, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_lease ON scheduled_jobs (lease_expires_at);

      ALTER TABLE posts ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_posts_idempotency
        ON posts (agent_id, idempotency_key) WHERE idempotency_key IS NOT NULL;

      ALTER TABLE discovery_decisions ADD COLUMN IF NOT EXISTS published_post_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_discovery_decisions_published
        ON discovery_decisions (published_post_id);
    `
  },
  {
    id: '010_per_agent_discovery_decisions',
    // Per-agent editorial pipeline. discovery_candidates/fetches stay GLOBAL
    // (fetch once, canonical-URL dedup across all agents); each agent's cycle
    // fans out the same normalized candidates into its OWN decisions, keyed by
    // (agent_id, candidate_id) so one agent can never see or publish another
    // agent's verdict.
    //
    // agent_id is nullable ONLY to carry pre-scoping rows (not attributable to
    // any agent); scoped queries filter agent_id = ?, so legacy rows are
    // invisible and the code always writes a real id.
    sqlite: `
      ALTER TABLE discovery_decisions RENAME TO discovery_decisions_old;

      CREATE TABLE discovery_decisions (
        id                  TEXT PRIMARY KEY,
        agent_id            TEXT REFERENCES agents(id) ON DELETE CASCADE,
        candidate_id        TEXT NOT NULL REFERENCES discovery_candidates(id) ON DELETE CASCADE,
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
        decided_at          TEXT NOT NULL,
        generated_json      TEXT,
        generation_status   TEXT NOT NULL DEFAULT 'none',
        generation_failure  TEXT,
        quality_json        TEXT,
        quality_status      TEXT NOT NULL DEFAULT 'pending',
        published_post_id   TEXT,
        UNIQUE (agent_id, candidate_id)
      );
      CREATE INDEX IF NOT EXISTS idx_discovery_decisions_decided
        ON discovery_decisions (decided_at DESC);
      CREATE INDEX IF NOT EXISTS idx_discovery_decisions_decision
        ON discovery_decisions (decision);
      CREATE INDEX IF NOT EXISTS idx_discovery_decisions_generation
        ON discovery_decisions (generation_status);
      CREATE INDEX IF NOT EXISTS idx_discovery_decisions_quality
        ON discovery_decisions (quality_status);
      CREATE INDEX IF NOT EXISTS idx_discovery_decisions_published
        ON discovery_decisions (published_post_id);
      CREATE INDEX IF NOT EXISTS idx_discovery_decisions_agent_decision
        ON discovery_decisions (agent_id, decision);

      -- Carry pre-scoping rows with NULL agent_id (invisible to every agent).
      INSERT INTO discovery_decisions
        (id, agent_id, candidate_id, decision, total_score, persona_relevance,
         technical_impact, source_quality, recency, novelty, discussion_value,
         evidence_confidence, explanation, decided_at, generated_json,
         generation_status, generation_failure, quality_json, quality_status,
         published_post_id)
      SELECT id, NULL, candidate_id, decision, total_score, persona_relevance,
             technical_impact, source_quality, recency, novelty, discussion_value,
             evidence_confidence, explanation, decided_at, generated_json,
             generation_status, generation_failure, quality_json, quality_status,
             published_post_id
      FROM discovery_decisions_old;

      DROP TABLE discovery_decisions_old;
    `,
    postgres: `
      ALTER TABLE discovery_decisions ADD COLUMN IF NOT EXISTS agent_id TEXT
        REFERENCES agents(id) ON DELETE CASCADE;
      ALTER TABLE discovery_decisions DROP CONSTRAINT IF EXISTS discovery_decisions_candidate_id_key;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_discovery_decisions_agent_candidate
        ON discovery_decisions (agent_id, candidate_id);
      CREATE INDEX IF NOT EXISTS idx_discovery_decisions_agent_decision
        ON discovery_decisions (agent_id, decision);
    `
  }
];
