import type { Post, Topic } from '../data/mockTopics';
import type {
  AgentConfig,
  AgentFocus,
  AgentStatus,
  BackendAgentInstance,
  DiscoveryDecisionLite,
  EngineMeta,
  MemoryEntryLite,
  PipelineRun,
  PipelineStage
} from './agentTypes';
import {
  generateServerUUID,
  getInitialSeedPosts,
  selectPoolForDomain
} from './pools';
import {
  deleteAgentRow,
  findPublishedByCanonicalSource,
  getAgentRow,
  getDiscoveryCandidates,
  getDiscoveryDecisions,
  getSourceHealth,
  getMemoryNodesByAgent,
  getPostLinks,
  getPostsByAgent,
  getRecentMemoryEntries,
  getRecentPostsForMemory,
  getRunsByAgent,
  getScheduledJobByAgent,
  hasDecision,
  hasPublishedTopic,
  insertDecision,
  insertMemoryNode,
  insertPost,
  insertRun,
  insertSource,
  putAgentRow,
  updateRun,
  upsertTopicRow,
  withTransaction
} from './db';
import { DEFAULT_DAILY_CAP, DEFAULT_ROUTINE_INTERVAL_MS } from './editorial/engine';
import { PUBLISH_THRESHOLD, REJECT_THRESHOLD } from './editorial/types';
import { computeSourceStatus } from './discovery/health';
import { sourceTypeRank } from './discovery/sourceTypes';
import { generateOwnershipToken, ulid } from './ids';
import { linkRelatedPosts, recordMemoryForAccepted } from './memory';
import { timingSafeEqualString } from './security';
import { getPersona, validatePost } from './persona';
import { canonicalizeSourceUrl } from './urls';

// ---------------------------------------------------------------------------
// Durable autonomous-agent engine.
//
// The legacy sim stage machine (advanceTo / advanceAgentById) is a persisted,
// time-based state machine kept for TESTS ONLY: it is never advanced in
// production. The real pipeline is the discovery → editorial → quality gate →
// publication cycle (src/lib/jobs/cycle.ts), whose durable records (agent_runs,
// posts, decisions, fetches, memory_entries) drive every dashboard readout.
//
// Content entities live in their own relational tables:
//   topics / sources / posts / editorial_decisions / persona_memory / agent_runs
// Posts carry ULID ids and ISO-8601 UTC timestamps; duplicate publication of
// the same canonical topic/source per agent is prevented by UNIQUE constraints
// in the schema (plus the pipeline's own pre-checks).
// ---------------------------------------------------------------------------

// ---- Cadence helpers (same semantics as the original demo scheduler) ----

const demoScaledCadenceSeconds = (frequency: string): number => {
  const minutes = Math.max(1, parseInt(frequency, 10) || 15);
  return Math.min(60, Math.max(10, Math.round(minutes * 0.6)));
};

const nextPublishResetSeconds = (frequency: string): number => {
  const minutes = Math.max(1, parseInt(frequency, 10) || 15);
  return minutes * 60;
};

// ---- Pipeline stage specs (matching the original stage timings) ----

const buildStagesFor = (topic: Topic, domain: string): PipelineStage[] => {
  const stages: PipelineStage[] = [
    { status: 'scanning', durationMs: 1500, details: "Observe: Ingesting code commits and RSS paper streams..." },
    { status: 'filtering', durationMs: 1800, details: "Purge: Sifting out consumer hype wrappers and unverified rumors..." },
    { status: 'reasoning', durationMs: 2200, details: `Evaluate: Scoring impact criteria for ${domain} relevance...` },
    { status: 'memory_check', durationMs: 1500, details: "Compare: Running the duplicate-detection ladder against durable memory..." }
  ];
  if (topic.recommendation === 'Accept') {
    stages.push(
      { status: 'writing', durationMs: 2500, details: "Synthesize: Formulating systems-centric critique and summary draft..." },
      { status: 'publishing', durationMs: 1500, details: "Share: Signing release parameters & broadcasting to registry..." },
      { status: 'learning', durationMs: 1500, details: "Learn: Recording durable editorial memory for the accepted story..." }
    );
  } else {
    stages.push(
      { status: 'publishing', durationMs: 1500, details: "Share: Logging rejection metadata to filtered registry..." },
      { status: 'learning', durationMs: 1200, details: "Learn: Adapting credibility filter weights..." }
    );
  }
  return stages;
};

// Honest default "focus" readout: the agent has no in-flight work of its own
// between scheduled cycles, so the focus reflects what it is configured to do.
const defaultFocus = (domain: string): AgentFocus => ({
  focus: `Monitoring ${domain} streams`, // the discovery allowlist
  goal: "Awaiting the next scheduled cycle (external cron)",
  reasoning: "Real pipeline activity is recorded in agent_runs, posts, and discovery_fetches",
  estimatedCompletionSeconds: 0
});

