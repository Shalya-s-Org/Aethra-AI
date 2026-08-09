// Evaluation harness CLI — run the 48-hour accelerated simulation and print a
// report of what the real pipeline produced.
//
//   npm run evaluate
//   AETHRA_DB_PATH=/tmp/eval.db npm run evaluate   # explicit DB (not cleared)
//
// By default it uses a dedicated scratch DB (.data/evaluation.db, gitignored)
// so the production feed and dev data are never touched. The simulation is
// deterministic (fixture-derived candidates, virtual clock, local LLM
// provider) — see tests/evaluation-harness.ts.

import fs from 'node:fs';
import path from 'node:path';

const HOUR = 3600_000;

async function main(): Promise<void> {
  const explicitDb = Boolean(process.env.AETHRA_DB_PATH);
  if (!explicitDb) {
    const dbPath = path.join(process.cwd(), '.data', 'evaluation.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(dbPath + suffix, { force: true });
      } catch {
        // locked by a previous run — continue
      }
    }
    process.env.AETHRA_DB_PATH = dbPath;
  }

  const { initializeAgentInstance } = await import('../src/lib/agentEngine');
  const { runEvaluationSim, TEMPLATES } = await import('../tests/evaluation-harness');
  const { getDb, getPostsByAgent, closeDb } = await import('../src/lib/db');

  const T0 = Date.now() - 48 * HOUR; // the 48h horizon ends "now"
  const agentId = initializeAgentInstance('Evaluation Agent', 'ai-security', undefined, {}, T0).agentId;

  const started = Date.now();
  const result = await runEvaluationSim({
    agentId,
    startMs: T0,
    scheduleMs: 6 * HOUR,
    horizonMs: 48 * HOUR
  });
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  const posts = getPostsByAgent(agentId);
  const counts = getDb()
    .prepare(`SELECT decision, COUNT(*) AS n FROM discovery_decisions GROUP BY decision`)
    .all() as Array<{ decision: string; n: number }>;
  const byKind = Object.fromEntries(counts.map(c => [c.decision, c.n]));
  const times = posts.map(p => Date.parse(p.createdAt)).sort((a, b) => a - b);
  const minGapH =
    times.length > 1 ? Math.min(...times.slice(1).map((t, i) => (t - times[i]) / HOUR)) : null;
  const capViolations = times.filter(t => times.filter(x => x > t - 24 * HOUR && x <= t).length > 4).length;

  const lines: string[] = [];
  lines.push(`48-hour accelerated evaluation — ${result.steps} scheduled occurrences in ${elapsed}s`);
  lines.push(`  agent:        ${agentId}`);
  lines.push(`  horizon:      48h sim-time, 6h production cadence, 6x acceleration (1h effective)`);
  lines.push(`  occurrences:  ${result.steps} (${result.summaries.filter(s => !s.ok).length} failed)`);
  lines.push('  candidates:   deterministic fixture-derived stream (8 per batch)');
  lines.push(`  decisions:    accepted=${byKind.accepted ?? 0} held=${byKind.held ?? 0} rejected=${byKind.rejected ?? 0}`);
  lines.push(`  posts:        ${posts.length} published (max ${TEMPLATES.length} templates)`);
  if (times.length > 0) {
    lines.push(`  spacing:      min gap ${minGapH?.toFixed(1) ?? 'n/a'}h (routine interval 6h) — cap violations: ${capViolations}`);
  }
  for (const p of posts.slice(0, 10)) {
    lines.push(`    • ${p.createdAt}  ${p.title.slice(0, 70)}  ${p.sources.join(', ')}`);
  }
  if (posts.length === 0) {
    lines.push('  ⚠ no posts published — the pipeline gate did not pass any draft');
  }
  console.log(lines.join('\n'));

  closeDb();
  if (posts.length === 0) process.exitCode = 1;
}

main().catch(err => {
  console.error('Evaluation failed:', err);
  process.exit(1);
});
