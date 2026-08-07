import { NextResponse } from 'next/server';
import { initialPosts } from '../../../../data/mockTopics';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId');

  if (!agentId) {
    return NextResponse.json({ error: "Missing required query parameter: agentId" }, { status: 400 });
  }

  // Map our posts to match exactly the required fields in the hackathon contract:
  // id, createdAt, text, rationale, sources[]
  const posts = initialPosts.map(post => ({
    id: post.id,
    createdAt: post.createdAt,
    text: post.text,
    rationale: post.rationale,
    sources: post.sources
  }));

  return NextResponse.json({ posts });
}
