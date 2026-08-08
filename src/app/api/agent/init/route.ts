import { NextResponse } from 'next/server';
import { initializeAgentInstance } from '../../../../lib/agentEngine';
import { validateInitRequest } from '../../../../lib/initSchema';
import {
  claimInitKey,
  getInitResponse,
  releaseInitKey,
  storeInitResponse
} from '../../../../lib/db';

// The init payload is a small persona config; a tight cap blocks oversized-body
// memory abuse while leaving generous room for legitimate mission strings.
const MAX_BODY_BYTES = 16 * 1024;

// Idempotency keys are client-generated opaque tokens: conservative shape,
// 128 chars max (matches common server guidance).
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{1,128}$/;

// How long a concurrent claim may take before we give up waiting (two
// processes may race on the same Idempotency-Key; the loser polls for the
// winner's stored response).
const CONCURRENT_CLAIM_POLLS = 100;
const CONCURRENT_CLAIM_POLL_MS = 20;

function isJsonContentType(contentType: string | null): boolean {
  if (!contentType) return false;
  const mediaType = contentType.split(';')[0].trim().toLowerCase();
  return mediaType === 'application/json' || mediaType === 'text/json' || mediaType.endsWith('+json');
}

export async function POST(request: Request) {
  // 1. Content-type gate (415).
  if (!isJsonContentType(request.headers.get('content-type'))) {
    return NextResponse.json(
      { error: "Content-Type must be application/json." },
      { status: 415 }
    );
  }

  // 2. Body-size cap (413): reject on declared length first, then verify the
  // exact byte size after reading (covers chunked bodies / multi-byte chars).
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (declaredLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body too large." }, { status: 413 });
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request body too large." }, { status: 413 });
  }

  // 3. Strict JSON parsing (400).
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  // 4. Strict schema: exactly { persona: { name, domain, ...optional } }.
  const validation = validateInitRequest(body);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const persona = validation.persona;

  // 5. Idempotency: replay a stored response, or atomically claim the key.
  const idempotencyKey = request.headers.get('idempotency-key');
  if (idempotencyKey !== null) {
    if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
      return NextResponse.json(
        { error: "Invalid Idempotency-Key: 1-128 chars of [A-Za-z0-9_-]." },
        { status: 400 }
      );
    }

    const stored = getInitResponse(idempotencyKey);
    if (stored && stored.responseJson !== '') {
      // Replay the original response exactly (same body + status).
      return new NextResponse(stored.responseJson, {
        status: stored.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    if (!claimInitKey(idempotencyKey)) {
      // Another request (possibly another process) is initializing with this
      // key. Poll briefly for its stored response, then give up.
      for (let i = 0; i < CONCURRENT_CLAIM_POLLS; i++) {
        await new Promise(r => setTimeout(r, CONCURRENT_CLAIM_POLL_MS));
        const record = getInitResponse(idempotencyKey);
        if (record && record.responseJson !== '') {
          return new NextResponse(record.responseJson, {
            status: record.status,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }
      return NextResponse.json(
        { error: "Initialization already in progress for this Idempotency-Key; retry shortly." },
        { status: 409 }
      );
    }
  }

  // 6. Create the agent. All content rows persist atomically (see engine).
  try {
    const agent = initializeAgentInstance(persona.name, persona.domain, undefined, {
      role: persona.role,
      mission: persona.mission,
      frequency: persona.frequency,
      style: persona.style
    });

    const responseBody = {
      agentId: agent.agentId,
      status: 'initialized',
      message: `${persona.name} has been successfully activated as the autonomous systems analyst for domain: ${persona.domain}.`,
      timestamp: new Date().toISOString()
    };
    const responseJson = JSON.stringify(responseBody);

    if (idempotencyKey !== null) {
      storeInitResponse(idempotencyKey, agent.agentId, responseJson, 200);
    }
    return new NextResponse(responseJson, {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    // Free the claim so a retry with the same key can succeed.
    if (idempotencyKey !== null) releaseInitKey(idempotencyKey);
    console.error('Failed to initialize agent:', err);
    return NextResponse.json(
      { error: "Failed to initialize agent." },
      { status: 500 }
    );
  }
}
