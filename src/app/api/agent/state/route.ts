import { NextResponse } from 'next/server';
import { isSafeAgentId, peekAgentState } from '../../../../lib/agentEngine';

// Always serve live state — never cached.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// PURE READ: this route never advances the pipeline and never schedules work.
// Recurring work is driven only by the external cron (POST /api/cron/run) or
// the one-shot worker CLI — never by an API GET.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId');

  if (!agentId) {
    return NextResponse.json({ error: "Missing required query parameter: agentId" }, { status: 400 });
  }
  if (!isSafeAgentId(agentId)) {
    return NextResponse.json({ error: "Invalid agentId." }, { status: 400 });
  }

  // Pure read: unknown ids are absent, never fabricated.
  const agent = peekAgentState(agentId);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  }

  return NextResponse.json(agent);
}
