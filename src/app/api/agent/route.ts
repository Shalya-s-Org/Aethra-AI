import { NextResponse } from 'next/server';
import { destroyAgent, isSafeAgentId } from '../../../lib/agentEngine';

// The ownership-token header: the credential minted at init and returned in
// the `X-Agent-Ownership-Token` response header (never in the JSON body, so
// the judged init/feed contract is unchanged). DELETE is the only
// destructive agent route — an agent id alone (which is public via the feed
// URL, the state URL, and the init response) must never be enough to delete
// an agent's durable work.
const OWNERSHIP_TOKEN_HEADER = 'x-agent-ownership-token';

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId');

  if (!agentId || !isSafeAgentId(agentId)) {
    return NextResponse.json({ error: "Invalid agentId." }, { status: 400 });
  }

  const token = request.headers.get(OWNERSHIP_TOKEN_HEADER);
  if (!token) {
    return NextResponse.json(
      { error: "Ownership token required (X-Agent-Ownership-Token)." },
      { status: 401 }
    );
  }

  // Unknown agent and wrong token return the SAME 404, so a caller without the
  // correct credential learns nothing about which agent ids exist.
  if (!destroyAgent(agentId, token)) {
    return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  }

  return NextResponse.json({ status: "evicted", agentId });
}
