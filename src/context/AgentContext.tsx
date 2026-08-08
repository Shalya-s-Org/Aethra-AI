"use client";

import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
import type { Topic, Post, MemoryNode } from '../data/mockTopics';
import type { BackendAgentInstance } from '../utils/agentEngine';

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

interface AgentContextType {
  // Config
  config: AgentConfig;
  isInitialized: boolean;
  agentId: string;
  initializeAgent: (config: AgentConfig) => Promise<void>;
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
  rejectedTodayList: Array<{ title: string; reason: string }>;

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
  const [rejectedTodayList, setRejectedTodayList] = useState<Array<{ title: string; reason: string }>>([]);

  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [activeTopic, setActiveTopic] = useState<Topic | null>(null);
  const [pipelineProgress, setPipelineProgress] = useState<number>(0);

  const [lastDecisionTimeSeconds, setLastDecisionTimeSeconds] = useState<number>(0);
  const [autonomousTimelineLogs, setAutonomousTimelineLogs] = useState<Array<{ timestamp: string; message: string }>>([]);
  const [novaLiveFocus, setNovaLiveFocus] = useState(DEFAULT_FOCUS);

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
        if (!res.ok || cancelled) return;
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
        setRejectedTodayList(data.rejectedTodayList);
        setActiveTopic(data.activeTopic);
        setPipelineProgress(data.pipelineProgress);
        setLastDecisionTimeSeconds(data.lastDecisionTimeSeconds);
        setAutonomousTimelineLogs(data.autonomousTimelineLogs);
        setNovaLiveFocus(data.novaLiveFocus);
        setNextPublishSeconds(data.nextPublishSeconds);
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
  }, [isInitialized, agentId]);

  const nextPublishCountdown = useMemo(() => {
    const hours = Math.floor(nextPublishSeconds / 3600);
    const minutes = Math.floor((nextPublishSeconds % 3600) / 60);
    const secs = nextPublishSeconds % 60;
    return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  }, [nextPublishSeconds]);

  const initializeAgent = async (newConfig: AgentConfig) => {
    try {
      const res = await fetch('/api/agent/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona: { ...newConfig } })
      });
      if (!res.ok) throw new Error("Backend initialization failed");
      const data = await res.json();

      setAgentId(data.agentId);
      setConfig(newConfig);
      setIsInitialized(true);
      setStatus('idle');
      setCurrentActionDetails("Agent initialized. Backend autonomous cycles online.");
    } catch (err) {
      console.error("Could not register agent session on server:", err);
    }
  };

  const resetAgent = () => {
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
    setActiveTopic(null);
    setPipelineProgress(0);
    setLastDecisionTimeSeconds(0);
    setAutonomousTimelineLogs([]);
    setNovaLiveFocus(DEFAULT_FOCUS);
  };

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
      rejectedTodayList,
      activeTab,
      setActiveTab,
      activeTopic,
      pipelineProgress,
      lastDecisionTimeSeconds,
      autonomousTimelineLogs,
      novaLiveFocus
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
