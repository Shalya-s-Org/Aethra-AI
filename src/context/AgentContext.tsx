"use client";

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import type { Topic, Post, MemoryNode } from '../data/mockTopics';
import type {
  AgentRunLite,
  BackendAgentInstance,
  CandidateQueueLite,
  DiscoveryDecisionLite,
  EditorialThresholdsLite,
  MemoryEntryLite,
  PublishedPostLite,
  ScheduledJobLite,
  SourceHealthLite
} from '../lib/agentTypes';

export type AgentStatus = 'inactive' | 'idle' | 'scanning' | 'filtering' | 'reasoning' | 'memory_check' | 'writing' | 'publishing' | 'learning';

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

export type InitResult = { ok: true } | { ok: false; error: string };

interface AgentContextType {
  // Config
  config: AgentConfig;
  isInitialized: boolean;
  agentId: string;
  /** Report init success/failure so the UI can surface backend errors. */
  initializeAgent: (config: AgentConfig) => Promise<InitResult>;
  resetAgent: () => void;

  // State
  status: AgentStatus;
  currentActionDetails: string;
  countdown: number;

  // Ticking Telemetry
  secondsSinceLastScan: number;
  missionProgress: number;
  currentTaskName: string;
  nextPublishCountdown: string;
  pipelineStats: PipelineStats;

  // Databases
  discoveredTopics: Topic[];
  posts: Post[];
  memoryNodes: MemoryNode[];
  decisions: Topic[];
  /** Discovery-pipeline editorial decisions with quality-gate results. */
  discoveryDecisions: DiscoveryDecisionLite[];
  rejectedTodayList: Array<{ title: string; reason: string }>;

  // Real persisted-pipeline data (SQLite) — rendered as-is, never synthesized.
  sourceHealth: SourceHealthLite[];
  candidateQueue: CandidateQueueLite[];
  agentRuns: AgentRunLite[];
  scheduledJob: ScheduledJobLite | null;
  memoryEntries: MemoryEntryLite[];
  publishedPosts: PublishedPostLite[];
  editorialThresholds: EditorialThresholdsLite;

  // Navigation
  activeTab: string;
  setActiveTab: (tab: string) => void;

  // Active Topic being processed
  activeTopic: Topic | null;
  pipelineProgress: number;

  // Dynamic Storytelling State
  lastDecisionTimeSeconds: number;
  autonomousTimelineLogs: Array<{ timestamp: string; message: string }>;
  novaLiveFocus: {
    focus: string;
    goal: string;
    reasoning: string;
    estimatedCompletionSeconds: number;
  };

  // First live snapshot applied (dashboard can stop showing its skeleton)
  hasLoadedSnapshot: boolean;
}

const AgentContext = createContext<AgentContextType | undefined>(undefined);

const DEFAULT_CONFIG: AgentConfig = {
  name: "Dr. Nova",
  role: "AI Systems Architect",
  domain: "AI Systems & Hardware",
  mission: "Publish only developments that impact enterprise systems architecture.",
  frequency: "15",
  style: "Professional, Skeptical of Hype, Concise, Highly Technical"
};

const DEFAULT_FOCUS = {
  focus: "Observing AI Ecosystem",
  goal: "Ingest live research datasets",
  reasoning: "Monitoring arXiv, GitHub, and major blogs",
  estimatedCompletionSeconds: 0
};

const EMPTY_PIPELINE_STATS: PipelineStats = {
  scanCount: 0,
  filterCount: 0,
  reasonCount: 0,
  memoryCount: 0,
  writeCount: 0,
  publishCount: 0
};

