import { NextResponse } from 'next/server';
import { getAgentState, isSafeAgentId } from '../../../../utils/agentEngine';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId');

  if (!agentId) {
    return NextResponse.json({ error: "Missing required query parameter: agentId" }, { status: 400 });
  }
  if (!isSafeAgentId(agentId)) {
    return NextResponse.json({ error: "Invalid agentId." }, { status: 400 });
  }

  // Retrieve dynamic agent state from backend; unknown ids are absent, not fabricated
  const agent = getAgentState(agentId);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  }

  // Return formatted posts (reverse chronological: newest first)
  const sortedPosts = [...agent.posts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // Return compliant payload structure
  const formattedPosts = sortedPosts.map(p => ({
    id: p.id,
    createdAt: p.createdAt,
    text: `${p.title}\n\n${p.text}\n\nAssessment: ${p.opinion}`,
    rationale: p.rationale,
    sources: p.sources
  }));

  return NextResponse.json({ posts: formattedPosts });
}
