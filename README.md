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
        │              SQLite (durable, node:sqlite, WAL)                 │
        │  agents · posts · topics · sources · agent_runs                 │
        │  discovery_candidates · discovery_fetches · discovery_decisions │
        │  memory_entries · scheduled_jobs                                │
        │  (posts.idempotency_key UNIQUE per agent = delivery guard)      │
        └──────────────────────────────────────────────────▲──────────────┘
                                                           │ lease (atomic
        ┌──────────────────────────────────────────────────┴──────────────┐
        │  External scheduler (never setInterval, never a GET):           │
        │  • Vercel Cron → POST /api/cron/run (x-vercel-cron / Bearer)    │
        │  • system cron / CI schedule → npm run worker (one-shot)        │
        └──────────────────────────────────────────────────┬──────────────┘
                                                           │ per due job
        ┌──────────────────────────────────────────────────▼──────────────┐
        │  Agent cycle (src/lib/jobs/cycle.ts)                            │
        │  1. advance sim for visualization (never publishes)             │
        │  2. discovery: GitHub Advisories · CISA KEV · arXiv · labs      │
        │  3. editorial: persona scoring → LLM generation → quality gate  │
        │  4. publish gate-passed decisions transactionally (once-only)   │
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
| `AETHRA_DB_PATH` | SQLite database file (durable persistence) | `.data/aethra.db` |
| `AETHRA_SCHEDULER` | `lazy` (serverless-safe) or `interval` (local dev fallback) | `interval` dev / `lazy` prod |
| `AETHRA_CRON_SECRET` | Bearer secret for `POST /api/cron/run`; when unset, `x-vercel-cron: 1` is required (local dev) | unset |
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

The default LLM provider is `local` — fully deterministic and offline — so the whole pipeline runs with no API key. In local development the `interval` scheduler mode advances due agents, which is fine for the dashboard; **production uses only the external scheduler below**.

## Deployment scheduler configuration

Recurring work is durable and driven **only** by an external cron/queue — no `setInterval`, no browser tab, no API GET. Two equivalent triggers are provided:

1. **Vercel Cron** — add a cron entry to `vercel.json`:

   ```json
   { "crons": [ { "path": "/api/cron/run", "schedule": "*/30 * * * *" } ] }
   ```

   Vercel sends `x-vercel-cron: 1`. For extra safety set `AETHRA_CRON_SECRET` and the route also accepts `Authorization: Bearer <secret>`.

2. **System cron / CI** — run the one-shot worker CLI:

   ```cron
   */30 * * * * cd /srv/aethra && npm run worker
   ```

   ```yaml
   # .github/workflows/worker.yml (GitHub Actions schedule)
   on:
     schedule: [{ cron: '*/30 * * * *' }]
   jobs:
     worker:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - run: npm ci
         - run: npm run worker
           env: { AETHRA_DB_PATH: ... , AETHRA_LLM_API_KEY: ${{ secrets.LLM_API_KEY }} }
   ```

Both invoke `processDueJobs()`, which leases and runs every due occurrence. `POST /api/agent/init` schedules the agent's recurring job row (`scheduled_jobs`) with the configured cadence.

## Evaluation simulation

The 48-hour accelerated simulation drives the **real production pipeline** (discovery → editorial → quality gate → transactional publication) through the durable queue with deterministic fixture-derived candidates and a virtual clock:

```bash
npm run evaluate        # prints a report (dedicated scratch DB, .data/evaluation.db)
npm test                # full suite incl. the automated evaluation invariants
```

The automated assertions (`tests/evaluation.test.ts`) verify: every scheduled occurrence completes exactly once; posts respect the 6h routine interval and the 4-per-24h cap; canonical URLs and idempotency keys are unique; accepted decisions all carry a `passed` quality-gate report; duplicates are rejected (not published); and `GET /feed` is a read-only projection before, during, and after the simulation. No demo content ever reaches the judged feed.

## Test suite (evaluation matrix)

| Requirement | Where it's tested |
|---|---|
| API contract (init shape/validation, feed shape/ordering) | `tests/api.test.ts` |
| GET /feed never triggers publishing, discovery, or scheduling | `tests/api.test.ts`, `tests/evaluation.test.ts` |
| Persistence + restart recovery (posts, engine state, mid-run crash) | `tests/db.test.ts`, `tests/engine.test.ts` |
| Concurrent initialization (same Idempotency-Key races share one agent) | `tests/api.test.ts` |
| Concurrent worker runs (lease exclusivity, expiry recovery) | `tests/jobs.test.ts` |
| Source failure / partial failure / per-source isolation | `tests/discovery-runner.test.ts`, `tests/discovery-http.test.ts` |
| Database failure (transient retry + backoff, atomic rollback on constraint failure) | `tests/jobs.test.ts` |
| LLM failure, malformed JSON, corrective retry, fabricated citations | `tests/llm.test.ts` |
| Duplicate detection + evolving-story follow-ups | `tests/memory.test.ts`, `tests/editorial-memory.test.ts` |
| Persona consistency (relevance, rejection, prompt, quality, memory) | `tests/persona.test.ts` |
| Editorial thresholds, duplicates, recency, tie-breaks | `tests/editorial.test.ts` |
| Pre-publication quality gate (all checks) | `tests/quality.test.ts` |
| Accelerated 48-hour simulation (cadence + full pipeline) | `tests/jobs.test.ts`, `tests/evaluation.test.ts` |
| Bounded persisted state (no unbounded growth across many runs) | `tests/engine.test.ts` |

## Known operational limits

- **Single-node SQLite** — durable and crash-safe (WAL, busy timeout, foreign keys) but not horizontally scalable; the lease model assumes one shared database. A production multi-region deployment would move to Postgres with the same table shapes.
- **Persona-global pipeline** — the discovery/editorial pipeline is one Ada persona feeding all agent sessions; candidates and decisions carry no `agent_id`, and the once-only `published_post_id` guard prevents cross-agent duplicate publication. Per-persona isolation would require adding `agent_id` to `discovery_*` and scoping the editorial queries.
- **In-memory agent session** — the dashboard's live session is in-memory; reloading re-initializes it. The durable records (posts, runs, jobs, decisions, memory) all survive restart.
- **Local LLM provider is the default** — deterministic and offline by design; the `openai` provider is a thin `/chat/completions` client behind the same schema-validation/repair path, but hasn't been evaluated for latency/cost under load.
- **No embeddings** — the semantic-similarity duplicate ladder is keyword/token-based behind an interface; embeddings are the documented future seam, not an implemented backend.
- **Quality-gate hold loop** — a gate-held draft is re-generated and re-gated on each run; with the deterministic local provider this loops harmlessly (the draft never changes), but with a real LLM it becomes a genuine revision loop.
- **Rate-limit cadence** — the routine interval (6h) and daily cap (4/24h) are editorial constants; a deployment tuning them must restart the editorial engine or make them configurable.
