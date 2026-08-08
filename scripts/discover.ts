// Manual discovery runner for development.
//
//   npm run discover              # all allowlisted sources
//   npm run discover -- arxiv     # only sources whose name contains "arxiv"
//
// This is the only place live network discovery is triggered by hand. It is
// deliberately separate from the agent pipeline and from GET /api/agent/feed:
// it writes discovery_candidates / discovery_fetches only.

import { ADAPTERS } from '../src/lib/discovery/adapters';
import { runDiscovery } from '../src/lib/discovery/runner';

async function main(): Promise<void> {
  const filters = process.argv
    .slice(2)
    .filter(a => !a.startsWith('-'))
    .map(s => s.toLowerCase());

  const matched =
    filters.length > 0
      ? ADAPTERS.filter(a => filters.some(f => a.name.toLowerCase().includes(f))).map(a => a.name)
      : undefined;

  if (filters.length > 0 && matched && matched.length === 0) {
    console.error(`No discovery source matches: ${filters.join(', ')}`);
    console.error(`Available sources: ${ADAPTERS.map(a => a.name).join(', ')}`);
    process.exit(1);
  }

  const started = Date.now();
  const summary = await runDiscovery({ sources: matched, now: started });

  const lines: string[] = [];
  lines.push(`Discovery run ${summary.runId}`);
  lines.push(`  started:  ${summary.startedAt}`);
  lines.push(`  finished: ${summary.finishedAt} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  lines.push(`  candidates: ${summary.totalCandidates} total, ${summary.newCandidates} new`);
  lines.push(
    `  fetches:  ${summary.fetches.length} (${summary.fetches.filter(f => f.status === 'success').length} ok, ${summary.fetches.filter(f => f.status === 'failure').length} failed)`
  );

  for (const f of summary.fetches) {
    lines.push(
      `    [${f.status}] ${f.sourceName} ${f.url}${f.itemCount != null ? ` → ${f.itemCount} item(s)` : ''}${f.error ? ` — ${f.error}` : ''}`
    );
  }

  if (summary.failures.length > 0) {
    lines.push(`  source failures (isolated, run continues): ${summary.failures.length}`);
    for (const failure of summary.failures) {
      lines.push(`    - ${failure.sourceName}: ${failure.error}`);
    }
  }

  for (const c of summary.candidates.slice(0, 25)) {
    lines.push(`  • ${c.publishedAt}  ${c.title}  (${c.sourceName}) ${c.canonicalUrl}`);
  }
  if (summary.candidates.length > 25) {
    lines.push(`  … and ${summary.candidates.length - 25} more`);
  }

  console.log(lines.join('\n'));

  if (summary.failures.length > 0) {
    process.exitCode = 1; // partial failure still prints the full output
  }
}

main().catch(err => {
  console.error('Discovery runner failed:', err);
  process.exit(1);
});
