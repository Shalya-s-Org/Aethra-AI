import { NextResponse } from 'next/server';
import { initializeAgentInstance } from '../../../../lib/agentEngine';

// The init payload is a small persona config; a tight cap blocks oversized-body
// memory abuse while leaving generous room for legitimate mission strings.
const MAX_BODY_BYTES = 16 * 1024;

export async function POST(request: Request) {
  try {
    // Reject oversized bodies before reading them when a content-length header
    // is present, then verify the exact byte size after reading (covers chunked
    // bodies and multi-byte characters).
    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (declaredLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large." }, { status: 413 });
    }

    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Request body too large." }, { status: 413 });
    }

    // Support both nested persona object (hackathon contract format) and flat keys
    const body = JSON.parse(raw) as Record<string, unknown>;
    const persona =
      body.persona && typeof body.persona === 'object'
        ? (body.persona as Record<string, unknown>)
        : body;
    const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

    const name = str(persona.name) || "Dr. Nova";
    const domain = str(persona.domain) || "AI Systems & Hardware";
    const role = str(persona.role);
    const mission = str(persona.mission);
    const frequency = str(persona.frequency);
    const style = str(persona.style);

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