export const AgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_CONFIG);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [agentId, setAgentId] = useState<string>("");
  const [status, setStatus] = useState<AgentStatus>('inactive');
  const [currentActionDetails, setCurrentActionDetails] = useState<string>("Agent offline. Initialize agent parameters to activate.");
  const [countdown, setCountdown] = useState<number>(15);

  const [secondsSinceLastScan, setSecondsSinceLastScan] = useState<number>(0);
  const [missionProgress, setMissionProgress] = useState<number>(0);
  const [currentTaskName, setCurrentTaskName] = useState<string>("Observing ecosystem");
  const [nextPublishSeconds, setNextPublishSeconds] = useState<number>(900);

  const [pipelineStats, setPipelineStats] = useState<PipelineStats>(EMPTY_PIPELINE_STATS);

  const [discoveredTopics, setDiscoveredTopics] = useState<Topic[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [memoryNodes, setMemoryNodes] = useState<MemoryNode[]>([]);
  const [decisions, setDecisions] = useState<Topic[]>([]);
  const [discoveryDecisions, setDiscoveryDecisions] = useState<DiscoveryDecisionLite[]>([]);
  const [rejectedTodayList, setRejectedTodayList] = useState<Array<{ title: string; reason: string }>>([]);
  const [sourceHealth, setSourceHealth] = useState<SourceHealthLite[]>([]);
  const [candidateQueue, setCandidateQueue] = useState<CandidateQueueLite[]>([]);
  const [agentRuns, setAgentRuns] = useState<AgentRunLite[]>([]);
  const [scheduledJob, setScheduledJob] = useState<ScheduledJobLite | null>(null);
  const [memoryEntries, setMemoryEntries] = useState<MemoryEntryLite[]>([]);
  const [publishedPosts, setPublishedPosts] = useState<PublishedPostLite[]>([]);
  const [editorialThresholds, setEditorialThresholds] = useState<EditorialThresholdsLite>({
    publish: 78,
    reject: 60,
    dailyCap: 4,
    routineIntervalMinutes: 360
  });

  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [activeTopic, setActiveTopic] = useState<Topic | null>(null);
  const [pipelineProgress, setPipelineProgress] = useState<number>(0);

  const [lastDecisionTimeSeconds, setLastDecisionTimeSeconds] = useState<number>(0);
  const [autonomousTimelineLogs, setAutonomousTimelineLogs] = useState<Array<{ timestamp: string; message: string }>>([]);
  const [novaLiveFocus, setNovaLiveFocus] = useState(DEFAULT_FOCUS);
  // True once the first live engine snapshot has been applied. Lets the
  // dashboard show a skeleton instead of empty defaults while bootstrapping.
  const [hasLoadedSnapshot, setHasLoadedSnapshot] = useState<boolean>(false);
  // The ownership credential issued with the init response header. DELETE
  // /api/agent requires it — an agent id alone can never delete an agent — so
  // the dashboard keeps it in memory for the session and sends it on reset.
  const [ownershipToken, setOwnershipToken] = useState<string | null>(null);

  const initializeAgent = async (newConfig: AgentConfig): Promise<InitResult> => {
    const previousId = agentId;
    const previousToken = ownershipToken;
    setHasLoadedSnapshot(false);
    try {
      const res = await fetch('/api/agent/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona: { ...newConfig } })
      });
      if (!res.ok) {
        // Surface the backend's message when it provides one (validation 400s,
        // oversized 413s, etc.) instead of failing silently.
        let message = `Backend initialization failed (HTTP ${res.status}).`;
        try {
          const body = (await res.json()) as { error?: unknown };
          if (typeof body.error === 'string' && body.error.length > 0) message = body.error;
        } catch {
          // non-JSON error body — keep the generic message
        }
        console.error("Could not register agent session on server:", message);
        return { ok: false, error: message };
      }
      const data = await res.json();
      const token = res.headers.get('x-agent-ownership-token');
      setOwnershipToken(token);

      setAgentId(data.agentId);
      setConfig(newConfig);
      setIsInitialized(true);
      setStatus('idle');
      setCurrentActionDetails("Agent initialized. Backend autonomous cycles online.");

      // Evict any previous session's agent so its scheduler loop stops too.
      if (previousId) {
        fetch(`/api/agent?agentId=${encodeURIComponent(previousId)}`, {
          method: 'DELETE',
          headers: previousToken ? { 'x-agent-ownership-token': previousToken } : {}
        }).catch(() => {});
      }
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Could not register agent session on server:", err);
      return { ok: false, error: message };
    }
  };

  const resetAgent = useCallback(() => {
    const currentId = agentId;
    const currentToken = ownershipToken;
    setHasLoadedSnapshot(false);
    setIsInitialized(false);
    setAgentId("");
    setStatus('inactive');
    setCurrentActionDetails("Agent offline. Initialize agent parameters to activate.");
    setCountdown(15);
    setSecondsSinceLastScan(0);
    setMissionProgress(0);
    setCurrentTaskName("Observing ecosystem");
    setNextPublishSeconds(900);
    setPipelineStats(EMPTY_PIPELINE_STATS);
    setDiscoveredTopics([]);
    setPosts([]);
    setMemoryNodes([]);
    setDecisions([]);
    setRejectedTodayList([]);
    setSourceHealth([]);
    setCandidateQueue([]);
    setAgentRuns([]);
    setScheduledJob(null);
    setMemoryEntries([]);
    setPublishedPosts([]);
    setActiveTopic(null);
    setPipelineProgress(0);
    setLastDecisionTimeSeconds(0);
    setAutonomousTimelineLogs([]);
    setNovaLiveFocus(DEFAULT_FOCUS);

    // Evict the server-side agent so its scheduler loop stops, not just the view.
    if (currentId) {
      fetch(`/api/agent?agentId=${encodeURIComponent(currentId)}`, {
        method: 'DELETE',
        headers: currentToken ? { 'x-agent-ownership-token': currentToken } : {}
      }).catch(() => {});
    }
  }, [agentId, ownershipToken]);

  // Mirror the live backend engine state. The server-side engine owns the whole
  // simulation (scanning -> filtering -> reasoning -> ... -> publishing), so the
  // client stays a thin view. The `cancelled` flag drops in-flight responses from
  // a previous session (reset or re-init) so stale state can never be resurrected.
  useEffect(() => {
    if (!isInitialized || !agentId) return;

    let cancelled = false;

    const syncAgentState = async () => {
      try {
        const res = await fetch(`/api/agent/state?agentId=${encodeURIComponent(agentId)}`);
        if (cancelled) return;
        if (res.status === 404) {
          // The agent no longer exists server-side (evicted or the server lost
          // its in-memory registry). Drop the session instead of freezing on a
          // stale snapshot.
          resetAgent();
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as BackendAgentInstance;
        if (cancelled) return;

        setConfig(data.config);
        setStatus(data.status as AgentStatus);
        setCurrentActionDetails(data.currentActionDetails);
        setCountdown(data.countdown);
        setSecondsSinceLastScan(data.secondsSinceLastScan);
        setMissionProgress(data.missionProgress);
        setCurrentTaskName(data.currentTaskName);
        setPipelineStats(data.pipelineStats);
        setDiscoveredTopics(data.discoveredTopics);
        setPosts(data.posts);
        setMemoryNodes(data.memoryNodes);
        setDecisions(data.decisions);
        setDiscoveryDecisions(data.discoveryDecisions ?? []);
        setRejectedTodayList(data.rejectedTodayList);
        setSourceHealth(data.sourceHealth ?? []);
        setCandidateQueue(data.candidateQueue ?? []);
        setAgentRuns(data.agentRuns ?? []);
        setScheduledJob(data.scheduledJob ?? null);
        setMemoryEntries(data.memoryEntries ?? []);
        setPublishedPosts(data.publishedPosts ?? []);
        if (data.editorialThresholds) setEditorialThresholds(data.editorialThresholds);
        setActiveTopic(data.activeTopic);
        setPipelineProgress(data.pipelineProgress);
        setLastDecisionTimeSeconds(data.lastDecisionTimeSeconds);
        setAutonomousTimelineLogs(data.autonomousTimelineLogs);
        setNovaLiveFocus(data.novaLiveFocus);
        setNextPublishSeconds(data.nextPublishSeconds);
        setHasLoadedSnapshot(true);
      } catch {
        // Transient network error: keep the last good snapshot.
      }
    };

    syncAgentState();
    const interval = setInterval(syncAgentState, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isInitialized, agentId, resetAgent]);

  const nextPublishCountdown = useMemo(() => {
    const hours = Math.floor(nextPublishSeconds / 3600);
    const minutes = Math.floor((nextPublishSeconds % 3600) / 60);
    const secs = nextPublishSeconds % 60;
    return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  }, [nextPublishSeconds]);

  return (
    <AgentContext.Provider value={{
      config,
      isInitialized,
      agentId,
      initializeAgent,
      resetAgent,
      status,
      currentActionDetails,
      countdown,
      secondsSinceLastScan,
      missionProgress,
      currentTaskName,
      nextPublishCountdown,
      pipelineStats,
      discoveredTopics,
      posts,
      memoryNodes,
      decisions,
      discoveryDecisions,
      rejectedTodayList,
      sourceHealth,
      candidateQueue,
      agentRuns,
      scheduledJob,
      memoryEntries,
      publishedPosts,
      editorialThresholds,
      activeTab,
      setActiveTab,
      activeTopic,
      pipelineProgress,
      lastDecisionTimeSeconds,
      autonomousTimelineLogs,
      novaLiveFocus,
      hasLoadedSnapshot
    }}>
      {children}
    </AgentContext.Provider>
  );
};

export const useAgent = () => {
  const context = useContext(AgentContext);
  if (context === undefined) {
    throw new Error('useAgent must be used within an AgentProvider');
  }
  return context;
};
