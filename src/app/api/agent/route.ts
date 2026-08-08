import { NextResponse } from 'next/server';
import { destroyAgent, isSafeAgentId } from '../../../utils/agentEngine';

// Evict an agent so its scheduler loop stops. Idempotent: evicting an agent
// that is already gone is a no-op success.
export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId');

  if (!agentId || !isSafeAgentId(agentId)) {
    return NextResponse.json({ error: "Invalid agentId." }, { status: 400 });
  }

  destroyAgent(agentId);

  return NextResponse.json({ status: "evicted", agentId });
}
