import { flushDueAgents } from './agentEngine';

// Durable job/scheduler abstraction.
//
// A "job" is a due agent pipeline run, persisted in SQLite (`next_run_at`
// column). `flushDueAgents()` advances every due agent to the wall clock —
// it is idempotent, crash-safe, and safe to call from multiple triggers.
//
// Two implementations of the same contract:
//  - LazyScheduler (production default): no background process at all. Work
//    runs synchronously inside the state route, so it is safe on serverless /
//    multi-instance deployments where timers are unreliable.
//  - IntervalScheduler (local-development fallback): a plain setInterval that
//    calls the same durable flush, so the simulation advances even with no
//    browser client polling. Dev-only by default; it can be force-enabled for
//    a single-instance deployment with AETHRA_SCHEDULER=interval.
//
// Selection: AETHRA_SCHEDULER=lazy|interval overrides the default, which is
// `interval` in development and `lazy` everywhere else (including `next build`).

export type SchedulerMode = 'lazy' | 'interval';

export interface Scheduler {
  readonly mode: SchedulerMode;
  /** Run all due jobs now. Route-triggered in lazy mode; also the interval tick. */
  flushDue(now?: number): number;
  start(): void;
  stop(): void;
}

class LazyScheduler implements Scheduler {
  readonly mode: SchedulerMode = 'lazy';

  flushDue(now?: number): number {
    // Work happens inline, synchronously, on the calling request — the
    // deployment-safe mode (see /api/agent/state).
    return flushDueAgents(now);
  }

  start(): void {
    // No-op: state reads are the trigger.
  }

  stop(): void {
    // No-op.
  }
}

class IntervalScheduler implements Scheduler {
  readonly mode: SchedulerMode = 'interval';
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly intervalMs: number;

  constructor(intervalMs: number = 1000) {
    this.intervalMs = intervalMs;
  }

  flushDue(now?: number): number {
    return flushDueAgents(now);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.flushDue();
      } catch {
        // Never let a scheduler tick take the process down; the next tick
        // (or the next route-triggered flush) retries.
      }
    }, this.intervalMs);
    // Don't keep a script/process alive just for the dev fallback.
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

let scheduler: Scheduler | null = null;

export function getScheduler(): Scheduler {
  if (scheduler) return scheduler;
  const env = process.env.AETHRA_SCHEDULER;
  const mode: SchedulerMode =
    env === 'lazy' || env === 'interval'
      ? env
      : process.env.NODE_ENV === 'development'
        ? 'interval'
        : 'lazy';
  scheduler = mode === 'interval' ? new IntervalScheduler() : new LazyScheduler();
  return scheduler;
}

// Start the selected scheduler at module load. In production this is the
// lazy no-op; in development it spawns the interval fallback.
getScheduler().start();
