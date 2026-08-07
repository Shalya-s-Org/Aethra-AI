"use client";

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Topic, Post, MemoryNode, initialTopics, initialPosts, initialMemory } from '../data/mockTopics';

// Helper function to generate guaranteed unique IDs
const generateUUID = (prefix: string): string => {
  if (typeof window !== 'undefined' && window.crypto && typeof window.crypto.randomUUID === 'function') {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  const randomSuffix = Math.random().toString(36).substring(2, 9);
  return `${prefix}-${Date.now()}-${randomSuffix}`;
};

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
  initializeAgent: (config: AgentConfig) => void;
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
}

const AgentContext = createContext<AgentContextType | undefined>(undefined);

const DEFAULT_CONFIG: AgentConfig = {
  name: "Dr. Nova",
  role: "AI Systems Architect & Technology Analyst",
  domain: "AI Engineering, Infrastructure, Security, Open Source, Agentic Systems",
  mission: "Publish only developments that materially impact AI engineering, production systems, security, infrastructure, open source, agentic AI, RAG, MCP, LLMs and AI deployment.",
  frequency: "30",
  style: "Professional, Analytical, Evidence-based, Opinionated, Concise, Calm, Highly Technical"
};

// Initial list of rejected topics to display today
const INITIAL_REJECTED_TODAY = [
  { title: "GPT-6 Training Rumors & Speculation", reason: "Source not verified. Clickbait rumor mill." },
  { title: "AI Calendar Scheduling App raising Seed round", reason: "Low engineering impact. Commodity technology wrapper." },
  { title: "Trending AI generated cat meme collection", reason: "Outside editorial policy. Low architectural value." },
  { title: "Commercial cloud provider dashboard UI color redesign", reason: "Rejected news: low-impact product announcement." }
];

