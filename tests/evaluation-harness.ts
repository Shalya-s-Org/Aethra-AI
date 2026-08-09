// Evaluation harness (shared by tests/evaluation.test.ts and scripts/evaluate.ts).
//
// This is the hackathon's 48-hour evaluation simulation: it drives the REAL
// production pipeline — discovery → editorial scoring → LLM generation →
// pre-publication quality gate → transactional gated publication — through the
// durable job queue, exactly as an external cron would, but with a virtual
// clock and an acceleration factor so 48 sim-hours complete in seconds.
//
// Determinism: no network, no randomness. Each occurrence injects a fixture-
// derived stream of candidates (the same shapes the real adapters produce —
// see tests/fixtures/) with per-occurrence identifiers, so the duplicate
// detector, routine interval, daily cap, and quality gate all see realistic,
// reproducible input. Production behavior is untouched: acceleration only
// compresses schedule intervals (timeFactor) inside the queue.
//
// Sizing: the production cadence is 6h (the routine posting interval), so a
// 48h horizon is 8 routine slots; with timeFactor 6 the effective interval is
// 1h → 48 recurring occurrences. That is enough to exercise the 6h interval,
// the 24h rolling cap (the 5th slot is held and pushed out), and duplicate
// rejection across occurrences, while keeping the test at ~2s.

import { makeCandidate } from '../src/lib/discovery/types';
import { insertDiscoveryCandidate } from '../src/lib/db';
import type { DiscoverySummary } from '../src/lib/discovery/runner';
import { JobQueue } from '../src/lib/jobs/queue';
import { runAgentCycle } from '../src/lib/jobs/cycle';

const HOUR = 3600_000;

// Eight distinct vulnerability templates (AI-security persona). Titles are
// deliberately low-overlap so the deterministic title-similarity duplicate
// check treats each template as a new story, and summaries carry CVE/GHSA
// identifiers so the candidates are supported, fresh, and gate-passable.
const TEMPLATES: Array<{ title: string; summary: string }> = [
  {
    title: 'Critical prompt injection bypass in LLM agent tool-calling layer allows remote code execution',
    summary:
      'A critical prompt injection bypass in the agent tool-calling layer escalates to remote code execution with a proof of concept available.'
  },
  {
    title: 'Server-side request forgery in AI agent web scraping plugin exposes internal metadata',
    summary:
      'An SSRF vulnerability in the web scraping plugin lets attackers reach internal endpoints and leak metadata.'
  },
  {
    title: 'Insecure deserialization in model artifact loader enables arbitrary file write on inference servers',
    summary:
      'An insecure deserialization flaw in the artifact loader allows arbitrary file write and privilege escalation on inference servers.'
  },
  {
    title: 'Data poisoning in open fine-tuning datasets compromises downstream model integrity',
    summary:
      'A data poisoning campaign in popular fine-tuning datasets can compromise downstream models; the supply-chain risk is under-analyzed.'
  },
  {
    title: 'Jailbreak via Unicode obfuscation defeats LLM content guardrails across chat models',
    summary:
      'A jailbreak technique using Unicode obfuscation bypasses content guardrails across major chat models; no fix is available yet.'
  },
  {
    title: 'Model extraction via unthrottled distillation endpoint leaks weights at inference time',
    summary:
      'An unthrottled distillation endpoint enables model extraction, leaking weights at inference time; the provider has not shipped a fix.'
  },
  {
    title: 'Data exfiltration through image generation service in a popular chatbot plugin',
    summary:
      'A vulnerability in the image generation service allows data exfiltration through crafted prompts.'
  },
  {
    title: 'Authentication bypass in AI gateway control plane exposes prompts and API credentials',
    summary:
      'An authentication bypass in the AI gateway control plane exposes stored prompts and API credentials.'
  }
];

export interface FixtureDiscoveryOptions {
  /** Sim start time; run index is derived from (now - startMs). */
  startMs: number;
  /** Effective (already accelerated) schedule interval. */
  intervalMs: number;
}

