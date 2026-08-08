import { NextResponse } from 'next/server';
import { isSafeAgentId, peekAgentState } from '../../../../lib/agentEngine';

// Always serve live feed data — never cached.
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

  // READ-ONLY projection. This route never advances the pipeline, never writes
  // to the store, and never generates content: it only returns posts that the
  // engine already materialized (the pipeline is driven by state reads and the
  // scheduler, never by this route). Unknown ids are absent, never fabricated.
  const agent = peekAgentState(agentId);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  }

  // Return formatted posts (reverse chronological: newest first)
  const sortedPosts = [...agent.posts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const formattedPosts = sortedPosts.map(p => ({
    id: p.id,
    createdAt: p.createdAt,
    text: `${p.title}\n\n${p.text}\n\nAssessment: ${p.opinion}`,
    rationale: p.rationale,
    sources: p.sources
  }));

  return NextResponse.json({ posts: formattedPosts });
}
