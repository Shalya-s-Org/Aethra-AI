// Durable autonomous job queue.
//
// One recurring `scheduled_jobs` row per agent. An external cron/queue (Vercel
// Cron POST /api/cron/run, a system cron, or a CI schedule invoking the
// one-shot `npm run worker`) calls processDueJobs(); nothing here uses
// setInterval/setTimeout and no API GET ever triggers work.
//
// Safety properties:
//   - Lease: each occurrence is claimed atomically (the guard lives in the
//     UPDATE's WHERE clause, bound to the occurrence's next_run_at), so only
//     one worker wins under concurrent claims or duplicate delivery. Crashed
//     workers' leases expire and the occurrence is reclaimed — restart
//     recovery.
//   - Idempotency: the occurrence's idempotency key is derived from
//     (jobId, next_run_at) and stamped at claim time; it stays stable across
//     duplicate deliveries of the same occurrence, so a re-delivered
//     occurrence can never publish twice (posts carry the key under a
//     UNIQUE(agent_id, idempotency_key) index).
//   - Backoff: transient cycle failures retry with bounded exponential
//     backoff; exhausting max_attempts records a terminal failure and the
//     recurring cadence continues with a fresh occurrence.
//   - No publish-on-run: the cycle never publishes by itself — only the gated
//     editorial pipeline publishes, transactionally, per decision.
//
// The clock is injectable (`now`) and an acceleration factor (AETHRA_SIM_
// ACCELERATION) compresses schedule intervals for the 48-hour automated
// simulation mode; production behavior is unchanged when it is unset.

import {
  claimScheduledJob,
  getScheduledJobByAgent,
  getScheduledJobRow,
  listDueJobIdsSql,
  settleScheduledJob,
  upsertScheduledJob,
  type ScheduledJobRow
} from '../db';
import { ulid } from '../ids';

export const DEFAULT_LEASE_MS = 5 * 60_000;
export const MAX_BACKOFF_MS = 15 * 60_000;
export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_BACKOFF_MS = 1_000;

/** A cycle runs one agent's recurring work. Injectable for tests. */
export type CycleRunner = (agentId: string, now: number) => Promise<CycleResult>;

export interface CycleResult {
  ok: boolean;
  error?: string;
  /** Human-readable summary of what the cycle did. */
  summary?: string;
}

export interface JobQueueOptions {
  /** Lease owner id (worker host + pid). Default: process-unique ULID. */
  owner?: string;
  /** Injectable clock (virtual time for the accelerated simulation mode). */
  now?: () => number;
  /** Lease duration; expired leases are reclaimable (crash recovery). */
  leaseMs?: number;
  /** Max retries per occurrence before the failure is terminal. */
  maxAttempts?: number;
  /** Base backoff; each retry doubles it, capped at MAX_BACKOFF_MS. */
  backoffMs?: number;
  /** Schedule-interval acceleration factor (48h sim mode). */
  timeFactor?: number;
  /** What one occurrence does. Defaults to the real cycle (cycle.ts). */
  cycle?: CycleRunner;
}

export interface DueJobSummary {
  tickId: string;
  owner: string;
  startedAt: string;
  finishedAt: string;
  claimed: number;
  completed: number;
  retried: number;
  terminal: number;
  details: Array<{ agentId: string; ok: boolean; error?: string; summary?: string }>;
}

export class JobQueue {
  readonly owner: string;
  private readonly now: () => number;
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  private readonly timeFactor: number;
  private readonly cycle: CycleRunner;

  constructor(options: JobQueueOptions = {}) {
    this.owner = options.owner ?? `worker-${ulid()}`;
    this.now = options.now ?? (() => Date.now());
    this.leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
    this.maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.timeFactor = options.timeFactor ?? 1;
    this.cycle = options.cycle ?? defaultCycle;
  }

  /** Effective schedule interval after acceleration (1 = production). */
  effectiveScheduleMs(scheduleMs: number): number {
    return Math.max(1, Math.round(scheduleMs / this.timeFactor));
  }

