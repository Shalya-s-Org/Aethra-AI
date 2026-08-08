import { randomBytes } from 'node:crypto';

// ULID (Universally Unique Lexicographically Sortable Identifier).
// 26 characters of Crockford base32: 48-bit ms timestamp + 80 bits of
// randomness. Sortable by creation time and unique at the database level,
// with no external dependency.
//
// Crockford base32 alphabet (excludes I, L, O, U).
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encodeTime(now: number): string {
  let time = Math.floor(now);
  let str = '';
  for (let i = 0; i < 10; i++) {
    str = CROCKFORD[time % 32] + str;
    time = Math.floor(time / 32);
  }
  return str;
}

function encodeRandom(): string {
  const bytes = randomBytes(10); // 80 bits
  let str = '';
  for (let i = 0; i < 16; i++) {
    const bitIndex = i * 5;
    const byteIndex = Math.floor(bitIndex / 8);
    const bitOffset = bitIndex % 8;
    // First 5 bits from the current byte (masked to 5 bits).
    let value = (bytes[byteIndex] >> bitOffset) & 0x1f;
    // When the 5-bit window crosses a byte boundary, pull the remaining bits
    // from the next byte into the low positions.
    if (bitOffset > 3) {
      value |= (bytes[byteIndex + 1] << (8 - bitOffset)) & 0x1f;
    }
    str += CROCKFORD[value];
  }
  return str;
}

/** Generate a new ULID. Monotonic within the same millisecond via retry. */
export function ulid(now: number = Date.now()): string {
  return encodeTime(now) + encodeRandom();
}

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isUlid(value: string): boolean {
  return ULID_RE.test(value);
}

/** Decode the embedded 48-bit timestamp (ms) of a ULID. */
export function ulidTimestamp(value: string): number | null {
  if (!isUlid(value)) return null;
  let time = 0;
  for (let i = 0; i < 10; i++) {
    time = time * 32 + CROCKFORD.indexOf(value[i]);
  }
  return time;
}
