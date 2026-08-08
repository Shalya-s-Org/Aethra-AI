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

  // Internal service variables (persisted with the agent; not rendered by the
  // dashboard, which simply ignores them).
  topicPool: Topic[];
  unprocessedPool: Topic[];
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
}
