import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeSourceUrl } from '../src/lib/urls';

describe('canonicalizeSourceUrl', () => {
  it('upgrades scheme-less source strings to canonical HTTPS', () => {
    assert.equal(canonicalizeSourceUrl('arxiv.org/abs/2608.1092'), 'https://arxiv.org/abs/2608.1092');
    assert.equal(
      canonicalizeSourceUrl('github.com/sec-ai/vector-jailbreak'),
      'https://github.com/sec-ai/vector-jailbreak'
    );
  });

  it('lowercases the host and strips default ports', () => {
    assert.equal(
      canonicalizeSourceUrl('HTTPS://GitHub.com/Sec-AI/Vector-Jailbreak/'),
      'https://github.com/Sec-AI/Vector-Jailbreak'
    );
    assert.equal(canonicalizeSourceUrl('https://example.com:443/a'), 'https://example.com/a');
    assert.equal(canonicalizeSourceUrl('http://example.com:80/a'), 'https://example.com/a');
  });

  it('upgrades http:// to https://', () => {
    assert.equal(canonicalizeSourceUrl('http://example.com/a'), 'https://example.com/a');
  });

  it('strips query strings, hashes, and trailing slashes', () => {
    assert.equal(canonicalizeSourceUrl('https://example.com/a/?b=c#frag'), 'https://example.com/a');
    assert.equal(canonicalizeSourceUrl('https://example.com/'), 'https://example.com');
  });

  it('trims surrounding whitespace', () => {
    assert.equal(canonicalizeSourceUrl('  example.com/a  '), 'https://example.com/a');
  });

  it('rejects non-http schemes, garbage, and empties', () => {
    assert.equal(canonicalizeSourceUrl('ftp://example.com/a'), null);
    assert.equal(canonicalizeSourceUrl('javascript:alert(1)'), null);
    assert.equal(canonicalizeSourceUrl('file:///etc/passwd'), null);
    assert.equal(canonicalizeSourceUrl(''), null);
    assert.equal(canonicalizeSourceUrl('   '), null);
    assert.equal(canonicalizeSourceUrl('not a url at all'), null);
    assert.equal(canonicalizeSourceUrl(undefined as unknown as string), null);
  });
});
