import { NextResponse } from 'next/server';
import { isSafeAgentId, peekAgentState } from '../../../../lib/agentEngine';
import { getPostsByAgent } from '../../../../lib/db';

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

  // READ-ONLY projection of the durable posts table: this route never advances
  // the pipeline, never writes, and never generates content. Unknown ids are
  // absent, never fabricated.
  if (!peekAgentState(agentId)) {
    return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  }

  // Reverse chronological (newest first) via idx_posts_agent_published.
  const posts = getPostsByAgent(agentId);

  // Comply with the API contract: id, createdAt (ISO UTC), text, rationale,
  // sources (canonical HTTPS URLs).
  const formattedPosts = posts.map(p => ({
    id: p.id,
    createdAt: p.createdAt,
    text: `${p.title}\n\n${p.body}\n\nAssessment: ${p.opinion}`,
    rationale: p.rationale,
    sources: p.sources
  }));

  return NextResponse.json({ posts: formattedPosts });
}
