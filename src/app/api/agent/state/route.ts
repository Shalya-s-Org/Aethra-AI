import { NextResponse } from 'next/server';
import { getOrCreateAgentState, isSafeAgentId } from '../../../../utils/agentEngine';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId');

  if (!agentId) {
    return NextResponse.json({ error: "Missing required query parameter: agentId" }, { status: 400 });
  }
  if (!isSafeAgentId(agentId)) {
    return NextResponse.json({ error: "Invalid agentId." }, { status: 400 });
  }

  // Retrieve isolated agent state instance
  const agent = getOrCreateAgentState(agentId);

  return NextResponse.json(agent);
}
