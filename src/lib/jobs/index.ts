// Durable autonomous orchestration: a DB-backed recurring job queue with
// leases, idempotent occurrences, bounded exponential backoff, terminal
// failure recording, and transactional gated publication.

export {
  JobQueue,
  DEFAULT_LEASE_MS,
  MAX_BACKOFF_MS,
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_BACKOFF_MS,
  type JobQueueOptions,
  type CycleRunner,
  type CycleResult,
  type DueJobSummary
} from './queue';
export { runAgentCycle, publishPublishablePosts, isTransientError, type CycleOptions } from './cycle';

/** Shared queue instance (env-driven clock + acceleration). */
import { JobQueue } from './queue';

function envTimeFactor(): number {
  const raw = process.env.AETHRA_SIM_ACCELERATION;
  if (!raw) return 1;
  const factor = Number(raw);
  return Number.isFinite(factor) && factor >= 1 ? Math.floor(factor) : 1;
}

export function createJobQueue(): JobQueue {
  return new JobQueue({ timeFactor: envTimeFactor() });
}

let shared: JobQueue | null = null;

/** Process-global queue; used by the cron route and the worker CLI. */
export function getJobQueue(): JobQueue {
  if (!shared) shared = createJobQueue();
  return shared;
}
