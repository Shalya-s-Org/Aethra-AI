// Release-readiness CLI — the final gate before the hackathon evaluation.
//
//   npm run release-check                      # local mode (accelerated 48h sim)
//   npm run release-check -- --mode=production # integration checks vs. a hosted deployment
//
// Runs every release gate and exits non-zero if ANY check fails (no scheduler
// configured, local/ephemeral persistence in production mode, or any judged
// API contract assertion). Writes a machine-readable JSON report to
// AETHRA_RELEASE_REPORT (default .data/release-report.json, gitignored) and
// prints a concise human report; `--json` prints the JSON report instead.
//
// Local mode is fully offline: it uses its own scratch SQLite database under
// the OS temp dir, so dev/production data is never touched. It requires
// AETHRA_CRON_SECRET to be set (the committed systemd timer — the external
// scheduler — sends it as a Bearer token).

import fs from 'node:fs';
import path from 'node:path';

interface Args {
  mode: 'local' | 'production';
  json: boolean;
  reportPath: string;
}

function parseArgs(argv: string[]): Args {
  const args = { mode: (process.env.AETHRA_RELEASE_MODE ?? 'local') as Args['mode'], json: false, reportPath: process.env.AETHRA_RELEASE_REPORT ?? '' };
  for (const arg of argv) {
    if (arg === '--json') args.json = true;
    else if (arg.startsWith('--mode=')) {
      const value = arg.slice('--mode='.length);
      if (value !== 'local' && value !== 'production') {
        console.error(`Unknown mode "${value}" (expected "local" or "production").`);
        process.exit(2);
      }
      args.mode = value;
    } else if (arg.startsWith('--report=')) {
      args.reportPath = arg.slice('--report='.length);
    } else if (arg !== '--help' && arg !== '-h') {
      console.error(`Unknown argument "${arg}". Usage: release-check [--mode=local|production] [--json] [--report=<path>]`);
      process.exit(2);
    }
  }
  if (!args.reportPath) {
    args.reportPath = path.join(process.cwd(), '.data', 'release-report.json');
  }
  return args;
}

function printHumanReport(report: Awaited<ReturnType<typeof runLocal>>): void {
  const line = '─'.repeat(64);
  console.log(line);
  console.log(`AETHRA release-readiness check — ${report.mode} mode`);
  console.log(`  produced   ${report.producedAt}`);
  for (const [key, value] of Object.entries(report.environment)) {
    console.log(`  ${key.padEnd(11)} ${value}`);
  }
  console.log(line);
  for (const check of report.checks) {
    const icon = check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : '–';
    const detail = check.detail ? `  ${check.detail}` : '';
    console.log(`  ${icon} ${check.id}${detail}`);
  }
  console.log(line);
  if (report.mode === 'local' && report.meta) {
    const m = report.meta;
    console.log(
      `  simulation   ${m.occurrences} occurrences (${m.failedOccurrences} failed), ${m.posts} posts, ` +
        `decisions accepted=${m.accepted} held=${m.held} rejected=${m.rejected}`
    );
    console.log(line);
  }
  const failed = report.checks.filter(c => c.status === 'fail');
  if (failed.length === 0) {
    console.log(`RESULT: PASS (${report.checks.length}/${report.checks.length} checks)`);
  } else {
    console.log(`RESULT: FAIL (${report.checks.length - failed.length}/${report.checks.length} checks)`);
    for (const check of failed) {
      console.log(`  ✗ ${check.id}: ${check.detail ?? 'failed'}`);
    }
  }
}

async function runLocal(): Promise<import('../tests/release-check').ReleaseReport> {
  const { runLocalReleaseChecks } = await import('../tests/release-check');
  return runLocalReleaseChecks();
}

async function runProduction(): Promise<import('../tests/release-check').ReleaseReport> {
  const { runProductionReleaseChecks } = await import('../tests/release-check');
  return runProductionReleaseChecks();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const report = args.mode === 'production' ? await runProduction() : await runLocal();

  const json = JSON.stringify(report, null, 2);
  fs.mkdirSync(path.dirname(args.reportPath), { recursive: true });
  fs.writeFileSync(args.reportPath, json);

  if (args.json) {
    console.log(json);
  } else {
    printHumanReport(report);
    console.log(`\nMachine-readable report: ${args.reportPath}`);
  }
  process.exitCode = report.passed ? 0 : 1;
}

main().catch(err => {
  console.error('release-check failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
