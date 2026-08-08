import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ulid, isUlid, ulidTimestamp } from '../src/lib/ids';

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('ulid', () => {
  it('produces 26-char Crockford-base32 strings', () => {
    for (let i = 0; i < 100; i++) {
      const id = ulid();
      assert.match(id, ULID_RE);
      assert.equal(id.length, 26);
      assert.ok(isUlid(id));
    }
  });

  it('is unique across many generations', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 10_000; i++) ids.add(ulid());
    assert.equal(ids.size, 10_000);
  });

  it('encodes the timestamp so ids sort by creation time', () => {
    const t0 = 1_700_000_000_000;
    const earlier = ulid(t0);
    const later = ulid(t0 + 1000);
    assert.ok(earlier < later, `expected ${earlier} < ${later}`);
    assert.equal(ulidTimestamp(earlier), t0);
    assert.equal(ulidTimestamp(later), t0 + 1000);
  });

  it('validates format strictly', () => {
    assert.ok(!isUlid(''));
    assert.ok(!isUlid('not-a-ulid'));
    assert.ok(!isUlid(ulid().toLowerCase()));
    // Crockford alphabet excludes I, L, O, U
    assert.ok(!isUlid(`01ARZ3NDEKTSV4RRFFQ69G5${'I'}A`));
    assert.ok(!isUlid(ulid().slice(0, 25)));
    assert.equal(ulidTimestamp('bogus'), null);
  });
});
