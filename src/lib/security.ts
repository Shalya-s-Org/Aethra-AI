// Security primitives shared by the API routes: timing-safe comparison for
// bearer credentials (cron secret, agent ownership tokens) and secret
// redaction for anything that reaches logs or persisted error fields.

import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time string comparison. Both inputs are hashed first (sha256) so
 * the comparison never leaks length differences and works on arbitrary-length
 * strings; timingSafeEqual then compares the fixed 32-byte digests. A missing
 * or empty candidate never matches.
 */
export function timingSafeEqualString(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const da = createHash('sha256').update(a, 'utf8').digest();
  const db = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(da, db);
}

// Patterns whose VALUES must never reach logs or persisted error fields.
// Ordered most-specific first so a key inside a header is fully scrubbed:
//   "authorization: Bearer sk-test" → "authorization: [REDACTED]"
// (the Bearer pattern runs before the header pattern and consumes the key).
const SECRET_PATTERNS: Array<{ re: RegExp; group: number }> = [
  // OpenAI-style keys: sk-... (and similar sk_/sk. forms)
  { re: /\bsk[-_.][A-Za-z0-9_-]{8,}/g, group: 0 },
  // Bearer tokens in header dumps / error echoes
  { re: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, group: 0 },
  // Authorization header labels with their values (greedy to line end)
  { re: /(["']?authorization["']?\s*[:=]\s*["']?)[^"'\n,;]+/gi, group: 1 },
  // api_key / apikey / api-key assignments (greedy to line end)
  { re: /(\bapi[_-]?key["']?\s*[:=]\s*["']?)[^"'\n,;]+/gi, group: 1 },
  // tokens / secrets / passwords assignments (greedy to line end)
  { re: /(\b(?:token|secret|password|passwd)["']?\s*[:=]\s*["']?)[^"'\n,;]+/gi, group: 1 },
  // AETHRA_* env assignments in echoed config
  { re: /\b(AETHRA_[A-Z_]+=)[^\s]+/g, group: 1 }
];

/**
 * Replace likely secret values with a fixed marker so error messages can be
 * logged or persisted safely. Safe to apply to arbitrary strings: only the
 * VALUE after a known secret-shaped prefix is scrubbed, never surrounding
 * prose.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const { re, group } of SECRET_PATTERNS) {
    out = out.replace(re, (match, prefix?: string) =>
      group === 0 ? '[REDACTED]' : `${prefix}[REDACTED]`
    );
  }
  return out;
}
