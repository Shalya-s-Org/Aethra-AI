import type { Topic, Post, MemoryNode } from '../data/mockTopics';

// Shared agent types. This module is import-safe for both the server engine
// and the client (type-only), so the dashboard can keep its snapshot contract
// without pulling server code into the browser bundle.

export type AgentStatus =
  | 'idle'
  | 'scanning'
  | 'filtering'
  | 'reasoning'
  | 'memory_check'
  | 'writing'
  | 'publishing'
  | 'learning';

export interface AgentConfig {
  name: string;
  role: string;
  domain: string;
  mission: string;
  frequency: string;
  style: string;
}

export interface PipelineStats {
  scanCount: number;
  filterCount: number;
  reasonCount: number;
  memoryCount: number;
  writeCount: number;
  publishCount: number;
}

export interface AgentFocus {
  focus: string;
  goal: string;
  reasoning: string;
  estimatedCompletionSeconds: number;
}

export interface AgentTimelineLog {
  timestamp: string;
  message: string;
}

// The public snapshot shape served by GET /api/agent/state. The client mirrors
// these fields 1:1.
export interface BackendAgentInstance {
  agentId: string;
  config: AgentConfig;
  status: AgentStatus;
  currentActionDetails: string;
  countdown: number;
  secondsSinceLastScan: number;
  missionProgress: number;
  currentTaskName: string;
  nextPublishSeconds: number;
  pipelineStats: PipelineStats;
  discoveredTopics: Topic[];
  posts: Post[];
  memoryNodes: MemoryNode[];
  decisions: Topic[];
  rejectedTodayList: Array<{ title: string; reason: string }>;
  activeTopic: Topic | null;
  pipelineProgress: number;
  lastDecisionTimeSeconds: number;
  autonomousTimelineLogs: AgentTimelineLog[];
  novaLiveFocus: AgentFocus;

  /** Discovery-pipeline editorial decisions with quality-gate results
   *  (populated on the state read; the sim engine itself never touches them). */
  discoveryDecisions?: DiscoveryDecisionLite[];

  // ---- Real persisted-pipeline data (SQLite). The dashboard renders these
  //      fields; the sim engine itself never touches them. ----
  sourceHealth: SourceHealthLite[];
  candidateQueue: CandidateQueueLite[];
  agentRuns: AgentRunLite[];
  scheduledJob: ScheduledJobLite | null;
  memoryEntries: MemoryEntryLite[];
  publishedPosts: PublishedPostLite[];
  editorialThresholds: EditorialThresholdsLite;
  // Internal service variables (persisted with the agent; not rendered by the
  // dashboard, which simply ignores them).
  topicPool: Topic[];
  unprocessedPool: Topic[];
}

/** One discovery-pipeline decision as served to the dashboard's editorial
 *  decisions view, including the pre-publication quality-gate outcome and the
 *  full editorial score breakdown (all persisted, nothing synthesized). */
export interface DiscoveryDecisionLite {
  id: string;
  candidateId: string;
  title: string;
  decision: 'accepted' | 'held' | 'rejected';
  totalScore: number;
  personaRelevance: number;
  technicalImpact: number;
  sourceQuality: number;
  recency: number;
  novelty: number;
  discussionValue: number;
  evidenceConfidence: number;
  explanation: string;
  decidedAt: string;
  generationStatus: 'none' | 'generated' | 'failed';
  generationFailure: string | null;
  qualityStatus: 'pending' | 'passed' | 'held' | 'rejected';
  quality: {
    verdict: 'pass' | 'hold' | 'reject';
    score: number;
    checks: Array<{ id: string; label: string; passed: boolean; required: boolean; detail: string }>;
  } | null;
  /** Candidate metadata (canonical URL + source name), joined from the
   *  discovery_candidates table. */
  candidateUrl: string | null;
  sourceName: string | null;
  sourceType: string | null;
  /** Post id when this decision was transactionally published (durable). */
  publishedPostId: string | null;
}

// ---------------------------------------------------------------------------
// Real persisted-pipeline data (SQLite) served alongside the sim snapshot.
// The dashboard renders these only; nothing here is synthesized client-side.
// ---------------------------------------------------------------------------