  /** Register/refresh the agent's recurring job. Called by POST /api/agent/init. */
  scheduleAgent(agentId: string, scheduleMs: number, firstDelayMs = 0): string {
    const now = this.now();
    return upsertScheduledJob({
      agentId,
      scheduleMs: this.effectiveScheduleMs(scheduleMs),
      firstRunAtMs: now + firstDelayMs,
      maxAttempts: this.maxAttempts,
      backoffMs: this.backoffMs
    });
  }

  getJob(agentId: string): ScheduledJobRow | null {
    return getScheduledJobByAgent(agentId);
  }

  /**
   * One worker tick: claim every due occurrence and process it. Safe to run
   * from multiple workers and from duplicate cron deliveries — the lease +
   * idempotency guards make reprocessing harmless.
   */
  async processDueJobs(limit = 25): Promise<DueJobSummary> {
    const now = this.now();
    const tickId = ulid(now);
    const details: DueJobSummary['details'] = [];

    const jobIds = listDueJobIdsSql(now, limit);
    for (const jobId of jobIds) {
      const outcome = await this.processOne(jobId, now);
      details.push(outcome);
    }

    return {
      tickId,
      owner: this.owner,
      startedAt: new Date(now).toISOString(),
      finishedAt: new Date(this.now()).toISOString(),
      claimed: details.length,
      completed: details.filter(d => d.ok).length,
      retried: details.filter(d => !d.ok && !d.error?.startsWith('TERMINAL')).length,
      terminal: details.filter(d => d.error?.startsWith('TERMINAL')).length,
      details
    };
  }

  /** Claim + run one occurrence. */
  private async processOne(jobId: string, now: number): Promise<DueJobSummary['details'][number]> {
    const row = getScheduledJobRow(jobId);
    if (!row) return { agentId: jobId, ok: false, error: 'job-missing' };

    // The occurrence is (jobId, next_run_at); the idempotency key binds it and
    // is stable across duplicate deliveries. The claim is atomic on that exact
    // occurrence: if another worker settled it, next_run_at changed and this
    // claim fails.
    const idempotencyKey = `job:${jobId}:${row.nextRunAtMs}`;
    const claimed = claimScheduledJob(
      jobId,
      now,
      this.owner,
      now + this.leaseMs,
      idempotencyKey,
      row.nextRunAtMs
    );
    if (!claimed) {
      return { agentId: row.agentId, ok: false, error: 'claim-lost' };
    }

    try {
      const result = await this.cycle(row.agentId, now);
      if (result.ok) {
        settleScheduledJob(jobId, { ok: true, nextRunAtMs: now + row.scheduleMs }, now);
        return { agentId: row.agentId, ok: true, summary: result.summary };
      }
      return this.recordFailure(jobId, row, now, result.error ?? 'cycle failed');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return this.recordFailure(jobId, row, now, message);
    }
  }

  /** Bounded exponential backoff, then terminal failure at max attempts. */
  private recordFailure(
    jobId: string,
    row: ScheduledJobRow,
    now: number,
    error: string
  ): DueJobSummary['details'][number] {
    const nextAttempt = row.attempts + 1;
    if (nextAttempt >= (row.maxAttempts || this.maxAttempts)) {
      // Terminal: record the failure, keep the recurring cadence, reset
      // attempts so the next occurrence starts fresh.
      settleScheduledJob(
        jobId,
        { ok: false, nextRunAtMs: now + row.scheduleMs, terminal: true, error: `TERMINAL: ${error}` },
        now
      );
      return { agentId: row.agentId, ok: false, error: `TERMINAL: ${error}` };
    }
    const backoff = Math.min(this.backoffMs * 2 ** (nextAttempt - 1), MAX_BACKOFF_MS);
    settleScheduledJob(jobId, { ok: false, nextRunAtMs: now + backoff, error }, now);
    return { agentId: row.agentId, ok: false, error };
  }
}

/** The real cycle: discovery → editorial → gated publication. */
async function defaultCycle(agentId: string, now: number): Promise<CycleResult> {
  const { runAgentCycle } = await import('./cycle');
  return runAgentCycle(agentId, now);
}
