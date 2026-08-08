// Durable scheduler abstraction — now a thin, TIMER-FREE wrapper over the
// durable job queue (see src/lib/jobs). The agent's recurring work lives in
// the `scheduled_jobs` table; it is driven ONLY by an external scheduler
// (POST /api/cron/run for Vercel Cron / system cron, or the one-shot
// `npm run worker` CLI). There is deliberately no setInterval/setTimeout, no
// background worker process, and no API GET trigger: a scheduled run can never
// be started by a page load, a prefetch, or a stray timer.

import { getJobQueue, type DueJobSummary } from './jobs';

export interface Scheduler {
  /** Run all due jobs now. Cron/worker-triggered. Returns a durable summary. */
  flushDue(now?: number): DueJobSummary | Promise<DueJobSummary>;
  start(): void;
  stop(): void;
}

class DurableScheduler implements Scheduler {
  async flushDue(now?: number): Promise<DueJobSummary> {
    // The queue's clock is injectable; `now` here is advisory (used only to
    // keep the same call surface for tests that pass a virtual time).
    void now;
    return getJobQueue().processDueJobs();
  }

  start(): void {
    // No-op: the external cron/worker is the only trigger.
  }

  stop(): void {
    // No-op.
  }
}

let scheduler: Scheduler | null = null;

export function getScheduler(): Scheduler {
  if (!scheduler) scheduler = new DurableScheduler();
  return scheduler;
}

// Intentionally NOT started: there is no background loop anymore.
