import { NextResponse } from 'next/server';
import { getJobQueue } from '../../../../lib/jobs';
import { redactSecrets, timingSafeEqualString } from '../../../../lib/security';

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
export const runtime = 'nodejs';

async function runCron(request: Request) {
  // Vercel Cron uses GET and sends CRON_SECRET as a Bearer token. Retain
  // AETHRA_CRON_SECRET for the existing Linux/systemd deployment.
  const secret = process.env.CRON_SECRET ?? process.env.AETHRA_CRON_SECRET;
  if (secret) {
    const auth = request.headers.get('authorization') ?? '';
    // Constant-time comparison: never reveal timing or length information
    // about the secret via a string equality check.
    const ok = timingSafeEqualString(auth.trim(), `Bearer ${secret}`);
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
    // Never echo raw error internals (which may embed URLs, credentials, or
    // fetched content) to the caller; the full detail is logged server-side.
    const message = err instanceof Error ? err.message : String(err);
    const detail = redactSecrets(message);
    console.error('Cron tick failed:', detail);
    return NextResponse.json({ error: 'Cron tick failed.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return runCron(request);
}

// GET is deliberately not a trigger: a scheduled run must never be started by
// a page load or a prefetch.
export async function GET(request: Request) {
  return runCron(request);
}
