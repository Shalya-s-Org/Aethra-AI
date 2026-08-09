// Timing probe for the evaluation sim (deleted after measuring).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DB = path.join(os.tmpdir(), 'aethra-eval-probe.db');
for (const suffix of ['', '-wal', '-shm']) {
  try { fs.rmSync(DB + suffix, { force: true }); } catch { /* locked */ }
}
process.env.AETHRA_DB_PATH = DB;

import { initializeAgentInstance } from './src/lib/agentEngine';
import { JobQueue } from './src/lib/jobs/queue';
import { runAgentCycle } from './src/lib/jobs/cycle';
import { makeFixtureDiscovery } from './tests/evaluation-harness';
import { closeDb, getPostsByAgent } from './src/lib/db';

async function main(): Promise<void> {
  const HOUR = 3600_000;
  const T0 = 1_750_000_000_000;
  const agentId = initializeAgentInstance('Probe', 'ai-security', undefined, {}, T0).agentId;

  // Phase 1: how expensive is one full cycle (discovery + editorial + publish)?
  let now = T0;
  const queue = new JobQueue({
    now: () => now,
    timeFactor: 60,
    cycle: async (id, at) => runAgentCycle(id, at, { discovery: makeFixtureDiscovery({ startMs: T0, intervalMs: 30_000 }) })
  });
  queue.scheduleAgent(agentId, 30 * 60_000, 0);
  let t0 = Date.now();
  for (let i = 0; i < 60; i++) {
    now += 30_000;
    await queue.processDueJobs();
  }
  console.log(`60 full-pipeline steps: ${((Date.now() - t0) / 1000).toFixed(1)}s  (posts=${getPostsByAgent(agentId).length})`);

  // Phase 2: how expensive is a no-op step (advanceSim only, no new candidates)?
  now = T0 + 60 * 30_000;
  const queue2 = new JobQueue({
    now: () => now,
    timeFactor: 60,
    cycle: async (id, at) => runAgentCycle(id, at, { skipDiscovery: true })
  });
  queue2.scheduleAgent(agentId, 30 * 60_000, 0);
  t0 = Date.now();
  for (let i = 0; i < 200; i++) {
    now += 30_000;
    await queue2.processDueJobs();
  }
  console.log(`200 no-op steps: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  closeDb();
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.rmSync(DB + suffix, { force: true }); } catch { /* locked */ }
  }
}
main().catch(err => {
  console.error(err);
  process.exit(1);
});
