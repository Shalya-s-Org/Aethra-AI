import { NextResponse } from 'next/server';
import { getOrCreateAgentState } from '../../../../utils/agentEngine';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId');

  if (!agentId) {
    return NextResponse.json({ error: "Missing required query parameter: agentId" }, { status: 400 });
  }

  // Retrieve dynamic agent state from backend
  const agent = getOrCreateAgentState(agentId);

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