/** Per-source health aggregated from the durable source_health table (rolling
 *  per-source row updated by the discovery runner). */
export interface SourceHealthLite {
  sourceName: string;
  sourceType: string;
  url: string;
  /** Latest fetch outcome (from the runner's health upsert). */
  status: 'success' | 'failure';
  /** Derived freshness: ok / stale (data older than the threshold) / down
   *  (repeated failures or never proven working). */
  freshness: 'ok' | 'stale' | 'down';
  itemCount: number | null;
  error: string | null;
  fetchedAt: string | null; // ISO UTC
  successCount: number;
  failureCount: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
}

/** One persisted discovery candidate with its editorial decision (if any). */
export interface CandidateQueueLite {
  id: string;
  canonicalUrl: string;
  title: string;
  summary: string | null;
  publishedAt: string; // ISO UTC
  fetchedAt: string; // ISO UTC
  sourceName: string;
  sourceType: string;
  decision: 'accepted' | 'held' | 'rejected' | null;
  totalScore: number | null;
  explanation: string | null;
}

/** One row of the durable agent_runs table. */
export interface AgentRunLite {
  id: string;
  topicId: string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped';
  outcome: string | null;
  startedAt: string; // ISO UTC
  finishedAt: string | null;
  error: string | null;
}

/** The agent's durable scheduled job (external-cron-driven recurring work). */
export interface ScheduledJobLite {
  id: string;
  jobType: string;
  status: 'active' | 'paused' | 'terminal';
  scheduleMs: number;
  nextRunAtMs: number;
  attempts: number;
  maxAttempts: number;
  backoffMs: number;
  lastRunAtMs: number | null;
  lastError: string | null;
  leaseOwner: string | null;
  leaseExpiresAtMs: number | null;
}

/** One durable memory_entries row (persona/agent scope). */
export interface MemoryEntryLite {
  id: string;
  kind: 'short_term' | 'long_term' | 'editorial';
  subject: string;
  content: string;
  importance: number;
  occurrences: number;
  firstSeenAt: string; // ISO UTC
  lastSeenAt: string; // ISO UTC
}

/** One post from the durable posts table (demo posts labeled, never hidden). */
export interface PublishedPostLite {
  id: string;
  title: string;
  body: string;
  opinion: string;
  rationale: string;
  createdAt: string; // ISO UTC
  sources: string[];
  isDemo: boolean;
  /** Linked editorial decision + generated post (when transactionally published). */
  decisionId: string | null;
  totalScore: number | null;
  confidence: number | null;
  citedUrls: string[];
  relatedPosts: string[];
  /** Durable post_links (related prior posts). */
  links: Array<{
    relatedPostId: string;
    relatedTitle: string;
    relationType: string;
    similarity: number | null;
    reason: string | null;
  }>;
}

/** Real editorial thresholds from the decision engine (never client-typed). */
export interface EditorialThresholdsLite {
  publish: number;
  reject: number;
  dailyCap: number;
  routineIntervalMinutes: number;
}

// ---- Durable engine internals (persisted in SQLite, never sent to the client) ----

// One stage of the autonomous pipeline state machine. Time-based progress is
// derived from `stageStartedAt` + `durationMs` against the wall clock, so the
// pipeline advances without any timers.
export interface PipelineStage {
  status: AgentStatus;
  durationMs: number;
  details: string;
}

export interface PipelineRun {
  topic: Topic;
  stageIndex: number;
  stageStartedAt: number;
  stages: PipelineStage[];
  /** topics-table id for this run's topic (persisted at scan time). */
  topicId: string;
  /** agent_runs-table id for this pipeline run (durable job record). */
  runId: string;
}

// Engine metadata that makes the simulation durable. All time is epoch ms.
// `run` is null while the agent is idle.
export interface EngineMeta {
  lastScanAt: number;
  nextRunAt: number;
  nextPublishAt: number;
  lastDecisionAt: number;
  run: PipelineRun | null;
  /**
   * Secret ownership credential minted at init and returned to the caller in
   * an `X-Agent-Ownership-Token` response header (never in the JSON body).
   * Required to DELETE the agent; persisted in engine_json (internal — never
   * serialized to the state/feed routes).
   */
  ownershipToken?: string;
}
