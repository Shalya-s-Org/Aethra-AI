import { NextResponse } from 'next/server';
import { initializeAgentInstance } from '../../../../utils/agentEngine';

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Support both nested persona object (hackathon contract format) and flat keys
    const name = body.persona?.name || body.name || "Dr. Nova";
    const domain = body.persona?.domain || body.domain || "AI Systems & Hardware";
    const role = body.persona?.role || body.role;
    const mission = body.persona?.mission || body.mission;
    const frequency = body.persona?.frequency || body.frequency;
    const style = body.persona?.style || body.style;

    // Initialize backend engine state instance with all custom configurations
    const agent = initializeAgentInstance(name, domain, undefined, { role, mission, frequency, style });

    return NextResponse.json({
      agentId: agent.agentId,
      status: "initialized",
      message: `${name} has been successfully activated as the autonomous systems analyst for domain: ${domain}.`,
      timestamp: new Date().toISOString()
    });
  } catch {
    return NextResponse.json({ error: "Failed to parse initialization request." }, { status: 400 });
  }
}
