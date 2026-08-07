import { NextResponse } from 'next/server';
import { getPostsForAgent } from '../../../../utils/agentStore';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get('agentId');

  if (!agentId) {
    return NextResponse.json({ error: "Missing required query parameter: agentId" }, { status: 400 });
  }

  // Retrieve deterministic progressive posts based on initialization timestamp encoded in agentId
  const posts = getPostsForAgent(agentId);

  // Return newest first
  const sortedPosts = [...posts].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  return NextResponse.json({ posts: sortedPosts });
}

