import { NextResponse } from 'next/server';
import { destroyAgent, isSafeAgentId } from '../../../lib/agentEngine';

// Evict an agent durably so its scheduler job stops. Idempotent: evicting an
// agent that is already gone is a no-op success (the dev interval fallback
// simply finds no due work for it).
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId');

  if (!agentId || !isSafeAgentId(agentId)) {
    return NextResponse.json({ error: "Invalid agentId." }, { status: 400 });
  }

  destroyAgent(agentId);

  return NextResponse.json({ status: "evicted", agentId });
}
