import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Support both nested persona object (hackathon contract format) and flat keys
    const name = body.persona?.name || body.name || "Dr. Nova";
    const domain = body.persona?.domain || body.domain || "AI Systems";

    // Generate compliant agentId ending with timestamp for serverless state recovery
    const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const agentId = `agent-${cleanName}-${Date.now()}`;

    return NextResponse.json({
      agentId
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to parse initialization request." }, { status: 400 });
  }
}

