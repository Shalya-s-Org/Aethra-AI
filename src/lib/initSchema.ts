// Strict schema validation for POST /api/agent/init.
//
// The contract accepts exactly:
//   { "persona": { "name": string, "domain": string,
//                  "role"?, "mission"?, "frequency"?, "style"? } }
// name and domain are required; the advanced persona fields are optional but
// validated when present. Unknown fields are rejected with a useful message so
// contract drift fails loudly instead of being silently ignored.

const PERSONA_FIELDS = ['name', 'domain', 'role', 'mission', 'frequency', 'style'] as const;

const MAX_LENGTHS: Record<string, number> = {
  name: 200,
  domain: 200,
  role: 200,
  mission: 4000,
  style: 500,
  frequency: 10
};

export interface ValidatedPersona {
  name: string;
  domain: string;
  role?: string;
  mission?: string;
  frequency?: string;
  style?: string;
}

export type InitValidation =
  | { ok: true; persona: ValidatedPersona }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateInitRequest(raw: unknown): InitValidation {
  if (!isPlainObject(raw)) {
    return { ok: false, error: 'Request body must be a JSON object like { "persona": { "name": "...", "domain": "..." } }.' };
  }

  const topKeys = Object.keys(raw);
  if (topKeys.length !== 1 || topKeys[0] !== 'persona') {
    return {
      ok: false,
      error: topKeys.includes('persona')
        ? `Unknown top-level field(s): ${topKeys.filter(k => k !== 'persona').join(', ')}. The request body must be exactly { "persona": { ... } }.`
        : 'Missing required field: persona. The request body must be { "persona": { "name": "...", "domain": "..." } }.'
    };
  }

  const persona = raw.persona;
  if (!isPlainObject(persona)) {
    return { ok: false, error: 'persona must be an object.' };
  }

  const unknownFields = Object.keys(persona).filter(k => !(PERSONA_FIELDS as readonly string[]).includes(k));
  if (unknownFields.length > 0) {
    return {
      ok: false,
      error: `Unknown persona field(s): ${unknownFields.join(', ')}. Allowed fields: ${PERSONA_FIELDS.join(', ')}.`
    };
  }

  const result: ValidatedPersona = { name: '', domain: '' };

  for (const field of ['name', 'domain'] as const) {
    const value = persona[field];
    if (!nonEmptyString(value)) {
      return { ok: false, error: `persona.${field} is required and must be a non-empty string.` };
    }
    if (value.trim().length > MAX_LENGTHS[field]) {
      return { ok: false, error: `persona.${field} must be at most ${MAX_LENGTHS[field]} characters.` };
    }
    result[field] = value.trim();
  }

  for (const field of ['role', 'mission', 'style'] as const) {
    const value = persona[field];
    if (value === undefined) continue;
    if (!nonEmptyString(value)) {
      return { ok: false, error: `persona.${field} must be a non-empty string when provided.` };
    }
    if (value.trim().length > MAX_LENGTHS[field]) {
      return { ok: false, error: `persona.${field} must be at most ${MAX_LENGTHS[field]} characters.` };
    }
    result[field] = value.trim();
  }

  if (persona.frequency !== undefined) {
    const value = persona.frequency;
    if (typeof value !== 'string' || !/^\d{1,4}$/.test(value.trim()) || Number(value) < 1) {
      return { ok: false, error: 'persona.frequency must be a positive integer string (minutes), e.g. "15".' };
    }
    result.frequency = value.trim();
  }

  return { ok: true, persona: result };
}
