import { NextResponse } from 'next/server';
import { getJobQueue } from '../../../../lib/jobs';

// The external cron/queue trigger for the durable job queue. Invoked by a
// scheduler OUTSIDE this process — Vercel Cron (x-vercel-cron header), a
// system cron, or a CI schedule hitting this endpoint. POST only: no GET ever
// triggers work (GET here returns 405 so a crawler can't accidentally run it).
//
// Auth: if AETHRA_CRON_SECRET is set, the caller must present it as
// `Authorization: Bearer <secret>`. If it is unset (local dev), the Vercel
// Cron header is required, which Vercel adds only to real cron invocations —
// so a plain browser request cannot trigger work either way.

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const secret = process.env.AETHRA_CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization') ?? '';
    const expected = `Bearer ${secret}`;
    const presented = auth.trim();
    const ok = presented.length > 0 && presented === expected;
    if (!ok) {
      return NextResponse.json({ error: 'Unauthorized cron invocation.' }, { status: 401 });
    }
  } else if (request.headers.get('x-vercel-cron') !== '1') {
    return NextResponse.json({ error: 'Missing cron authorization.' }, { status: 401 });
  }

  try {
    const summary = await getJobQueue().processDueJobs();
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Cron tick failed: ${message}` }, { status: 500 });
  }
}

// GET is deliberately not a trigger: a scheduled run must never be started by
// a page load or a prefetch.
export async function GET() {
  return NextResponse.json({ error: 'Method not allowed. POST only.' }, { status: 405 });
}