const formatClockTime = (date: Date): string =>
  `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

const focusForStage = (status: AgentStatus, topic: { title: string }, domain: string, run: PipelineRun): AgentFocus => {
  const remainingMs = run.stages
    .slice(run.stageIndex)
    .reduce((sum, s) => sum + s.durationMs, 0);
  const estimatedCompletionSeconds = Math.round(remainingMs / 1000);
  switch (status) {
    case 'scanning':
      return { focus: `Ingesting ${topic.title.slice(0, 30)}...`, goal: "Isolate technical architecture variables", reasoning: "Reading raw GitHub config files & arXiv blobs", estimatedCompletionSeconds };
    case 'filtering':
      return { focus: "Purging Marketing Hype", goal: "Reject consumer funding models and wraps", reasoning: "Running credibility rating index checks", estimatedCompletionSeconds };
    case 'reasoning':
      return { focus: `Scoring ${topic.title.slice(0, 30)}`, goal: "Assess engineering impact and utility", reasoning: "Running heuristic matrix evaluation algorithms", estimatedCompletionSeconds };
    case 'memory_check':
      return { focus: "Reconciling with prior editorial memory", goal: "Avoid topic repetition collisions", reasoning: "Keyword/token duplicate ladder against durable memory (no embeddings)", estimatedCompletionSeconds };
    case 'writing':
      return { focus: "Drafting System Summaries", goal: "Establish opinionated engineering critiques", reasoning: "Extracting system dependencies", estimatedCompletionSeconds };
    case 'publishing':
      return { focus: "Broadcasting Insight", goal: "Publish signed feed entry", reasoning: "Commiting hash metadata to REST feed node", estimatedCompletionSeconds };
    case 'learning':
      return { focus: "Updating Vector Indexes", goal: "Expand memory graph structures", reasoning: "Correlating dynamic node links", estimatedCompletionSeconds };
    default:
      return { focus: "Observing AI Ecosystem", goal: "Ingest live research datasets", reasoning: `Monitoring arXiv, GitHub, and trusted streams for ${domain}`, estimatedCompletionSeconds };
  }
};

// ---- Canonical source helpers ----

const canonicalUrlsOf = (topic: { sources: string[] }): string[] =>
  topic.sources.map(canonicalizeSourceUrl).filter((u): u is string => u !== null);

// The sim snapshot is persisted on every advance (each scheduled run), so any
// array that grows per run grows state_json without bound and slows every
// write. Keep the display-only collections bounded; the durable records live
// in tables (posts, topics, memory_entries, agent_runs).
const MAX_TIMELINE_LOGS = 200;
const MAX_REJECTED_LIST = 100;
const MAX_MEMORY_NODES = 200;

function pushCapped<T>(arr: T[], item: T, max: number): void {
  arr.push(item);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

function unshiftCapped<T>(arr: T[], item: T, max: number): void {
  arr.unshift(item);
  if (arr.length > max) arr.pop();
}

// ---- State transitions (each fires exactly once per run) ----

// Enter the stage at run.stageIndex: set status/details/focus and fire the
// stage-entry side effects (logs, stats, rejections).
function enterStage(state: BackendAgentInstance, run: PipelineRun, now: number): void {
  const stage = run.stages[run.stageIndex];
  const topic = run.topic;

  state.status = stage.status;
  state.currentActionDetails = stage.details;
  state.missionProgress = Math.round(((run.stageIndex + 1) / run.stages.length) * 100);
  state.pipelineProgress = 0;
  state.novaLiveFocus = focusForStage(stage.status, topic, state.config.domain, run);

  const timeStr = formatClockTime(new Date(now));

  if (stage.status === 'scanning') {
    pushCapped(state.autonomousTimelineLogs, { timestamp: timeStr, message: `Discovered topic: ${topic.title.slice(0, 38)}...` }, MAX_TIMELINE_LOGS);
  } else if (stage.status === 'filtering' && topic.recommendation === 'Reject') {
    pushCapped(state.autonomousTimelineLogs, { timestamp: timeStr, message: `Rejected: ${topic.title.slice(0, 30)}... (Outside standard)` }, MAX_TIMELINE_LOGS);
    state.pipelineStats.filterCount += 1;
    unshiftCapped(state.rejectedTodayList, { title: topic.title, reason: topic.rejectionReason || "Low engineering relevance" }, MAX_REJECTED_LIST);
  } else if (stage.status === 'reasoning') {
    state.pipelineStats.reasonCount += 1;
    pushCapped(state.autonomousTimelineLogs, { timestamp: timeStr, message: `Scored credibility of ${topic.title.slice(0, 20)}...: 97%` }, MAX_TIMELINE_LOGS);
  } else if (stage.status === 'publishing' && topic.recommendation === 'Accept') {
    state.pipelineStats.publishCount += 1;
    pushCapped(state.autonomousTimelineLogs, { timestamp: timeStr, message: `Published post: ${topic.title.slice(0, 35)}...` }, MAX_TIMELINE_LOGS);
  } else if (stage.status === 'learning') {
    pushCapped(state.autonomousTimelineLogs, { timestamp: timeStr, message: "Recorded durable memory for the accepted story." }, MAX_TIMELINE_LOGS);
  }
}

// Start a new pipeline run for the next topic in the pool. Persists the
// scanned topic + its canonical sources and opens the durable run record.
function startRun(state: BackendAgentInstance, engine: EngineMeta, now: number): void {
  if (state.unprocessedPool.length === 0) {
    // Regenerate unique pool clones if the pool ran dry. Clones keep their
    // canonical source URLs, so the duplicate check still catches re-publish.
    state.unprocessedPool = [...state.topicPool].map(t => ({
      ...t,
      id: generateServerUUID(`topic-${t.id}`)
    }));
  }
  const topic = state.unprocessedPool.shift();
  if (!topic) return; // cannot happen after regeneration; stay idle

  state.activeTopic = topic;
  state.discoveredTopics = [topic, ...state.discoveredTopics].slice(0, 30);
  state.pipelineStats.scanCount += 1;
  state.currentTaskName = `Ingesting ${topic.title.slice(0, 35)}...`;
  engine.lastScanAt = now;

  const canonicalUrls = canonicalUrlsOf(topic);
  const topicId = upsertTopicRow({
    agentId: state.agentId,
    title: topic.title,
    canonicalSourceUrl: canonicalUrls[0] ?? `title:${topic.title}`,
    category: topic.category,
    sourceName: topic.source,
    credibilityScore: topic.credibilityScore,
    trendScore: topic.trendScore,
    noveltyScore: topic.noveltyScore,
    importanceScore: topic.importanceScore,
    confidenceScore: topic.confidenceScore,
    recommendation: topic.recommendation,
    rejectionReason: topic.rejectionReason ?? null,
    detailedAnalysis: topic.detailedAnalysis ?? null,
    opinion: topic.opinion ?? null,
    freshness: topic.freshness,
    rawJson: JSON.stringify(topic),
    createdAtMs: now
  });
  for (const url of canonicalUrls) {
    insertSource({ agentId: state.agentId, topicId, url, sourceName: topic.source });
  }
  const runId = insertRun({
    agentId: state.agentId,
    topicId,
    status: 'running',
    outcome: null,
    startedAtMs: now
  });

  engine.run = {
    topic,
    stageIndex: 0,
    stageStartedAt: now,
    stages: buildStagesFor(topic, state.config.domain),
    topicId,
    runId
  };
  enterStage(state, engine.run, now);
}

// Finish the active run: record the editorial decision, publish accepted
// topics (unless the canonical topic/source was already published by this
// agent), expand memory, and schedule the next run.
function finishRun(
  state: BackendAgentInstance,
  engine: EngineMeta,
  now: number,
  opts: { publish?: boolean } = {}
): void {
  const run = engine.run;
  if (!run) return;
  const { topic, topicId, runId } = run;
  const canonicalUrls = canonicalUrlsOf(topic);
  engine.run = null;

  const cadence = demoScaledCadenceSeconds(state.config.frequency);
  engine.lastDecisionAt = now;
  engine.nextRunAt = now + cadence * 1000;

  state.status = 'idle';
  state.activeTopic = null;
  state.pipelineProgress = 0;
  state.missionProgress = 0;
  state.currentTaskName = `Observing ${state.config.domain} streams`;
  state.currentActionDetails = `Observe Ecosystem: Scanning stream registries. Next scan in ${cadence}s.`;
  state.novaLiveFocus = defaultFocus(state.config.domain);

  unshiftCapped(state.decisions, topic, 100);

  const decision: 'accept' | 'reject' = topic.recommendation === 'Accept' ? 'accept' : 'reject';
  if (!hasDecision(state.agentId, topicId)) {
    const explanation =
      decision === 'reject'
        ? (topic.rejectionReason ?? 'Low engineering relevance')
        : `Accepted: importance ${topic.importanceScore}/100, novelty ${topic.noveltyScore}%, credibility ${topic.confidenceScore}%.`;
    insertDecision({
      agentId: state.agentId,
      topicId,
      decision,
      credibilityScore: topic.confidenceScore,
      noveltyScore: topic.noveltyScore,
      importanceScore: topic.importanceScore,
      confidenceScore: topic.confidenceScore,
      explanation,
      decidedAtMs: now
    });
  }

  let outcome: 'published' | 'rejected' | 'duplicate' | 'skipped' = 'skipped';

  // The durable orchestration advances the sim for visualization with
  // publish=false: a scheduled run must never publish posts by itself — the
  // only publication path is the gated editorial pipeline (see jobs/cycle.ts).
  const doPublish = opts.publish ?? true;

  if (doPublish && topic.recommendation === 'Accept') {
    // Duplicate-publication guard: never publish the same canonical topic
    // (topic_id) or canonical source URL twice for this agent.
    const alreadyPublished =
      hasPublishedTopic(state.agentId, topicId) ||
      findPublishedByCanonicalSource(state.agentId, canonicalUrls);

    if (alreadyPublished) {
      outcome = 'duplicate';
    } else {
      const domainCode = state.config.domain.slice(0, 3).replace(/\s/g, '').toUpperCase() || 'SYS';
      const pubId = `PUB-${domainCode}-${String(state.posts.length + 1).padStart(3, '0')}`;
      const postId = ulid();

      const newPost: Post = {
        id: postId,
        createdAt: new Date(now).toISOString(),
        title: topic.title,
        text: topic.detailedAnalysis || "Technical specifications and architecture verification logs committed.",
        rationale: `Selected for high relevance to ${state.config.domain}. Importance rated at ${topic.importanceScore}/100. Overlap comparison with 18 previous memory blocks indicates novelty score of ${topic.noveltyScore}%.`,
        opinion: topic.opinion || "No specific editorial notes added.",
        sources: topic.sources,
        confidenceScore: topic.confidenceScore,
        category: topic.category,
        importanceScore: topic.importanceScore,
        noveltyScore: topic.noveltyScore,
        relatedPosts: state.posts.slice(0, 1).map(p => p.title),
        publicationId: pubId
      };
      // Persona-driven final quality check (informational on the snapshot).
      newPost.quality = validatePost(getPersona(state.config.domain), {
        title: newPost.title,
        text: newPost.text,
        rationale: newPost.rationale,
        opinion: newPost.opinion
      });

      try {
        insertPost({
          id: postId,
          agentId: state.agentId,
          topicId,
          title: newPost.title,
          body: newPost.text,
          opinion: newPost.opinion,
          rationale: newPost.rationale,
          confidenceScore: newPost.confidenceScore,
          category: newPost.category,
          importanceScore: newPost.importanceScore,
          noveltyScore: newPost.noveltyScore,
          publicationId: pubId,
          publishedAtMs: now
        });

        // Durable memory: record what the persona said (long-term + editorial
        // memory) and link this post to related earlier posts via the ladder.
        recordMemoryForAccepted(
          state.agentId,
          {
            id: postId,
            title: newPost.title,
            summary: newPost.text,
            canonicalUrl: canonicalUrls[0] ?? '',
            sourceType: 'topic'
          },
          { nowMs: now }
        );
        const links = linkRelatedPosts(state.agentId, postId, now);
        if (links.length > 0) {
          newPost.relatedPosts = links.slice(0, 5).map(l => l.title);
        }

        unshiftCapped(state.posts, newPost, 50);
        state.pipelineStats.writeCount += 1;
        outcome = 'published';

        // Expand memory graph (blob snapshot + persona_memory rows).
        const nodeTopicId = generateServerUUID('mem-topic');
        const nodeOpinionId = generateServerUUID('mem-opinion');
        const topicNode = {
          id: nodeTopicId,
          label: topic.title.split(" ")[0] || "Node",
          group: "topic" as const,
          details: `${topic.title}. Published under registry ${pubId}.`,
          connections: [nodeOpinionId, "node-seed-1"],
          timestamp: new Date(now).toISOString()
        };
        const opinionNode = {
          id: nodeOpinionId,
          label: `Opinion: ${topic.category}`,
          group: "opinion" as const,
          details: topic.opinion || "No opinion",
          connections: [nodeTopicId],
          timestamp: new Date(now).toISOString()
        };
        pushCapped(state.memoryNodes, topicNode, MAX_MEMORY_NODES);
        pushCapped(state.memoryNodes, opinionNode, MAX_MEMORY_NODES);
        insertMemoryNode({ id: nodeTopicId, agentId: state.agentId, nodeLabel: topicNode.label, nodeGroup: 'topic', details: topicNode.details, connections: topicNode.connections, createdAtMs: now });
        insertMemoryNode({ id: nodeOpinionId, agentId: state.agentId, nodeLabel: opinionNode.label, nodeGroup: 'opinion', details: opinionNode.details, connections: opinionNode.connections, createdAtMs: now });
      } catch {
        // UNIQUE(agent_id, topic_id) backstop: a concurrent path already
        // published this topic. Record the run honestly and move on.
        outcome = 'duplicate';
      }
    }
  } else {
    outcome = 'rejected';
  }

  updateRun(runId, { status: 'completed', finishedAtMs: now, outcome });
}

// Advance an agent's durable state to `now`: apply due stage transitions,
// start runs that are due, and roll the publish countdown forward. Pure
// function over (state, engine); the caller persists afterwards.
function advanceTo(
  state: BackendAgentInstance,
  engine: EngineMeta,
  now: number,
  opts: { publish?: boolean } = {}
): void {
  // Roll the publish countdown forward by whole periods so the readout never
  // goes stale (mirrors the old tick resetting it when it reached zero).
  const publishPeriodMs = nextPublishResetSeconds(state.config.frequency) * 1000;
  while (now >= engine.nextPublishAt) engine.nextPublishAt += publishPeriodMs;

  const run = engine.run;
  if (!run) {
    if (now < engine.nextRunAt) return; // idle and not due yet
    startRun(state, engine, now); // run starts fresh at `now`; no transitions due yet
    return;
  }

  // Fast-forward through every stage whose window has fully elapsed.
  let stageStart = run.stageStartedAt;
  let idx = run.stageIndex;
  while (idx < run.stages.length && now >= stageStart + run.stages[idx].durationMs) {
    stageStart += run.stages[idx].durationMs;
    idx += 1;
  }

  if (idx >= run.stages.length) {
    finishRun(state, engine, now, opts);
    return;
  }

  if (idx !== run.stageIndex) {
    run.stageIndex = idx;
    run.stageStartedAt = stageStart;
    enterStage(state, run, now);
  }
}

// Build the read-only snapshot the client consumes, deriving the time-based
// fields (countdown, progress, timers) from the persisted timestamps.
function snapshotAgent(state: BackendAgentInstance, engine: EngineMeta, now: number): BackendAgentInstance {
  const run = engine.run;
  if (run) {
    const stage = run.stages[run.stageIndex];
    const elapsed = Math.max(0, now - run.stageStartedAt);
    state.status = stage.status;
    state.currentActionDetails = stage.details;
    state.pipelineProgress = Math.min(100, Math.round((elapsed / stage.durationMs) * 100));
    state.missionProgress = Math.round(((run.stageIndex + 1) / run.stages.length) * 100);
    state.countdown = 0;
  } else {
    state.status = 'idle';
    state.pipelineProgress = 0;
    state.missionProgress = 0;
    state.countdown = Math.max(0, Math.ceil((engine.nextRunAt - now) / 1000));
  }
  state.secondsSinceLastScan = Math.max(0, Math.floor((now - engine.lastScanAt) / 1000));
  state.lastDecisionTimeSeconds = Math.max(0, Math.floor((now - engine.lastDecisionAt) / 1000));
  state.nextPublishSeconds = Math.max(0, Math.ceil((engine.nextPublishAt - now) / 1000));
  return state;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// Validate an externally-supplied agentId (e.g. from a query string) before it
// can become a DB key or look-up. Rejects dangerous property names and anything
// outside a conservative [a-zA-Z0-9-] shape, and caps the length.
export function isSafeAgentId(agentId: string): boolean {
  if (agentId.length === 0 || agentId.length > 128) return false;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]*$/.test(agentId)) return false;
  if (agentId === '__proto__' || agentId === 'constructor' || agentId === 'prototype') return false;
  return true;
}

// Create a new agent and persist it (agent row + seed content rows). Only this
// function may create agents. `now` is injectable for deterministic tests.
export function initializeAgentInstance(
  name: string,
  domain: string,
  customAgentId?: string,
  customHeuristics?: { role?: string; mission?: string; frequency?: string; style?: string },
  now: number = Date.now()
): BackendAgentInstance {
  // Opaque, collision-resistant agent id (ULID). Never derived from the persona,
  // so ids are unguessable and stable for the agent's lifetime.
  const agentId = customAgentId || ulid();
  const frequency = customHeuristics?.frequency || "15";

  const topicPool = selectPoolForDomain(domain);

  const role =
    customHeuristics?.role ||
    (domain.includes("Security")
      ? "AI Security Researcher"
      : domain.includes("Robotics")
        ? "Robotics Systems Engineer"
        : domain.includes("Open Source")
          ? "Open Source Contributor"
          : "AI Systems Architect");

  const config: AgentConfig = {
    name,
    role,
    domain,
    mission: customHeuristics?.mission || `Publish only high-impact developments in ${domain}. Fully filter commercial marketing, hype, funding widgets, duplicate news, and unverified rumors.`,
    frequency,
    style: customHeuristics?.style || "Professional, Analytical, Skeptical of Hype, Concise, Calm, Highly Technical"
  };

  // Demo/seed posts: ULID ids + demoOnly flag. They are excluded from the
  // judged GET /api/agent/feed API and never count toward duplicate prevention.
  const seedPosts = getInitialSeedPosts(domain, now).map(p => ({ ...p, id: ulid(), demoOnly: true }));

  const state: BackendAgentInstance = {
    agentId,
    config,
    status: 'idle',
    currentActionDetails: "Observe Ecosystem: Scanning stream registers...",
    countdown: 0, // derived in snapshot
    secondsSinceLastScan: 0, // derived
    missionProgress: 0, // derived
    currentTaskName: `Observing ${domain} ecosystem`,
    nextPublishSeconds: 0, // derived
    // No fabricated counters: real pipeline counts come from the persisted
    // tables (peekAgentState fills candidateQueue/decisions/posts/runs).
    pipelineStats: { scanCount: 0, filterCount: 0, reasonCount: 0, memoryCount: 0, writeCount: 0, publishCount: 0 },
    discoveredTopics: topicPool.slice(0, 3),
    posts: seedPosts,
    memoryNodes: [], // legacy sim field; real memory is memory_entries
    decisions: [],
    rejectedTodayList: [], // real rejections come from discovery_decisions
    activeTopic: null,
    pipelineProgress: 0,
    lastDecisionTimeSeconds: 0, // derived
    autonomousTimelineLogs: [], // legacy sim field; real activity comes from agent_runs/posts
    novaLiveFocus: defaultFocus(domain),
    // Real persisted-pipeline data is empty until the discovery/editorial
    // pipeline runs; the state read (peekAgentState) fills these from SQLite.
    sourceHealth: [],
    candidateQueue: [],
    agentRuns: [],
    scheduledJob: null,
    memoryEntries: [],
    publishedPosts: [],
    editorialThresholds: {
      publish: PUBLISH_THRESHOLD,
      reject: REJECT_THRESHOLD,
      dailyCap: DEFAULT_DAILY_CAP,
      routineIntervalMinutes: Math.round(DEFAULT_ROUTINE_INTERVAL_MS / 60_000)
    },
    topicPool,
    unprocessedPool: [...topicPool]
  };

  const engine: EngineMeta = {
    lastScanAt: now - 4000, // -> secondsSinceLastScan = 4
    nextRunAt: now + demoScaledCadenceSeconds(frequency) * 1000,
    nextPublishAt: now + nextPublishResetSeconds(frequency) * 1000,
    lastDecisionAt: now - 12000, // -> lastDecisionTimeSeconds = 12
    run: null,
    // Secret ownership credential returned to the caller in an init response
    // header; required to DELETE the agent (see destroyAgent). Persisted in
    // engine_json only — never serialized to the client-facing state.
    ownershipToken: generateOwnershipToken()
  };

  // Create the agent atomically: the row plus all seed content rows. A crash
  // mid-init must never leave a half-created agent.
  withTransaction(() => {
    putAgentRow(state, engine, now);

    // Seed content rows: each demo post becomes a topic row (demo canonical
    // key), its sources, and a post row with a ULID id + ISO UTC published_at.
    for (const post of seedPosts) {
      // Demo topics use a `demo:` canonical key so they can never collide with
      // (or shadow) a real scanned source — demo content must not block real
      // publications or register as a published topic.
      const canonical = `demo:${post.id}`;
      const topicId = upsertTopicRow({
        agentId,
        title: post.title,
        canonicalSourceUrl: canonical,
        category: post.category,
        sourceName: null,
        credibilityScore: post.confidenceScore,
        trendScore: null,
        noveltyScore: post.noveltyScore,
        importanceScore: post.importanceScore,
        confidenceScore: post.confidenceScore,
        recommendation: 'Accept',
        rejectionReason: null,
        detailedAnalysis: post.text,
        opinion: post.opinion,
        freshness: null,
        rawJson: JSON.stringify(post),
        createdAtMs: now
      });
      for (const source of post.sources) {
        const url = canonicalizeSourceUrl(source);
        if (url) insertSource({ agentId, topicId, url, sourceName: null });
      }
      const publishedAtMs = Date.parse(post.createdAt);
      insertPost({
        id: post.id,
        agentId,
        topicId,
        title: post.title,
        body: post.text,
        opinion: post.opinion,
        rationale: post.rationale,
        confidenceScore: post.confidenceScore,
        category: post.category,
        importanceScore: post.importanceScore,
        noveltyScore: post.noveltyScore,
        publicationId: post.publicationId,
        publishedAtMs: Number.isFinite(publishedAtMs) ? publishedAtMs : now,
        isDemo: true
      });
    }

    // Deliberately no seed memory nodes: persona_memory is written only by the
    // legacy sim (test-only). The real durable memory lives in memory_entries.
  });

  return snapshotAgent(state, engine, now);
}

// Advance a single agent to `now` and return its fresh snapshot (or null if it
// does not exist). Safe to call repeatedly: once caught up, it is a no-op.
export function advanceAgentById(
  agentId: string,
  now: number = Date.now(),
  opts: { publish?: boolean } = {}
): BackendAgentInstance | null {
  const row = getAgentRow(agentId);
  if (!row) return null;
  // Atomic advance: stage transitions, content rows, and the snapshot persist
  // together — a crash mid-run never leaves a torn state.
  withTransaction(() => {
    advanceTo(row.state, row.engine, now, opts);
    putAgentRow(row.state, row.engine, now);
  });
  return snapshotAgent(row.state, row.engine, now);
}

// Pure read: snapshot an agent WITHOUT writing anything. Used by GET /feed's
// sibling state and by the state route after flushing. Attaches the
// discovery-pipeline editorial decisions (with quality-gate results) and the
// other real persisted-pipeline collections (source health, candidate queue,
// agent runs, scheduled job, durable memory, published posts) so the dashboard
// renders only data that actually exists in SQLite. The sim engine itself
// never touches these fields.
export function peekAgentState(agentId: string, now: number = Date.now()): BackendAgentInstance | null {
  const row = getAgentRow(agentId);
  if (!row) return null;
  const state = snapshotAgent(row.state, row.engine, now);

  // --- Discovery-pipeline editorial decisions (with score breakdown) ---
  // Scoped to this agent: the dashboard never shows another agent's verdicts.
  const decisions = getDiscoveryDecisions({ agentId, limit: 20 });
  state.discoveryDecisions = decisions.map(r => ({
    id: r.id,
    candidateId: r.candidateId,
    title: r.title,
    decision: r.decision,
    totalScore: r.totalScore,
    personaRelevance: r.personaRelevance,
    technicalImpact: r.technicalImpact,
    sourceQuality: r.sourceQuality,
    recency: r.recency,
    novelty: r.novelty,
    discussionValue: r.discussionValue,
    evidenceConfidence: r.evidenceConfidence,
    explanation: r.explanation,
    decidedAt: r.decidedAt,
    generationStatus: r.generationStatus,
    generationFailure: r.generationFailure,
    qualityStatus: r.qualityStatus,
    quality: r.qualityJson == null ? null : (JSON.parse(r.qualityJson) as DiscoveryDecisionLite['quality']),
    candidateUrl: r.candidateUrl,
    sourceName: r.sourceName,
    sourceType: r.sourceType,
    publishedPostId: r.publishedPostId
  }));

  // --- Candidate queue: persisted discovery candidates + their decision ---
  const decisionByCandidate = new Map(decisions.map(d => [d.candidateId, d]));
  state.candidateQueue = getDiscoveryCandidates({ limit: 40 }).map(c => {
    const dec = decisionByCandidate.get(c.id);
    return {
      id: c.id,
      canonicalUrl: c.canonicalUrl,
      title: c.title,
      summary: c.summary,
      publishedAt: c.publishedAt,
      fetchedAt: c.fetchedAt,
      sourceName: c.sourceName,
      sourceType: c.sourceType,
      decision: dec ? dec.decision : null,
      totalScore: dec ? dec.totalScore : null,
      explanation: dec ? dec.explanation : null
    };
  });

  // --- Source health: the durable source_health table (one rolling row per
  //     source, updated by the discovery runner), with derived freshness ---
  const healthRows = getSourceHealth();
  state.sourceHealth = healthRows
    .map(h => {
      const freshness = computeSourceStatus(h, now);
      return {
        sourceName: h.sourceName,
        sourceType: h.sourceType,
        url: h.url,
        status: (freshness === 'down' ? 'failure' : 'success') as 'success' | 'failure',
        freshness,
        itemCount: h.lastItemCount,
        error: h.lastError,
        fetchedAt: h.lastFetchAt,
        successCount: h.successCount,
        failureCount: h.failureCount,
        lastSuccessAt: h.lastSuccessAt,
        lastFailureAt: h.lastFailureAt,
        consecutiveFailures: h.consecutiveFailures
      };
    })
    .sort((a, b) => {
      // Primary sources first, then most-recently updated.
      const rankDiff = sourceTypeRank(b.sourceType) - sourceTypeRank(a.sourceType);
      if (rankDiff !== 0) return rankDiff;
      return (b.fetchedAt ?? '').localeCompare(a.fetchedAt ?? '');
    });

  // --- Agent run history + the durable scheduled job ---
  state.agentRuns = getRunsByAgent(agentId)
    .slice(0, 50)
    .map(r => ({
      id: r.id,
      topicId: r.topicId,
      status: r.status,
      outcome: r.outcome,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      error: r.error
    }));
  const job = getScheduledJobByAgent(agentId);
  state.scheduledJob = job
    ? {
        id: job.id,
        jobType: job.jobType,
        status: job.status,
        scheduleMs: job.scheduleMs,
        nextRunAtMs: job.nextRunAtMs,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        backoffMs: job.backoffMs,
        lastRunAtMs: job.lastRunAtMs,
        lastError: job.lastError,
        leaseOwner: job.leaseOwner,
        leaseExpiresAtMs: job.leaseExpiresAtMs
      }
    : null;

  // --- Durable editorial memory (persona scope) ---
  state.memoryEntries = getRecentMemoryEntries({
    agentId: null,
    kinds: ['short_term', 'long_term', 'editorial'],
    limit: 40
  }).map(e => ({
    id: e.id,
    kind: e.kind,
    subject: e.subject,
    content: e.content,
    importance: e.importance,
    occurrences: e.occurrences,
    firstSeenAt: e.firstSeenAt,
    lastSeenAt: e.lastSeenAt,
    // Editorial-memory continuity, persisted in the entry's metadata: how the
    // newest evidence relates to the persona's prior stance on this subject,
    // plus the identifiers and themes the record touches.
    relation: e.metadata.relation as MemoryEntryLite['relation'],
    identifiers: Array.isArray(e.metadata.identifiers) ? (e.metadata.identifiers as string[]) : undefined,
    themes: Array.isArray(e.metadata.themes) ? (e.metadata.themes as string[]) : undefined
  }));

  // --- Published posts (durable posts table; demo/seed posts labeled) ---
  const postRows = getPostsByAgent(agentId, { includeDemo: true });
  const postTitleById = new Map(
    getRecentPostsForMemory(agentId, 200).map(p => [p.id, p.title] as const)
  );
  const decisionByPost = new Map(
    decisions.filter(d => d.publishedPostId != null).map(d => [d.publishedPostId as string, d] as const)
  );
  state.publishedPosts = postRows.map(p => {
    const dec = decisionByPost.get(p.id);
    let generated: { confidence?: number; citedUrls?: string[]; relatedPosts?: string[] } | null = null;
    if (dec && dec.generatedJson != null) {
      try {
        generated = JSON.parse(dec.generatedJson) as {
          confidence?: number;
          citedUrls?: string[];
          relatedPosts?: string[];
        } | null;
      } catch {
        generated = null;
      }
    }
    return {
      id: p.id,
      title: p.title,
      body: p.body,
      opinion: p.opinion,
      rationale: p.rationale,
      createdAt: p.createdAt,
      sources: p.sources,
      isDemo: p.isDemo,
      decisionId: dec ? dec.id : null,
      totalScore: dec ? dec.totalScore : null,
      confidence: generated && typeof generated.confidence === 'number' ? generated.confidence : null,
      citedUrls: generated && Array.isArray(generated.citedUrls) ? generated.citedUrls : [],
      relatedPosts: generated && Array.isArray(generated.relatedPosts) ? generated.relatedPosts : [],
      links: getPostLinks(p.id).map(l => ({
        relatedPostId: l.relatedPostId,
        relatedTitle: postTitleById.get(l.relatedPostId) ?? l.relatedPostId,
        relationType: l.relationType,
        similarity: l.similarity,
        reason: l.reason
      }))
    };
  });

  // --- Real editorial thresholds (decision engine constants) ---
  state.editorialThresholds = {
    publish: PUBLISH_THRESHOLD,
    reject: REJECT_THRESHOLD,
    dailyCap: DEFAULT_DAILY_CAP,
    routineIntervalMinutes: Math.round(DEFAULT_ROUTINE_INTERVAL_MS / 60_000)
  };

  return state;
}

// Evict an agent durably (CASCADE removes its topics/sources/posts/decisions/
// memory/runs). Requires the ownership credential minted at init: agent ids
// alone can never delete work. Returns false (caller maps to 404) when the
// agent is unknown OR the token does not match — never distinguishing the two,
// so a caller without the correct token learns nothing about existence.
export function destroyAgent(agentId: string, ownershipToken: string): boolean {
  const row = getAgentRow(agentId);
  if (!row) return false;
  const expected = row.engine.ownershipToken;
  if (!expected || !timingSafeEqualString(ownershipToken, expected)) return false;
  deleteAgentRow(agentId);
  return true;
}

/** The agent's ownership credential, for the init route to hand out (null
 *  when the agent does not exist — pre-token rows cannot be deleted via the
 *  API and must be removed by an operator). */
export function getOwnershipToken(agentId: string): string | null {
  const row = getAgentRow(agentId);
  return row?.engine.ownershipToken ?? null;
}

// Expose memory lookup for tests/audit.
export { getMemoryNodesByAgent };
