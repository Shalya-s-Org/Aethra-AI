import { NextResponse } from 'next/server';
import { getSchedulerHealth } from '../../../lib/db';

// Always report live status — never cached.
export const dynamic = 'force-dynamic';

// Public, read-only health: never triggers work and never writes. Lets an
// operator (or an uptime monitor) confirm the external scheduler is healthy —
// last successful cron run and the next due job are derived from the durable
// scheduled_jobs table.
export async function GET() {
  try {
    const health = getSchedulerHealth();
    const cronSecret = process.env.AETHRA_CRON_SECRET;
    return NextResponse.json({
      status: 'ok',
      db: 'ok',
      serverTime: new Date().toISOString(),
      agents: health.agents,
      jobs: { active: health.activeJobs, degraded: health.degradedJobs },
      lastCronRunAt: health.lastRunAtMs == null ? null : new Date(health.lastRunAtMs).toISOString(),
      nextDueAt: health.nextDueAtMs == null ? null : new Date(health.nextDueAtMs).toISOString(),
      // How the scheduler authenticates: bearer secret in production, the
      // Vercel Cron header as the local-dev fallback.
      cron: { mode: cronSecret ? 'bearer' : 'vercel-header' }
    });
  } catch (err) {
    console.error('Health check failed:', err);
    return NextResponse.json({ status: 'error', db: 'error' }, { status: 503 });
  }
}
