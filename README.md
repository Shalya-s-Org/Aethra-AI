# Aethra AI

An autonomous AI-security editorial agent ("Ada") built for a 48-hour hackathon evaluation: it discovers security advisories from allowlisted sources, scores them against a structured persona, generates posts with a server-side LLM (schema-validated, evidence-bound), runs every draft through a pre-publication quality gate, and publishes only gate-passed posts — durably, transactionally, and never "just because a scheduled run occurred".

Everything the UI shows comes from real persisted data. The judged API contract is `POST /api/agent/init` + `GET /api/agent/feed?agentId=`; feed remains a pure read-only projection.

## Architecture

```
┌──────────────┐   POST /api/agent/init    ┌───────────────────────────────┐
│  Dashboard   │ ────────────────────────▶ │  Next.js route handlers       │
│  (browser)   │ ◀──────────────────────── │  /api/agent/init  (schedule)  │
└──────────────┘   GET /api/agent/state    │  /api/agent/feed  (read-only) │
    ▲                                     │  /api/agent/state (read-only)  │
    └────── real persisted collections ───┘  /api/cron/run   (secret-gated)│
                        │ reads/writes     └───────────────┬───────────────┘
                        ▼                                  │
        ┌──────────────────────────────────────────────────▼──────────────┐
        │  Storage drivers (src/lib/storage) — one schema, two backends:  │
        │  • SQLite (default, node:sqlite, WAL) — single always-on host   │
        │  • Postgres (DATABASE_URL) — shared, multi-instance/serverless  │
        │  agents · posts · topics · sources · agent_runs                 │
        │  discovery_candidates · discovery_fetches · discovery_decisions │
        │  memory_entries · scheduled_jobs                                │
        │  (posts.idempotency_key UNIQUE per agent = delivery guard)      │
        └──────────────────────────────────────────────────▲──────────────┘
                                                           │ lease (atomic
        ┌──────────────────────────────────────────────────┴──────────────┐
        │  External scheduler (never setInterval, never a GET):           │
        │  • systemd timer (deploy/) → POST /api/cron/run (Bearer)        │
        │  • cron line / CI schedule → npm run worker (one-shot)          │
        └──────────────────────────────────────────────────┬──────────────┘
                                                           │ per due job
        ┌──────────────────────────────────────────────────▼──────────────┐
        │  Agent cycle (src/lib/jobs/cycle.ts)                            │
        │  1. discovery: GitHub Advisories · CISA KEV · arXiv · labs      │
        │  2. editorial: persona scoring → LLM generation → quality gate  │
        │  3. publish gate-passed decisions transactionally (once-only)   │
        │  (the legacy sim stage machine never runs in production)        │
        └─────────────────────────────────────────────────────────────────┘
```

Safety properties of the orchestration layer (see `src/lib/jobs/queue.ts`):

- **Lease** — each occurrence is claimed atomically (`WHERE next_run_at = ?`), so concurrent workers / duplicate cron deliveries never double-process. Expired leases (crashed workers) are reclaimable.
- **Idempotency** — every occurrence stamps a stable key derived from `(job, next_run_at)`; posts carry it under `UNIQUE(agent_id, idempotency_key)` and each decision publishes at most once via a global `published_post_id` marker. Re-delivery is harmless.
- **Recovery** — restarts, timeouts, and duplicate delivery are safe by construction; transient failures retry with bounded exponential backoff (cap 15 min), and exhausting attempts records a **terminal failure** while the recurring cadence continues with a fresh occurrence.
- **No publish-on-run** — a scheduled occurrence publishes only what the gated editorial pipeline approved. An occurrence with no gate-passed decisions publishes nothing.

## API contract

`POST /api/agent/init`

```json
{ "persona": { "name": "Ada", "domain": "ai-security" } }
```

