import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseGithubAdvisories, parseCisaKev, parseArxivAtom, parseFeed, parseGithubReleases } from '../src/lib/discovery/adapters';

const fixture = (name: string): string =>
  fs.readFileSync(path.join(process.cwd(), 'tests', 'fixtures', name), 'utf8');

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describe('GitHub Security Advisories adapter', () => {
  it('normalizes advisories into the common candidate shape', () => {
    const candidates = parseGithubAdvisories(JSON.parse(fixture('github-advisories.json')));
    assert.equal(candidates.length, 2, 'entry with empty summary/published_at must be dropped');

    const first = candidates[0];
    assert.ok(first);
    assert.match(first.title, /GHSA-8v4g-5r6p-9x3m/);
    assert.ok(first.title.includes('Heap overflow'));
    assert.ok(first.summary.includes('Affected packages: transformers'));
    assert.ok(first.summary.includes('Severity: high'));
    assert.equal(first.publishedAt, '2026-07-20T14:30:00.000Z');
    assert.equal(first.canonicalUrl, 'https://github.com/advisories/GHSA-8v4g-5r6p-9x3m');
    assert.equal(first.sourceName, 'GitHub Security Advisories');
    assert.equal(first.sourceType, 'github-advisory');
    assert.ok(first.rawEvidence.includes('GHSA-8v4g-5r6p-9x3m'));
  });

  it('upgrades http canonical URLs to https', () => {
    const candidates = parseGithubAdvisories(JSON.parse(fixture('github-advisories.json')));
    const http = candidates.find(c => c.title.includes('GHSA-qq2x'));
    assert.ok(http);
    assert.equal(http.canonicalUrl, 'https://github.com/advisories/GHSA-qq2x-7p4m-w9v2');
  });

  it('handles a non-array payload gracefully', () => {
    assert.deepEqual(parseGithubAdvisories({}), []);
    assert.deepEqual(parseGithubAdvisories(null), []);
  });
});

describe('CISA KEV adapter', () => {
  it('normalizes KEV entries with NVD detail canonical URLs', () => {
    const candidates = parseCisaKev(JSON.parse(fixture('cisa-kev.json')));
    assert.equal(candidates.length, 2, 'entry without a CVE id must be dropped');

    const first = candidates[0];
    assert.ok(first);
    assert.equal(first.title, 'Example Gateway Command Injection (CVE-2026-12345)');
    assert.ok(first.summary.includes('Command injection in the web admin interface'));
    assert.ok(first.summary.includes('Required action: Apply vendor updates'));
    assert.ok(first.summary.includes('ransomware'));
    // dateAdded YYYY-MM-DD → anchored ISO UTC midnight.
    assert.equal(first.publishedAt, '2026-07-15T00:00:00.000Z');
    assert.equal(first.canonicalUrl, 'https://nvd.nist.gov/vuln/detail/CVE-2026-12345');
    assert.equal(first.sourceType, 'cisa-kev');
  });
});

describe('arXiv adapter', () => {
  it('parses Atom entries, strips version suffixes, upgrades to https', () => {
    const candidates = parseArxivAtom(fixture('arxiv.xml'));
    assert.equal(candidates.length, 2, 'entry with empty title must be dropped');

    const first = candidates[0];
    assert.ok(first);
    assert.equal(first.title, 'Prompt Injection Attacks on Agentic RAG Pipelines');
    assert.ok(first.summary.includes('poisoned vector stores'));
    assert.equal(first.publishedAt, '2026-08-01T12:00:00.000Z');
    // CDATA-wrapped titles must come out as clean text.
    assert.equal(candidates[1].title, 'Adversarial Robustness of LLM Guardrails');
    // http id + v2 suffix → canonical https abs URL without the version.
    assert.equal(first.canonicalUrl, 'https://arxiv.org/abs/2608.12345');
    assert.equal(first.sourceType, 'arxiv');
    assert.ok(first.rawEvidence.includes('<entry>'));
  });
});

describe('AI lab feed adapter (RSS + Atom)', () => {
  it('parses RSS items, upgrades http links, rejects non-http schemes', () => {
    const candidates = parseFeed(fixture('lab-rss.xml'), 'Lab Feed');
    assert.equal(candidates.length, 2, 'javascript: link must be rejected');

    const upgraded = candidates.find(c => c.title.includes('HTTP link'));
    assert.ok(upgraded);
    assert.equal(upgraded.canonicalUrl, 'https://lab.example.com/security/http-item');
    assert.equal(upgraded.publishedAt, '2026-07-16T10:00:00.000Z');
    assert.equal(upgraded.sourceType, 'lab-feed');

    for (const c of candidates) {
      assert.ok(c.canonicalUrl.startsWith('https://'), 'all candidates must be canonical https');
    }
  });

  it('parses Atom entries with link href', () => {
    const candidates = parseFeed(fixture('lab-atom.xml'), 'Lab Atom');
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].title, 'Patch release for authentication bypass');
    assert.equal(candidates[0].canonicalUrl, 'https://lab.example.com/security/auth-bypass');
    assert.equal(candidates[0].publishedAt, '2026-07-14T09:00:00.000Z');
  });
});

describe('GitHub releases adapter', () => {
  it('keeps only security-relevant releases and normalizes them', () => {
    const candidates = parseGithubReleases(JSON.parse(fixture('github-releases.json')));
    assert.equal(candidates.length, 2, 'release without security terms must be filtered out');

    const sandbox = candidates.find(c => c.title.includes('v2.1.0'));
    assert.ok(sandbox);
    assert.ok(sandbox.summary.includes('sandbox escape'));
    assert.equal(sandbox.canonicalUrl, 'https://github.com/ollama/ollama/releases/tag/v2.1.0');
    assert.equal(sandbox.sourceType, 'github-release');

    const injection = candidates.find(c => c.title.includes('v2.1.1'));
    assert.ok(injection, 'prompt-injection release must be kept');
    assert.ok(!candidates.some(c => c.title.includes('v2.0.0')));
  });

  it('ignores drafts', () => {
    const candidates = parseGithubReleases([
      { tag_name: 'draft-1', name: 'draft', published_at: '2026-07-01T00:00:00Z', html_url: 'https://github.com/x/y/releases/tag/draft-1', body: 'cve fix', draft: true }
    ]);
    assert.equal(candidates.length, 0);
  });
});

describe('candidate normalization contract', () => {
  it('every candidate satisfies the common shape invariants', () => {
    const all = [
      ...parseGithubAdvisories(JSON.parse(fixture('github-advisories.json'))),
      ...parseCisaKev(JSON.parse(fixture('cisa-kev.json'))),
      ...parseArxivAtom(fixture('arxiv.xml')),
      ...parseFeed(fixture('lab-rss.xml'), 'Lab'),
      ...parseFeed(fixture('lab-atom.xml'), 'Lab'),
      ...parseGithubReleases(JSON.parse(fixture('github-releases.json')))
    ];
    assert.ok(all.length >= 9);
    for (const c of all) {
      assert.ok(c.title.length > 0, 'title required');
      assert.match(c.publishedAt, ISO_UTC_RE, 'publishedAt must be ISO UTC');
      assert.ok(c.canonicalUrl.startsWith('https://'), 'canonicalUrl must be https');
      assert.ok(c.sourceName.length > 0);
      assert.ok(c.sourceType.length > 0);
      assert.ok(c.rawEvidence.length > 0, 'raw evidence must be preserved');
    }
  });
});