export const AgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_CONFIG);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [agentId, setAgentId] = useState<string>("");
  const [status, setStatus] = useState<AgentStatus>('inactive');
  const [currentActionDetails, setCurrentActionDetails] = useState<string>("Agent offline. Initialize agent parameters to activate.");
  const [countdown, setCountdown] = useState<number>(30); // Demo interval trigger
  
  // Ticking Telemetry state
  const [secondsSinceLastScan, setSecondsSinceLastScan] = useState<number>(17);
  const [missionProgress, setMissionProgress] = useState<number>(0);
  const [currentTaskName, setCurrentTaskName] = useState<string>("Evaluating OpenAI research");
  const [nextPublishSeconds, setNextPublishSeconds] = useState<number>(5040); // 1h 24m (5040s)
  
  // Pipeline Load counters matching specified metrics
  const [pipelineStats, setPipelineStats] = useState<PipelineStats>({
    scanCount: 89,
    filterCount: 61,
    reasonCount: 18,
    memoryCount: 3,
    writeCount: 2,
    publishCount: 1
  });

  const [discoveredTopics, setDiscoveredTopics] = useState<Topic[]>([]);
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [memoryNodes, setMemoryNodes] = useState<MemoryNode[]>(initialMemory);
  const [decisions, setDecisions] = useState<Topic[]>([]);
  const [rejectedTodayList, setRejectedTodayList] = useState(INITIAL_REJECTED_TODAY);
  
  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [activeTopic, setActiveTopic] = useState<Topic | null>(null);
  const [pipelineProgress, setPipelineProgress] = useState<number>(0);
  
  const unprocessedPool = useRef<Topic[]>([]);
  const countdownTimerRef = useRef<NodeJS.Timeout | null>(null);
  const telemetryTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Initialize pool of data
  useEffect(() => {
    unprocessedPool.current = [...initialTopics];
    
    // Set some initial decisions to populate charts right away
    const initialDecisions: Topic[] = [
      {
        id: "dec-1",
        title: "Anthropic Releases Model Context Protocol (MCP) as Open Standard",
        source: "Anthropic Research Blog",
        category: "Agentic AI",
        credibilityScore: 98,
        trendScore: 95,
        freshness: "3h ago",
        recommendation: "Accept",
        noveltyScore: 92,
        importanceScore: 96,
        confidenceScore: 95,
        sources: ["anthropic.com/news/model-context-protocol"]
      },
      {
        id: "dec-2",
        title: "AI Calendar App 'ScheduleFlow' Raises $45M Seed Round",
        source: "TechCrunch",
        category: "Marketing/Hype",
        credibilityScore: 85,
        trendScore: 72,
        freshness: "3h ago",
        recommendation: "Reject",
        rejectionReason: "Fails Nova's criteria of Material Systems Innovation. The announcement focuses on business fundraising and generic wrapper technology rather than core AI systems architecture, engineering advancements, or infrastructure improvements.",
        noveltyScore: 12,
        importanceScore: 20,
        confidenceScore: 90,
        sources: ["techcrunch.com/scheduleflow-raises-seed"]
      },
      {
        id: "dec-3",
        title: "DeepSeek-V3 Architecture Deep-Dive: Multi-Head Latent Attention (MLA)",
        source: "DeepSeek Research Team",
        category: "LLMs & Hardware",
        credibilityScore: 99,
        trendScore: 98,
        freshness: "12h ago",
        recommendation: "Accept",
        noveltyScore: 96,
        importanceScore: 98,
        confidenceScore: 97,
        sources: ["github.com/deepseek-ai/DeepSeek-V3"]
      },
      {
        id: "dec-4",
        title: "Google AI Announces 'SmartCook' - AI Recipes from Fridge Photos",
        source: "Google PR Wire",
        category: "Marketing/Hype",
        credibilityScore: 90,
        trendScore: 92,
        freshness: "14h ago",
        recommendation: "Reject",
        rejectionReason: "Rejected as consumer marketing hype. While demonstrating competent computer vision, 'SmartCook' represents a consumer wrapper application with zero infrastructure novelty, hardware breakthroughs, or systemic implications for enterprise AI systems.",
        noveltyScore: 8,
        importanceScore: 15,
        confidenceScore: 95,
        sources: ["google.com/press/smartcook"]
      }
    ];
    setDecisions(initialDecisions);
  }, []);

  const runAutonomousStep = useCallback(async () => {
    if (unprocessedPool.current.length === 0) {
      unprocessedPool.current = [...initialTopics].map(t => ({
        ...t,
        id: generateUUID(`topic-${t.id}`)
      }));
    }

    const currentTopic = unprocessedPool.current.shift();
    if (!currentTopic) return;

    setActiveTopic(currentTopic);
    setDiscoveredTopics(prev => [currentTopic, ...prev].slice(0, 30));
    setSecondsSinceLastScan(0); // Reset scan time
    setCurrentTaskName(`Evaluating ${currentTopic.title.slice(0, 30)}...`);

    // Increment scan counts
    setPipelineStats(prev => ({ ...prev, scanCount: prev.scanCount + 1 }));

    // Simulation steps duration mapping
    const steps = [
      { status: 'scanning' as AgentStatus, duration: 2000, desc: `Scanning research repositories and developer updates...` },
      { status: 'filtering' as AgentStatus, duration: 2500, desc: `Filtering out clickbait / testing credibility scores...` },
      { status: 'reasoning' as AgentStatus, duration: 3000, desc: `Running reasoning engine. Evaluating core impact...` },
      { status: 'memory_check' as AgentStatus, duration: 2500, desc: `Checking long-term memory for semantic duplication...` }
    ];

    if (currentTopic.recommendation === 'Accept') {
      steps.push(
        { status: 'writing' as AgentStatus, duration: 3500, desc: `Generating deep technical analysis and opinions...` },
        { status: 'publishing' as AgentStatus, duration: 2000, desc: `Logging publication signature and broadcasting...` },
        { status: 'learning' as AgentStatus, duration: 2000, desc: `Synthesizing memory nodes and updating knowledge graph...` }
      );
    } else {
      steps.push(
        { status: 'publishing' as AgentStatus, duration: 2500, desc: `Logging rejection reasons inside editorial registry...` },
        { status: 'learning' as AgentStatus, duration: 2000, desc: `Updating rejection weights and memory vectors...` }
      );
    }

    // Sequentially step through stages
    let cumulativeTime = 0;
    const totalDuration = steps.reduce((sum, s) => sum + s.duration, 0);

    for (const step of steps) {
      setTimeout(() => {
        setStatus(step.status);
        setCurrentActionDetails(step.desc);
        setPipelineProgress(0);

        // Stats adjustments as the pipeline executes
        if (step.status === 'filtering' && currentTopic.recommendation === 'Reject') {
          setPipelineStats(prev => ({ ...prev, filterCount: prev.filterCount + 1 }));
          setRejectedTodayList(prev => [
            { title: currentTopic.title, reason: currentTopic.rejectionReason || "Low engineering impact" },
            ...prev
          ]);
        }
        if (step.status === 'reasoning') {
          setPipelineStats(prev => ({ ...prev, reasonCount: prev.reasonCount + 1 }));
        }
        if (step.status === 'memory_check' && currentTopic.category === 'Duplicate') {
          setPipelineStats(prev => ({ ...prev, memoryCount: prev.memoryCount + 1 }));
        }
        if (step.status === 'writing' && currentTopic.recommendation === 'Accept') {
          setPipelineStats(prev => ({ ...prev, writeCount: prev.writeCount + 1 }));
        }
        if (step.status === 'publishing' && currentTopic.recommendation === 'Accept') {
          setPipelineStats(prev => ({ ...prev, publishCount: prev.publishCount + 1 }));
        }

        // Inside-step progress bar loader
        let tick = 0;
        const tickInterval = setInterval(() => {
          tick += 10;
          setPipelineProgress(Math.min(tick, 100));
        }, step.duration / 10);

        setTimeout(() => clearInterval(tickInterval), step.duration);
      }, cumulativeTime);

      cumulativeTime += step.duration;
    }

    // Set overall task progress ticker (lasts the length of cumulativeTime)
    let overallTick = 0;
    const overallInterval = setInterval(() => {
      overallTick += 1.5;
      setMissionProgress(Math.min(Math.round(overallTick), 100));
    }, cumulativeTime / 66);

    setTimeout(() => clearInterval(overallInterval), cumulativeTime);

    // Apply database updates at the end of loop
    setTimeout(() => {
      setStatus('idle');
      setCurrentActionDetails("System monitoring streams. Next scan cycle in 30s.");
      setActiveTopic(null);
      setPipelineProgress(0);
      setMissionProgress(0);
      setCurrentTaskName("Monitoring trusted AI sources");

      setDecisions(prev => [currentTopic, ...prev]);

      if (currentTopic.recommendation === 'Accept') {
        const pubId = `PUB-${new Date().getFullYear()}-${String(posts.length + 1).padStart(3, '0')}`;
        
        let newPostId = generateUUID('post');
        // Optional safety check: check whether an identical ID already exists, regenerate if so
        while (posts.some(p => p.id === newPostId)) {
          newPostId = generateUUID('post');
        }

        const newPost: Post = {
          id: newPostId,
          createdAt: new Date().toISOString(),
          title: currentTopic.title,
          text: currentTopic.detailedAnalysis || "Technical analysis in progress...",
          rationale: `Highly relevant architecture development in ${currentTopic.category}. Importance scored at ${currentTopic.importanceScore}/100.`,
          opinion: currentTopic.opinion || "No editorial notes provided.",
          sources: currentTopic.sources,
          confidenceScore: currentTopic.confidenceScore,
          category: currentTopic.category,
          importanceScore: currentTopic.importanceScore,
          noveltyScore: currentTopic.noveltyScore,
          relatedPosts: posts.slice(0, 1).map(p => p.title),
          publicationId: pubId
        };

        setPosts(prev => [newPost, ...prev]);

        // Create specific graph connections to represent OpenAI -> GPT-5 -> Reasoning -> MCP -> RAG -> Security -> Inference
        const nodeTopicId = generateUUID('mem-topic');
        const nodeOpinionId = generateUUID('mem-opinion');

        const newNodes: MemoryNode[] = [
          {
            id: nodeTopicId,
            label: currentTopic.title.split(" ")[0],
            group: 'topic',
            details: `${currentTopic.title}. Published in ${pubId}.`,
            connections: [nodeOpinionId],
            timestamp: new Date().toISOString()
          },
          {
            id: nodeOpinionId,
            label: `Heuristics: ${currentTopic.category}`,
            group: 'opinion',
            details: currentTopic.opinion || "",
            connections: [nodeTopicId],
            timestamp: new Date().toISOString()
          }
        ];

        setMemoryNodes(prev => [...newNodes, ...prev]);
      }

      setCountdown(30);
    }, cumulativeTime);

  }, [posts.length]);

  // Timers: Runs every second
  useEffect(() => {
    if (!isInitialized) return;

    // Tick countdown to scan
    countdownTimerRef.current = setInterval(() => {
      // Pause countdown ticks if Dr. Nova is actively auditing/writing/publishing
      if (status !== 'idle') return;

      setCountdown(prev => {
        if (prev <= 1) {
          runAutonomousStep();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    // Ticking telemetry counters
    telemetryTimerRef.current = setInterval(() => {
      // 1. Seconds since last scan ticks up
      setSecondsSinceLastScan(prev => prev + 1);

      // 2. Next publishing ticks down
      setNextPublishSeconds(prev => (prev <= 1 ? 5040 : prev - 1));
    }, 1000);

    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
      if (telemetryTimerRef.current) clearInterval(telemetryTimerRef.current);
    };
  }, [isInitialized, status, runAutonomousStep]);

  // Helper formatting for seconds to 01h 24m 17s
  const nextPublishCountdown = React.useMemo(() => {
    const hours = Math.floor(nextPublishSeconds / 3600);
    const minutes = Math.floor((nextPublishSeconds % 3600) / 60);
    const secs = nextPublishSeconds % 60;
    return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  }, [nextPublishSeconds]);

  const initializeAgent = (newConfig: AgentConfig) => {
    setConfig(newConfig);
    const cleanName = newConfig.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const generatedAgentId = `agent-${cleanName}-${Date.now()}`;
    setAgentId(generatedAgentId);
    setIsInitialized(true);
    setStatus('idle');
    setCurrentActionDetails("Dr. Nova has initialized core heuristics. Activating autonomous sensors...");
    setCountdown(5);
  };

  const resetAgent = () => {
    setIsInitialized(false);
    setAgentId("");
    setStatus('inactive');
    setCurrentActionDetails("Agent offline. Initialize agent parameters to activate.");
    setCountdown(30);
    setSecondsSinceLastScan(17);
    setMissionProgress(0);
    setNextPublishSeconds(5040);
    setPipelineStats({
      scanCount: 89,
      filterCount: 61,
      reasonCount: 18,
      memoryCount: 3,
      writeCount: 2,
      publishCount: 1
    });
    setDiscoveredTopics([]);
    setPosts(initialPosts);
    setMemoryNodes(initialMemory);
    setDecisions([]);
    setRejectedTodayList(INITIAL_REJECTED_TODAY);
    setActiveTopic(null);
    setPipelineProgress(0);
    unprocessedPool.current = [...initialTopics];
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
      pipelineProgress
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