Optional advanced persona fields: `role`, `mission`, `frequency`, `style`. Responses are `{ agentId, status, message, timestamp }` with a stable opaque ULID `agentId`. Content-type must be `application/json` (415 otherwise), bodies are size-capped (413), unknown fields are rejected (400), and an `Idempotency-Key` header makes initialization concurrency-safe and replay-identical.

`GET /api/agent/feed?agentId=`

```json
{ "posts": [ { "id", "createdAt", "text", "rationale", "sources" } ] }
```

Reverse chronological, canonical HTTPS `sources` only, empty `{ "posts": [] }` for fresh agents, 400 for invalid ids, 404 for unknown ids. **Read-only**: it never generates content, never writes, and never schedules work.

## Required environment variables

Copy `.env.example` to `.env` and fill in local values. Secrets live only in environment variables — never in code or committed files.

| Variable | Purpose | Default |
|---|---|---|
| `AETHRA_STORAGE` | Storage driver: `sqlite` (default) or `postgres` (shared, multi-instance) | `sqlite` |
| `AETHRA_DB_PATH` | SQLite database file (durable persistence) | `.data/aethra.db` |
| `DATABASE_URL` | Postgres connection string — required when `AETHRA_STORAGE=postgres` | — |
| `AETHRA_CRON_SECRET` | Bearer secret for `POST /api/cron/run` — **required in production**; when unset, `x-vercel-cron: 1` is required (local dev) | unset |
| `AETHRA_LLM_PROVIDER` | `local` (deterministic, offline — the test provider) or `openai` | `local` |
| `AETHRA_LLM_API_KEY` | Required when provider ≠ `local` | — |
| `AETHRA_LLM_BASE_URL` / `AETHRA_LLM_MODEL` / `AETHRA_LLM_TIMEOUT_MS` | OpenAI-compatible endpoint overrides | OpenAI defaults |
| `AETHRA_ARXIV_QUERY` | arXiv query phrases | built-in default |
| `AETHRA_GITHUB_REPOS` | GitHub owner/repo allowlist for releases feeds | built-in default |
| `AETHRA_LAB_FEEDS` | AI-lab RSS/Atom allowlist (https only) | built-in default |
| `AETHRA_SIM_ACCELERATION` | Schedule-interval compression for the accelerated simulation mode (unset in production) | unset |

Only allowlisted sources are ever fetched, always server-side with timeouts, retries, bounded exponential backoff, and per-source error isolation; arbitrary retrieved content never triggers a fetch.

## Local setup

```bash
npm install
cp .env.example .env            # optional; defaults work out of the box
npm run dev                     # http://localhost:3000
```

The default LLM provider is `local` — fully deterministic and offline — so the whole pipeline runs with no API key. Local development uses only the external scheduler, exactly like production; to advance due agents manually:

```bash
npm run worker                                    # one-shot tick (no HTTP)
# or, through the same webhook production uses:
curl -X POST -H "x-vercel-cron: 1" http://localhost:3000/api/cron/run
```

## Deployment

Recurring work is durable and driven **only** by an external scheduler — no `setInterval`, no browser tab, no API GET. `POST /api/agent/init` writes the agent's recurring job row (`scheduled_jobs`); an external scheduler then invokes `POST /api/cron/run` (or the equivalent one-shot `npm run worker`) at the cadence, and each tick leases and runs every due occurrence.

**Deployment target.** The default deployment uses the app's durable SQLite database, which requires a persistent, writable filesystem — a single always-on Linux host (VM/VPS/container). Vercel serverless functions cannot host SQLite (read-only filesystem, ephemeral `/tmp`; see Known operational limits). For a shared, multi-instance or serverless deployment, set `AETHRA_STORAGE=postgres` with `DATABASE_URL`; the Postgres driver implements the same schema, transactions, unique constraints, and job leases (see `src/lib/storage`), though the synchronous DAO layer is still SQLite-only (documented in Known operational limits). A committed, deployment-ready systemd configuration ships in [`deploy/`](deploy/): `aethra-web.service` serves the app, and the `aethra-cron.timer` fires `aethra-cron.service` every 15 minutes, which invokes `POST /api/cron/run` **securely** — the secret from the environment file is sent as `Authorization: Bearer <secret>`, and the route rejects requests without it.

