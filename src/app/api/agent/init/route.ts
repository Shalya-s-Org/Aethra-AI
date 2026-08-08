import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Support both nested persona object (hackathon contract format) and flat keys
    const name = body.persona?.name || body.name || "Dr. Nova";

    // Generate compliant agentId ending with timestamp for serverless state recovery.
    // getPostsForAgent() parses the final dash-separated segment as the init
    // timestamp, so it MUST be a pure number — the previous trailing random suffix
    // broke that contract and silently fell back to "1 hour ago".
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const agentId = `agent-${cleanName}-${Date.now()}`;

    return NextResponse.json({
      agentId,
      status: "initialized",
      message: `${name} has been successfully activated as the autonomous systems analyst. Heuristic engine online.`,
      timestamp: new Date().toISOString()
    });
  } catch {
    return NextResponse.json({ error: "Failed to parse initialization request." }, { status: 400 });
  }
}

