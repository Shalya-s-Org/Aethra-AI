"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { Topic, Post, MemoryNode } from '../data/mockTopics';

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
  
  const [pipelineStats, setPipelineStats] = useState<PipelineStats>({
    scanCount: 0,
    filterCount: 0,
    reasonCount: 0,
    memoryCount: 0,
    writeCount: 0,
    publishCount: 0
  });

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
  const [novaLiveFocus, setNovaLiveFocus] = useState({
    focus: "Observing AI Ecosystem",
    goal: "Ingest live research datasets",
    reasoning: "Monitoring arXiv, GitHub, and major blogs",
    estimatedCompletionSeconds: 0
  });

  // Dynamic Polling Loop to sync dashboard state from server-side autonomous agent loops
  useEffect(() => {
    if (!isInitialized || !agentId) return;

    const syncAgentState = async () => {
      try {
        const res = await fetch(`/api/agent/state?agentId=${agentId}`);
        if (!res.ok) return;
        const data = await res.json();

        // Map backend states to context
        setConfig({
          name: data.config.name,
          role: data.config.role,
          domain: data.config.domain,
          mission: data.config.mission,
          frequency: data.config.frequency,
          style: data.config.style
        });
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
        setNextPublishSeconds(data.nextPublishSeconds || 900);
      } catch (err) {
        console.error("Failed to sync agent state from backend:", err);
      }
    };

    // Initial sync
    syncAgentState();
    // Poll every 1.5 seconds
    const interval = setInterval(syncAgentState, 1500);

    return () => clearInterval(interval);
  }, [isInitialized, agentId]);

  // Helper formatting next publication countdown timer
  const nextPublishCountdown = React.useMemo(() => {
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
        body: JSON.stringify({
          persona: {
            name: newConfig.name,
            domain: newConfig.domain,
            role: newConfig.role,
            mission: newConfig.mission,
            frequency: newConfig.frequency,
            style: newConfig.style
          }
        })
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
    setPipelineStats({
      scanCount: 0,
      filterCount: 0,
      reasonCount: 0,
      memoryCount: 0,
      writeCount: 0,
      publishCount: 0
    });
    setDiscoveredTopics([]);
    setPosts([]);
    setMemoryNodes([]);
    setDecisions([]);
    setRejectedTodayList([]);
    setActiveTopic(null);
    setPipelineProgress(0);
    setLastDecisionTimeSeconds(0);
    setAutonomousTimelineLogs([]);
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