### Deploy steps (Linux host)

1. Copy the app to `/opt/aethra` and install:

   ```bash
   cd /opt/aethra && npm ci && npm run build
   ```

2. Create `/etc/aethra/aethra.env` (chmod 600) with the real secrets:

   ```bash
   AETHRA_DB_PATH=/opt/aethra/.data/aethra.db
   AETHRA_CRON_SECRET=$(openssl rand -hex 32)   # REQUIRED in production
   AETHRA_LLM_API_KEY=sk-...                    # only if AETHRA_LLM_PROVIDER != local
   ```

3. Install and start the units:

   ```bash
   sudo cp deploy/aethra-web.service deploy/aethra-cron.service deploy/aethra-cron.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now aethra-web.service aethra-cron.timer
   ```

   The timer fires every 15 minutes; the DB-backed lease makes late or duplicate deliveries harmless, and `Persistent=true` catches ticks missed while the host was down.

4. Verify autonomy:

   ```bash
   curl -X POST http://localhost:3000/api/agent/init \
     -H 'content-type: application/json' \
     -d '{"persona":{"name":"Ada","domain":"ai-security"}}'   # schedules the durable job
   curl http://localhost:3000/api/health
   # → { "status":"ok", "jobs":{"active":1,...}, "lastCronRunAt": ..., "nextDueAt": ... }
   ```

   `GET /api/health` is the health/status mechanism: `lastCronRunAt` is the last successful cron tick and `nextDueAt` is the next due job. `sudo systemctl status aethra-cron.service` shows the last tick's result and `journalctl -u aethra-cron.service` its output.

**Alternative triggers** (equivalent, in case systemd is unavailable): a cron line `*/15 * * * * cd /opt/aethra && AETHRA_CRON_SECRET=... curl -fsS -X POST -H "Authorization: Bearer $AETHRA_CRON_SECRET" http://127.0.0.1:3000/api/cron/run`, or the one-shot worker `*/15 * * * * cd /opt/aethra && npm run worker` (no HTTP). Both call the same `processDueJobs()`.

## Evaluation simulation

The 48-hour accelerated simulation drives the **real production pipeline** (discovery → editorial → quality gate → transactional publication) through the durable queue with deterministic fixture-derived candidates and a virtual clock:

```bash
npm run evaluate        # prints a report (dedicated scratch DB, .data/evaluation.db)
npm test                # full suite incl. the automated evaluation invariants
```

The automated assertions (`tests/evaluation.test.ts`) verify: every scheduled occurrence completes exactly once; posts respect the 6h routine interval and the 4-per-24h cap; canonical URLs and idempotency keys are unique; accepted decisions all carry a `passed` quality-gate report; duplicates are rejected (not published); and the judged feed is exactly the persisted posts, reverse-chronological (`GET /feed` never triggers publishing is asserted in `tests/api.test.ts`). No demo content ever reaches the judged feed.

## Test suite (evaluation matrix)

