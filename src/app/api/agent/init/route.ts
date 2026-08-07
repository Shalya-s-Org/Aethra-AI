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
      agentId: `agent-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      status: "initialized",
      message: `${name} has been successfully activated as the autonomous systems analyst. Heuristic engine online.`,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    return NextResponse.json({ error: "Failed to parse initialization request." }, { status: 400 });
  }
}

