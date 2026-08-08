// One-shot durable worker: claims and processes every due scheduled job, then
// exits. Designed to be invoked by an EXTERNAL scheduler — a system cron line
// (`* * * * * cd <repo> && npm run worker`), a GitHub Actions scheduled
// workflow, or any cron service. It never loops, never uses setInterval, and
// exits when the tick is done, so it is safe under duplicate delivery (the
// DB-backed lease + idempotency guards make reprocessing harmless).

import { getJobQueue } from '../src/lib/jobs';

async function main() {
  const queue = getJobQueue();
  const startedAt = Date.now();
  const summary = await queue.processDueJobs();
  const elapsedMs = Date.now() - startedAt;

  console.log(
    `[worker:${summary.owner}] tick ${summary.tickId} in ${elapsedMs}ms — ` +
      `claimed=${summary.claimed} completed=${summary.completed} ` +
      `retried=${summary.retried} terminal=${summary.terminal}`
  );
  for (const detail of summary.details) {
    if (detail.ok) {
      console.log(`  ok   ${detail.agentId} — ${detail.summary ?? 'cycle complete'}`);
    } else if (detail.error !== 'claim-lost') {
      console.log(`  FAIL ${detail.agentId} — ${detail.error}`);
    }
  }
}

main().catch(err => {
  console.error('[worker] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