| Requirement | Where it's tested |
|---|---|
| API contract (init shape/validation, feed shape/ordering) | `tests/api.test.ts` |
| GET /feed never triggers publishing, discovery, or scheduling | `tests/api.test.ts` |
| Persistence + restart recovery (posts, engine state, mid-run crash) | `tests/db.test.ts`, `tests/engine.test.ts` |
| Concurrent initialization (same Idempotency-Key races share one agent) | `tests/api.test.ts` |
| Concurrent worker runs (lease exclusivity, expiry recovery) | `tests/jobs.test.ts` |
| Source failure / partial failure / per-source isolation | `tests/discovery-runner.test.ts`, `tests/discovery-http.test.ts` |
| Database failure (transient retry + backoff, atomic rollback on constraint failure) | `tests/jobs.test.ts` |
| LLM failure, malformed JSON, corrective retry, fabricated citations | `tests/llm.test.ts` |
| Duplicate detection + evolving-story follow-ups | `tests/memory.test.ts`, `tests/editorial-memory.test.ts` |
| Per-agent isolation (no cross-agent publication, decision theft, or memory leakage) | `tests/isolation.test.ts` |
| Persona consistency (relevance, rejection, prompt, quality, memory) | `tests/persona.test.ts` |
| Editorial thresholds, duplicates, recency, tie-breaks | `tests/editorial.test.ts` |
| Pre-publication quality gate (all checks) | `tests/quality.test.ts` |
| Accelerated 48-hour simulation (cadence + full pipeline) | `tests/jobs.test.ts`, `tests/evaluation.test.ts` |
| Bounded persisted state (no unbounded growth across many runs) | `tests/engine.test.ts` |
| Scheduler health (last cron run, next due) + cron webhook auth | `tests/health.test.ts` |
| Storage drivers (migrations, transactions, restart survival, lease claims; Postgres-gated) | `tests/storage.test.ts` |

## Known operational limits

- **SQLite is the DAO default; Postgres is the async-driver path** — the synchronous DAO layer (`src/lib/db.ts`) runs on the SQLite driver and fails fast if `AETHRA_STORAGE=postgres` is set (no silent split-brain). The Postgres driver implements the full `StorageDriver` interface — the same shared migration registry, transactions, unique constraints, and job leases — and is exercised by integration tests gated on `DATABASE_URL`, but the DAO has not yet been converted to the async interface, so an end-to-end Postgres deployment requires that conversion. Single-node SQLite is durable and crash-safe (WAL, busy timeout, foreign keys) but not horizontally scalable; the lease model assumes one shared database. The app therefore cannot run on Vercel serverless today (read-only filesystem, ephemeral `/tmp`) — the committed scheduler targets a single always-on Linux host.
- **Health is scheduler-scoped** — `GET /api/health` reports the last successful cron tick and the next due job from `scheduled_jobs`; there is no per-tick audit trail of *failed* runs (a degraded job surfaces via `jobs.degraded` and `last_error`, not a run history).
- **Per-agent editorial pipeline; shared discovery pool** — discovery fetches once per source into a global `discovery_candidates` pool (canonical-URL dedup), and each agent's cycle fans the pool out into its own `discovery_decisions` rows keyed by `(agent_id, candidate_id)`. Memory, rate limits, and dedup scope are per-agent; `markDecisionPublished` refuses to publish a decision the agent doesn't own, so no agent can publish another agent's decision. Agents with different domains resolve different personas from their own config.
- **In-memory agent session** — the dashboard's live session is in-memory; reloading re-initializes it. The durable records (posts, runs, jobs, decisions, memory) all survive restart.
- **Legacy sim engine is test-only** — the old stage-machine simulation (`advanceAgentById`/`advanceTo` in `src/lib/agentEngine.ts`) is never advanced in production: scheduled cycles run only the real discovery → editorial → publication pipeline, and the dashboard's activity readouts are derived from persisted records (`agent_runs`, posts, decisions, fetches, `memory_entries`). Seed **demo posts** are marked `is_demo` and excluded from the judged `GET /api/agent/feed`; no other fabricated content is seeded.
- **Local LLM provider is the default** — deterministic and offline by design; the `openai` provider is a thin `/chat/completions` client behind the same schema-validation/repair path, but hasn't been evaluated for latency/cost under load.
- **No embeddings** — the semantic-similarity duplicate ladder is keyword/token-based behind an interface; embeddings are the documented future seam, not an implemented backend.
- **Quality-gate hold loop** — a gate-held draft is re-generated and re-gated on each run; with the deterministic local provider this loops harmlessly (the draft never changes), but with a real LLM it becomes a genuine revision loop.
- **Rate-limit cadence** — the routine interval (6h) and daily cap (4/24h) are editorial constants; a deployment tuning them must restart the editorial engine or make them configurable.
