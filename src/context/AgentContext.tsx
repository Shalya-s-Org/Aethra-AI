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

// Initial list of rejected topics to display today
const INITIAL_REJECTED_TODAY = [
  { title: "GPT-6 Training Rumors & Speculation", reason: "Source not verified. Clickbait rumor mill." },
  { title: "AI Calendar Scheduling App raising Seed round", reason: "Low engineering impact. Commodity technology wrapper." },
  { title: "Trending AI generated cat meme collection", reason: "Outside editorial policy. Low architectural value." },
  { title: "Commercial cloud provider dashboard UI color redesign", reason: "Rejected news: low-impact product announcement." }
];

// Initial decisions seeded so charts and registries populate immediately
const INITIAL_DECISIONS: Topic[] = [
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

// --- Pipeline simulation primitives -------------------------------------------------

interface PipelineStep {
  status: AgentStatus;
  duration: number; // milliseconds
  desc: string;
}

interface ActiveRun {
  token: number;          // generation counter; a run only advances while its token is current
  topic: Topic;
  steps: PipelineStep[];
  stepIndex: number;
  startedAt: number;      // wall-clock ms of the whole run (drives missionProgress)
  stepStartedAt: number;  // wall-clock ms of the current step (drives pipelineProgress)
  totalDuration: number;  // sum of step durations
}

const BASE_STEPS: PipelineStep[] = [
  { status: 'scanning', duration: 2000, desc: 'Scanning research repositories and developer updates...' },
  { status: 'filtering', duration: 2500, desc: 'Filtering out clickbait / testing credibility scores...' },
  { status: 'reasoning', duration: 3000, desc: 'Running reasoning engine. Evaluating core impact...' },
  { status: 'memory_check', duration: 2500, desc: 'Checking long-term memory for semantic duplication...' }
];

const ACCEPT_STEPS: PipelineStep[] = [
  { status: 'writing', duration: 3500, desc: 'Generating deep technical analysis and opinions...' },
  { status: 'publishing', duration: 2000, desc: 'Logging publication signature and broadcasting...' },
  { status: 'learning', duration: 2000, desc: 'Synthesizing memory nodes and updating knowledge graph...' }
];

const REJECT_STEPS: PipelineStep[] = [
  { status: 'publishing', duration: 2500, desc: 'Logging rejection reasons inside editorial registry...' },
  { status: 'learning', duration: 2000, desc: 'Updating rejection weights and memory vectors...' }
];

function buildSteps(topic: Topic): PipelineStep[] {
  return topic.recommendation === 'Accept'
    ? [...BASE_STEPS, ...ACCEPT_STEPS]
    : [...BASE_STEPS, ...REJECT_STEPS];
}

// --- Provider -----------------------------------------------------------------------

export const AgentProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_CONFIG);
  const [isInitialized, setIsInitialized] = useState<boolean>(false);
  const [agentId, setAgentId] = useState<string>("");
  const [status, setStatus] = useState<AgentStatus>('inactive');
  const [currentActionDetails, setCurrentActionDetails] = useState<string>("Agent offline. Initialize agent parameters to activate.");
  const [countdown, setCountdown] = useState<number>(30); // seconds until the next scan cycle

  // Ticking Telemetry state
  const [secondsSinceLastScan, setSecondsSinceLastScan] = useState<number>(17);
  const [missionProgress, setMissionProgress] = useState<number>(0);
  const [currentTaskName, setCurrentTaskName] = useState<string>("Evaluating OpenAI research");
  const [nextPublishSeconds, setNextPublishSeconds] = useState<number>(5040); // 1h 24m (5040s)

  // Pipeline Load counters matching specified metrics
  const [pipelineStats, setPipelineStats] = useState<PipelineStats>({
    scanCount: 0,
    filterCount: 0,
    reasonCount: 0,
    memoryCount: 0,
    writeCount: 0,
    publishCount: 0
  });

  const [discoveredTopics, setDiscoveredTopics] = useState<Topic[]>([]);
  const [posts, setPosts] = useState<Post[]>(initialPosts);
  const [memoryNodes, setMemoryNodes] = useState<MemoryNode[]>(initialMemory);
  const [decisions, setDecisions] = useState<Topic[]>(INITIAL_DECISIONS);
  const [rejectedTodayList, setRejectedTodayList] = useState(INITIAL_REJECTED_TODAY);

  const [activeTab, setActiveTab] = useState<string>("dashboard");
  const [activeTopic, setActiveTopic] = useState<Topic | null>(null);
  const [pipelineProgress, setPipelineProgress] = useState<number>(0);

  // Latest-value mirrors so stable callbacks always read fresh state
  const postsRef = useRef(posts);
  useEffect(() => { postsRef.current = posts; }, [posts]);
  const countdownRef = useRef(countdown);
  useEffect(() => { countdownRef.current = countdown; }, [countdown]);

  const unprocessedPool = useRef<Topic[]>([...initialTopics]);
  const publishSeqRef = useRef(3); // 1-based; initialPosts already occupy PUB-*-001 and 002

  // Run-loop refs: a single active run is advanced by one progress interval
  const schedulerTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runRef = useRef<ActiveRun | null>(null);
  const runTokenRef = useRef(0); // bumped on every start/cancel; invalidates stale work

  // --- Pipeline state machine --------------------------------------------------------

  const stopProgress = useCallback(() => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    progressTimerRef.current = null;
  }, []);

  // Cancel the in-flight run: stale ticks are also rejected by the token check.
  const cancelRun = useCallback(() => {
    runTokenRef.current++;
    runRef.current = null;
    stopProgress();
  }, [stopProgress]);

  // Enter a step: set status/details and apply its stat adjustments.
  const applyStep = useCallback((run: ActiveRun, index: number) => {
    const step = run.steps[index];
    setStatus(step.status);
    setCurrentActionDetails(step.desc);
    setPipelineProgress(0);

    const { topic } = run;
    if (step.status === 'filtering' && topic.recommendation === 'Reject') {
      setPipelineStats(prev => ({ ...prev, filterCount: prev.filterCount + 1 }));
      setRejectedTodayList(prev => [
        { title: topic.title, reason: topic.rejectionReason || "Low engineering impact" },
        ...prev
      ]);
    }
    if (step.status === 'reasoning') {
      setPipelineStats(prev => ({ ...prev, reasonCount: prev.reasonCount + 1 }));
    }
    if (step.status === 'memory_check' && topic.category === 'Duplicate') {
      setPipelineStats(prev => ({ ...prev, memoryCount: prev.memoryCount + 1 }));
    }
    if (step.status === 'writing' && topic.recommendation === 'Accept') {
      setPipelineStats(prev => ({ ...prev, writeCount: prev.writeCount + 1 }));
    }
    if (step.status === 'publishing' && topic.recommendation === 'Accept') {
      setPipelineStats(prev => ({ ...prev, publishCount: prev.publishCount + 1 }));
    }
  }, []);

  // Commit the run's results once every step has elapsed.
  const finishRun = useCallback((run: ActiveRun) => {
    stopProgress();
    runRef.current = null;

    setStatus('idle');
    setCurrentActionDetails("System monitoring streams. Next scan cycle in 30s.");
    setActiveTopic(null);
    setPipelineProgress(0);
    setMissionProgress(0);
    setCurrentTaskName("Monitoring trusted AI sources");

    setDecisions(prev => [run.topic, ...prev]);

    if (run.topic.recommendation === 'Accept') {
      // Sequence-based publication ID, so two runs can never mint the same PUB-* id.
      const pubId = `PUB-${new Date().getFullYear()}-${String(publishSeqRef.current++).padStart(3, '0')}`;

      const newPost: Post = {
        id: generateUUID('post'),
        createdAt: new Date().toISOString(),
        title: run.topic.title,
        text: run.topic.detailedAnalysis || "Technical analysis in progress...",
        rationale: `Highly relevant architecture development in ${run.topic.category}. Importance scored at ${run.topic.importanceScore}/100.`,
        opinion: run.topic.opinion || "No editorial notes provided.",
        sources: run.topic.sources,
        confidenceScore: run.topic.confidenceScore,
        category: run.topic.category,
        importanceScore: run.topic.importanceScore,
        noveltyScore: run.topic.noveltyScore,
        relatedPosts: postsRef.current.slice(0, 1).map(p => p.title),
        publicationId: pubId
      };
      setPosts(prev => [newPost, ...prev]);

      // Grow the knowledge graph with a topic <-> opinion node pair
      const nodeTopicId = generateUUID('mem-topic');
      const nodeOpinionId = generateUUID('mem-opinion');
      const newNodes: MemoryNode[] = [
        {
          id: nodeTopicId,
          label: run.topic.title.split(" ")[0],
          group: 'topic',
          details: `${run.topic.title}. Published in ${pubId}.`,
          connections: [nodeOpinionId],
          timestamp: new Date().toISOString()
        },
        {
          id: nodeOpinionId,
          label: `Heuristics: ${run.topic.category}`,
          group: 'opinion',
          details: run.topic.opinion || "",
          connections: [nodeTopicId],
          timestamp: new Date().toISOString()
        }
      ];
      setMemoryNodes(prev => [...newNodes, ...prev]);
    }
  }, [stopProgress]);

  // Advance the run based on wall-clock time (runs every 100ms while active).
  const tickProgress = useCallback(() => {
    const run = runRef.current;
    if (!run || run.token !== runTokenRef.current) return; // cancelled

    const step = run.steps[run.stepIndex];
    const elapsed = Date.now() - run.stepStartedAt;

    if (elapsed >= step.duration) {
      if (run.stepIndex === run.steps.length - 1) {
        finishRun(run);
        return;
      }
      run.stepIndex += 1;
      run.stepStartedAt = Date.now();
      applyStep(run, run.stepIndex);
    }

    setPipelineProgress(Math.min(100, (elapsed / step.duration) * 100));
    setMissionProgress(Math.min(100, Math.round(((Date.now() - run.startedAt) / run.totalDuration) * 100)));
  }, [applyStep, finishRun]);

  // Start one autonomous run. Guarded so runs never overlap.
  const startRun = useCallback(() => {
    if (runRef.current) return;

    if (unprocessedPool.current.length === 0) {
      unprocessedPool.current = [...initialTopics].map(t => ({
        ...t,
        id: generateUUID(`topic-${t.id}`)
      }));
    }
    const topic = unprocessedPool.current.shift();
    if (!topic) return;

    const steps = buildSteps(topic);
    const run: ActiveRun = {
      token: ++runTokenRef.current,
      topic,
      steps,
      stepIndex: 0,
      startedAt: Date.now(),
      stepStartedAt: Date.now(),
      totalDuration: steps.reduce((sum, s) => sum + s.duration, 0)
    };
    runRef.current = run;

    setCountdown(30); // hold the trigger above zero while the run is in flight
    setActiveTopic(topic);
    setDiscoveredTopics(prev => [topic, ...prev].slice(0, 30));
    setSecondsSinceLastScan(0);
    setCurrentTaskName(`Evaluating ${topic.title.slice(0, 30)}...`);
    setPipelineStats(prev => ({ ...prev, scanCount: prev.scanCount + 1 }));

    applyStep(run, 0);
    progressTimerRef.current = setInterval(tickProgress, 100);
  }, [applyStep, tickProgress]);

  // --- Scheduler: 1s ticks for countdown + telemetry, and run triggering ------------

  useEffect(() => {
    if (!isInitialized) return;

    schedulerTimerRef.current = setInterval(() => {
      // Countdown only runs while idle; reaching zero kicks the next autonomous run.
      if (status === 'idle') {
        if (countdownRef.current <= 0) {
          startRun();
        } else {
          setCountdown(prev => Math.max(0, prev - 1));
        }
      }

      // Ticking telemetry counters
      setSecondsSinceLastScan(prev => prev + 1);
      setNextPublishSeconds(prev => (prev <= 1 ? 5040 : prev - 1));
    }, 1000);

    return () => {
      if (schedulerTimerRef.current) clearInterval(schedulerTimerRef.current);
    };
  }, [isInitialized, status, startRun]);

  // Cancel any in-flight run when the provider unmounts
  useEffect(() => () => cancelRun(), [cancelRun]);

  // --- Lifecycle helpers -------------------------------------------------------------

  const nextPublishCountdown = React.useMemo(() => {
    const hours = Math.floor(nextPublishSeconds / 3600);
    const minutes = Math.floor((nextPublishSeconds % 3600) / 60);
    const secs = nextPublishSeconds % 60;
    return `${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(secs).padStart(2, '0')}s`;
  }, [nextPublishSeconds]);

  const initializeAgent = (newConfig: AgentConfig) => {
    // Cancel any in-flight run (e.g. Settings > Commit Settings while active)
    // so its stale steps can't write into the new session.
    cancelRun();

    setConfig(newConfig);
    const cleanName = newConfig.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    setAgentId(`agent-${cleanName}-${Date.now()}`);
    setIsInitialized(true);
    setStatus('idle');
    setCurrentActionDetails("Dr. Nova has initialized core heuristics. Activating autonomous sensors...");
    setCountdown(5);
  };

  const resetAgent = () => {
    cancelRun();
    publishSeqRef.current = 3; // initialPosts occupy PUB-*-001/002

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
