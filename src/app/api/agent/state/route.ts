import { NextResponse } from 'next/server';
import { isSafeAgentId, peekAgentState } from '../../../../lib/agentEngine';
import { getScheduler } from '../../../../lib/scheduler';

// Always serve live state — never cached.
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId');

  if (!agentId) {
    return NextResponse.json({ error: "Missing required query parameter: agentId" }, { status: 400 });
  }
  if (!isSafeAgentId(agentId)) {
    return NextResponse.json({ error: "Invalid agentId." }, { status: 400 });
  }

  // The state read is the production scheduler trigger (lazy mode): it catches
  // up all due agents against the wall clock, then serves this agent's fresh
  // snapshot. Idempotent and crash-safe, so it is also safe when the dev
  // interval fallback runs concurrently.
  getScheduler().flushDue();

  // Pure read after the flush: unknown ids are absent, never fabricated.
  const agent = peekAgentState(agentId);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  }

  return NextResponse.json(agent);
}