/** Deterministic, fixture-derived discovery: every occurrence emits all eight
 *  templates with run-scoped identifiers. `insertDiscoveryCandidate` dedups by
 *  canonical URL, so repeats are ignored exactly as the live runner ignores
 *  already-known advisories. */
export function makeFixtureDiscovery(opts: FixtureDiscoveryOptions): (now: number) => Promise<DiscoverySummary> {
  return async (now: number) => {
    const run = Math.max(0, Math.round((now - opts.startMs) / opts.intervalMs));
    const candidates = [];
    let newCandidates = 0;
    for (let t = 0; t < TEMPLATES.length; t++) {
      const cve = `CVE-2026-${String(run).padStart(4, '0')}${t}01`;
      const ghsa = `GHSA-${String(run).padStart(4, '0')}-${t}-sim`;
      const candidate = makeCandidate({
        title: TEMPLATES[t].title,
        summary: `${TEMPLATES[t].summary} Patch released. ${cve} assigned. ${ghsa} assigned.`,
        publishedAt: new Date(now - 2 * HOUR).toISOString(),
        canonicalUrl: `https://github.com/advisories/${ghsa}`,
        sourceName: 'GitHub Security Advisories',
        sourceType: 'github-advisory',
        // severity "medium" (not high/critical): the breaking-security override
        // must NOT fire, so the routine interval + daily cap stay testable.
        rawEvidence: JSON.stringify({ cve_id: cve, ghsa_id: ghsa, severity: 'medium' })
      });
      if (candidate) {
        candidates.push(candidate);
        if (insertDiscoveryCandidate(candidate, now)) newCandidates += 1;
      }
    }
    return {
      runId: `eval-sim-run-${run}`,
      startedAt: new Date(now).toISOString(),
      finishedAt: new Date(now).toISOString(),
      candidates,
      totalCandidates: candidates.length,
      newCandidates,
      fetches: [],
      failures: []
    };
  };
}

export interface EvaluationSimOptions {
  agentId: string;
  /** Sim start (also the first occurrence time). */
  startMs: number;
  /** Production schedule interval, e.g. 30 minutes. */
  scheduleMs: number;
  /** Simulation horizon in sim-time, e.g. 48 hours. */
  horizonMs: number;
  /** Schedule acceleration (1 = production behavior). */
  timeFactor?: number;
}

export interface EvaluationSimResult {
  steps: number;
  startMs: number;
  horizonMs: number;
  intervalMs: number;
  queue: JobQueue;
  summaries: Array<{ ok: boolean; error?: string; summary?: string }>;
}

/** Run the accelerated simulation through the real durable queue and the real
 *  agent cycle. The virtual clock steps one accelerated interval at a time —
 *  the queue never loops in production either; each tick is an external cron
 *  delivery. */
export async function runEvaluationSim(opts: EvaluationSimOptions): Promise<EvaluationSimResult> {
  const { agentId, startMs, scheduleMs, horizonMs, timeFactor = 6 } = opts;
  let now = startMs;
  const intervalMs = Math.max(1, Math.round(scheduleMs / timeFactor));
  const queue = new JobQueue({
    now: () => now,
    timeFactor,
    cycle: async (id: string, at: number) =>
      runAgentCycle(id, at, { discovery: makeFixtureDiscovery({ startMs, intervalMs }) })
  });
  queue.scheduleAgent(agentId, scheduleMs, 0);

  const steps = Math.floor(horizonMs / intervalMs);
  const summaries: EvaluationSimResult['summaries'] = [];
  for (let i = 0; i < steps; i++) {
    now += intervalMs;
    const tick = await queue.processDueJobs();
    summaries.push(...tick.details.map(d => ({ ok: d.ok, error: d.error, summary: d.summary })));
  }
  return { steps, startMs, horizonMs, intervalMs, queue, summaries };
}

export { TEMPLATES };
