"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { useAgent } from '../../context/AgentContext';
import { GlassCard } from '../ui/GlassCard';
import { PipelineVisualizer } from './PipelineVisualizer';
import { 
  Search, Filter, Cpu, Database, Award, ShieldAlert, 
  TrendingUp, Clock, FileText, ChevronRight, Zap, Play, 
  CheckCircle2, Star, User, AlertCircle, XCircle, RefreshCw, X 
} from 'lucide-react';
import { AreaChart, Area, ResponsiveContainer } from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../utils/cn';
import { Topic, Post } from '../../data/mockTopics';

export const DashboardOverview: React.FC = () => {
  const { 
    posts, 
    memoryNodes, 
    decisions, 
    countdown,
    status,
    secondsSinceLastScan,
    missionProgress,
    currentTaskName,
    nextPublishCountdown,
    pipelineStats,
    rejectedTodayList
  } = useAgent();

  const [selectedPostForDrawer, setSelectedPostForDrawer] = useState<Post | null>(null);
  const [liveThinkingIndex, setLiveThinkingIndex] = useState(0);

  // Estimate completion seconds based on progress
  const estCompletion = useMemo(() => {
    if (status === 'idle' || status === 'inactive') return "N/A";
    const remSeconds = Math.max(1, Math.round((100 - missionProgress) * 0.2));
    return `${remSeconds} seconds`;
  }, [status, missionProgress]);

  // Stage details string mapping
  const reasoningStage = useMemo(() => {
    switch (status) {
      case 'scanning': return "Source Ingestion & Registry Ingress";
      case 'filtering': return "Credibility Scan & Noise Filtration";
      case 'reasoning': return "Heuristic Scoring & Impact Analysis";
      case 'memory_check': return "Memory Comparison";
      case 'writing': return "Synthesizing Architecture Report";
      case 'publishing': return "Signing Blocks & Feed Serialization";
      case 'learning': return "Commit to Vector Index & Graph Growth";
      default: return "Idle Monitoring";
    }
  }, [status]);

  // Helper to determine if a decision flow block is active
  const isFlowActive = (blockName: string) => {
    switch (blockName) {
      case 'scanning': return status === 'scanning';
      case 'filtering': return status === 'filtering';
      case 'reasoning': return status === 'reasoning';
      case 'writing': return status === 'writing' || status === 'memory_check';
      case 'publishing': return status === 'publishing';
      case 'learning': return status === 'learning';
      default: return false;
    }
  };

  // Top metrics
  const editorialMetrics = useMemo(() => {
    return [
      {
        title: "Topics Discovered Today",
        value: `${pipelineStats.scanCount} Topics`,
        subtitle: "Collected from trusted AI sources",
        icon: <Search className="w-5 h-5 text-blue-400" />,
        glow: "cyan" as const
      },
      {
        title: "Editorial Acceptance",
        value: "61%",
        subtitle: "Topics worthy of publication",
        icon: <TrendingUp className="w-5 h-5 text-cyber-cyan" />,
        glow: "cyan" as const
      },
      {
        title: "Knowledge Memory",
        value: `${pipelineStats.publishCount + 137} Articles`,
        subtitle: "Historical publications remembered",
        icon: <Database className="w-5 h-5 text-cyber-purple" />,
        glow: "purple" as const
      },
      {
        title: "Publishing Confidence",
        value: "93%",
        subtitle: "Confidence before publishing",
        icon: <Award className="w-5 h-5 text-cyber-emerald" />,
        glow: "emerald" as const
      }
    ];
  }, [pipelineStats]);

  // Live Thinking Messages
  const thinkingMessages = [
    "Evaluating DeepSeek MLA token optimizations...",
    "Querying vector database for duplicate article collisions...",
    "Comparing candidate topics against previous 18 publications...",
    "Ranking candidate queues according to structural engineering impact...",
    "Writing detailed architecture summaries and editorial opinions...",
    "Scanning research feeds (arXiv, GitHub labs, OpenAI)...",
    "Waiting for next autonomous ingestion sweep..."
  ];

  useEffect(() => {
    const interval = setInterval(() => {
      setLiveThinkingIndex(prev => (prev + 1) % thinkingMessages.length);
    }, 4500);
    return () => clearInterval(interval);
  }, []);

  // Static / dynamic candidate topics (8-10 topics)
  const candidateTopics: Topic[] = useMemo(() => {
    return [
      {
        id: "cand-1",
        title: "Anthropic Releases Model Context Protocol (MCP)",
        source: "Anthropic Blog",
        category: "Agentic AI",
        credibilityScore: 98,
        trendScore: 95,
        freshness: "3m ago",
        recommendation: "Accept",
        noveltyScore: 92,
        importanceScore: 96,
        confidenceScore: 95,
        sources: ["anthropic.com"]
      },
      {
        id: "cand-2",
        title: "Evaluating GPT-5 spec reasoning thresholds and latency benchmarks",
        source: "arXiv Paper",
        category: "LLMs & Hardware",
        credibilityScore: 92,
        trendScore: 89,
        freshness: "12m ago",
        recommendation: "Investigate",
        noveltyScore: 88,
        importanceScore: 90,
        confidenceScore: 87,
        sources: ["arxiv.org"]
      },
      {
        id: "cand-3",
        title: "Prompt injection vulnerabilities in hybrid vector metadata indexes",
        source: "arXiv Paper",
        category: "Security & Align",
        credibilityScore: 96,
        trendScore: 82,
        freshness: "24m ago",
        recommendation: "Accept",
        noveltyScore: 89,
        importanceScore: 91,
        confidenceScore: 93,
        sources: ["arxiv.org"]
      },
      {
        id: "cand-4",
        title: "xyz Startup raises $50M to disrupt scheduling widgets",
        source: "TechCrunch",
        category: "Marketing/Hype",
        credibilityScore: 85,
        trendScore: 70,
        freshness: "45m ago",
        recommendation: "Reject",
        rejectionReason: "Rejected because this is consumer marketing news rather than AI engineering.",
        noveltyScore: 15,
        importanceScore: 20,
        confidenceScore: 90,
        sources: ["techcrunch.com"]
      },
      {
        id: "cand-5",
        title: "Speculative rumors regarding GPT-6 training runs on Reddit",
        source: "Reddit Sub",
        category: "Duplicate",
        credibilityScore: 68,
        trendScore: 78,
        freshness: "1h ago",
        recommendation: "Reject",
        rejectionReason: "Rejected due to unverified source guidelines and low credibility thresholds.",
        noveltyScore: 40,
        importanceScore: 50,
        confidenceScore: 60,
        sources: ["reddit.com"]
      },
      {
        id: "cand-6",
        title: "AI-powered coffee makers announced at consumer show",
        source: "Press Release",
        category: "Marketing/Hype",
        credibilityScore: 80,
        trendScore: 65,
        freshness: "2h ago",
        recommendation: "Reject",
        rejectionReason: "Rejected because this is consumer product announcements rather than system architecture.",
        noveltyScore: 10,
        importanceScore: 15,
        confidenceScore: 85,
        sources: ["ces.org"]
      },
      {
        id: "cand-7",
        title: "Speculative KV cache pruning paper for long context retrieval",
        source: "HuggingFace Papers",
        category: "RAG & Data",
        credibilityScore: 94,
        trendScore: 80,
        freshness: "2h ago",
        recommendation: "Investigate",
        noveltyScore: 85,
        importanceScore: 88,
        confidenceScore: 89,
        sources: ["huggingface.co"]
      },
      {
        id: "cand-8",
        title: "DeepSpeed-MoE upgrades achieving nvlink hardware routing",
        source: "GitHub Commits",
        category: "Infrastructure",
        credibilityScore: 97,
        trendScore: 85,
        freshness: "3h ago",
        recommendation: "Accept",
        noveltyScore: 91,
        importanceScore: 94,
        confidenceScore: 95,
        sources: ["github.com/microsoft"]
      },
      {
        id: "cand-9",
        title: "Yet another wrapper chatbot builder launching on ProductHunt",
        source: "ProductHunt",
        category: "Marketing/Hype",
        credibilityScore: 75,
        trendScore: 50,
        freshness: "4h ago",
        recommendation: "Reject",
        rejectionReason: "Rejected because this is a commodity wrapper application with no core innovation.",
        noveltyScore: 5,
        importanceScore: 10,
        confidenceScore: 80,
        sources: ["producthunt.com"]
      }
    ];
  }, []);

  return (
    <div className="space-y-6">
      {/* Live Thinking Status Ticker */}
      <div className="bg-black/60 border border-cyber-cyan/20 px-4 py-2.5 rounded-lg flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyber-cyan opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyber-cyan"></span>
          </span>
          <span className="font-display font-semibold uppercase tracking-wider text-cyber-cyan">Aethra Thought Stream:</span>
          <motion.span 
            key={liveThinkingIndex}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="text-gray-300 font-mono"
          >
            {thinkingMessages[liveThinkingIndex]}
          </motion.span>
        </div>
        <div className="text-[10px] text-gray-500 font-mono">
          STATUS: ANALYZING
        </div>
      </div>

      {/* 1. Live Activity Hero Banner */}
      <div className="bg-gradient-to-r from-cyber-cyan/15 via-cyber-purple/5 to-transparent border border-cyber-cyan/20 rounded-xl p-6 relative overflow-hidden">
        <div className="absolute right-4 bottom-2 opacity-5 font-mono text-[80px] text-cyber-cyan pointer-events-none select-none font-bold uppercase tracking-widest leading-none">
          Autonomous
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
          <div className="lg:col-span-2 space-y-3">
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full border border-cyber-cyan/35 bg-cyber-cyan/10 text-cyber-cyan font-mono text-[9px] tracking-wider uppercase font-semibold">
              <Zap className="w-3 h-3 text-cyan-400 animate-pulse" />
              Active Reasoning Loop
            </div>
            
            <div>
              <h2 className="font-display text-[10px] text-gray-500 uppercase tracking-widest font-mono">
                Current Mission
              </h2>
              <p className="font-display text-base font-bold text-white tracking-wide uppercase mt-1">
                {status !== 'idle' && status !== 'inactive' ? currentTaskName : "Evaluating OpenAI's GPT-5 reasoning thresholds"}
              </p>
            </div>

            {status !== 'idle' && status !== 'inactive' ? (
              <div className="space-y-1.5">
                <div className="flex justify-between font-mono text-[9px] text-gray-400">
                  <span>Logic Sync progress</span>
                  <span className="text-cyber-cyan font-semibold">{missionProgress}%</span>
                </div>
                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-cyber-cyan to-cyber-purple transition-all duration-300"
                    style={{ width: `${missionProgress}%` }}
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-1.5">
                <div className="flex justify-between font-mono text-[9px] text-gray-400">
                  <span>Logic Sync progress</span>
                  <span className="text-cyber-cyan font-semibold">72%</span>
                </div>
                <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-cyber-cyan to-cyber-purple transition-all duration-300"
                    style={{ width: `72%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="border-t lg:border-t-0 lg:border-l border-white/10 pt-4 lg:pt-0 lg:pl-6 space-y-3.5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="block text-[8px] text-gray-500 font-mono uppercase tracking-widest">Current reasoning stage</span>
                <span className="font-display text-[10px] text-white font-bold tracking-wider uppercase mt-1 block">
                  {status !== 'idle' && status !== 'inactive' ? reasoningStage : "Memory Comparison"}
                </span>
              </div>
              <div>
                <span className="block text-[8px] text-gray-500 font-mono uppercase tracking-widest">Est. Completion</span>
                <span className="font-mono text-[10px] text-cyber-cyan font-bold tracking-wider mt-1 block animate-pulse">
                  {status !== 'idle' && status !== 'inactive' ? estCompletion : "38 seconds"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Top Editorial Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {editorialMetrics.map((met, idx) => (
          <GlassCard 
            key={met.title} 
            className="p-4 flex items-center gap-4 border-white/5 bg-white/1 transform hover:translate-y-[-2px] hover:shadow-[0_0_20px_rgba(0,240,255,0.05)] transition-all duration-300" 
            glowColor={met.glow}
          >
            <div className={cn(
              "w-10 h-10 rounded flex items-center justify-center border",
              met.glow === 'cyan' && "bg-cyber-cyan/10 border-cyber-cyan/20",
              met.glow === 'purple' && "bg-cyber-purple/10 border-cyber-purple/20",
              met.glow === 'emerald' && "bg-cyber-emerald/10 border-cyber-emerald/20"
            )}>
              {met.icon}
            </div>
            <div>
              <div className="text-[8px] text-gray-500 uppercase tracking-widest font-mono">{met.title}</div>
              <div className="font-display text-lg font-bold text-white mt-0.5">{met.value}</div>
              <div className="text-[8px] text-gray-400 font-sans mt-0.5">{met.subtitle}</div>
            </div>
          </GlassCard>
        ))}
      </div>

      {/* 3. Autonomous Decision Flow */}
      <div className="border border-white/5 bg-black/45 rounded-xl p-5 backdrop-blur-md">
        <h4 className="font-display text-[10px] font-bold tracking-widest text-white uppercase flex items-center gap-1.5 mb-4">
          <Zap className="w-3.5 h-3.5 text-cyber-cyan" />
          Autonomous Decision Flow Heuristic
        </h4>
        
        <div className="flex flex-col md:flex-row items-center justify-between gap-3 text-center md:text-left">
          <div className={cn(
            "p-3 rounded border w-full md:w-auto md:flex-1 transition-all duration-300",
            isFlowActive('scanning') 
              ? "bg-blue-500/10 border-blue-500/50 shadow-[0_0_15px_rgba(59,130,246,0.2)] scale-105 animate-pulse"
              : "bg-black/40 border-white/5 opacity-70"
          )}>
            <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider">Topics Found</div>
            <div className="font-display text-sm font-bold text-blue-400 mt-0.5">{pipelineStats.scanCount}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-white/20 hidden md:block" />

          <div className={cn(
            "p-3 rounded border w-full md:w-auto md:flex-1 transition-all duration-300",
            isFlowActive('filtering') 
              ? "bg-red-500/10 border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)] scale-105 animate-pulse"
              : "bg-black/40 border-white/5 opacity-70"
          )}>
            <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider">Rejected</div>
            <div className="font-display text-sm font-bold text-red-400 mt-0.5">{pipelineStats.filterCount}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-white/20 hidden md:block" />

          <div className={cn(
            "p-3 rounded border w-full md:w-auto md:flex-1 transition-all duration-300",
            isFlowActive('reasoning') 
              ? "bg-yellow-500/10 border-yellow-500/50 shadow-[0_0_15px_rgba(234,179,8,0.2)] scale-105 animate-pulse"
              : "bg-black/40 border-white/5 opacity-70"
          )}>
            <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider">Investigating</div>
            <div className="font-display text-sm font-bold text-yellow-400 mt-0.5">{pipelineStats.reasonCount}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-white/20 hidden md:block" />

          <div className={cn(
            "p-3 rounded border w-full md:w-auto md:flex-1 transition-all duration-300",
            isFlowActive('writing') 
              ? "bg-purple-500/10 border-purple-500/50 shadow-[0_0_15px_rgba(168,85,247,0.2)] scale-105 animate-pulse"
              : "bg-black/40 border-white/5 opacity-70"
          )}>
            <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider">Selected</div>
            <div className="font-display text-sm font-bold text-cyber-purple mt-0.5">{pipelineStats.writeCount}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-white/20 hidden md:block" />

          <div className={cn(
            "p-3 rounded border w-full md:w-auto md:flex-1 transition-all duration-300",
            isFlowActive('publishing') 
              ? "bg-emerald-500/10 border-emerald-500/50 shadow-[0_0_15px_rgba(16,185,129,0.2)] scale-105 animate-pulse"
              : "bg-black/40 border-white/5 opacity-70"
          )}>
            <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider">Publishing</div>
            <div className="font-display text-sm font-bold text-cyber-emerald mt-0.5">{pipelineStats.publishCount}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-white/20 hidden md:block" />

          <div className={cn(
            "p-3 rounded border w-full md:w-auto md:flex-1 transition-all duration-300",
            isFlowActive('learning') 
              ? "bg-pink-500/10 border-pink-500/50 shadow-[0_0_15px_rgba(236,72,153,0.2)] scale-105 animate-pulse"
              : "bg-black/40 border-white/5 opacity-70"
          )}>
            <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider">Learning</div>
            <div className="font-display text-[9px] font-bold text-pink-400 mt-1 uppercase tracking-wider">Memory Updated</div>
          </div>
        </div>
      </div>

      {/* 4. Neural Ingestion Pipeline */}
      <PipelineVisualizer />

      {/* 5. Main Content Grid (3 Columns layout) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Column 1: Topic Queues and Rejected Logs */}
        <div className="lg:col-span-1 space-y-4">
          {/* Candidate Topic Queue */}
          <GlassCard className="p-5" glowColor="cyan">
            <div>
              <div className="mb-4">
                <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5">
                  <Play className="w-3.5 h-3.5 text-cyber-cyan animate-pulse" />
                  Candidate Topic Queue
                </h4>
                <p className="text-[8px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">
                  Live ingestion scans being evaluated
                </p>
              </div>

              <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
                {candidateTopics.map((cand) => (
                  <div key={cand.id} className="p-3 rounded bg-black/40 border border-white/5 text-[10px] space-y-2">
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-display font-medium text-white leading-relaxed truncate max-w-[170px]">
                        {cand.title}
                      </span>
                      <span className={cn(
                        "px-1 py-0.2 rounded text-[7px] font-display uppercase tracking-widest font-bold border flex-shrink-0",
                        cand.recommendation === 'Accept' && "bg-cyber-emerald/10 text-cyber-emerald border-cyber-emerald/25",
                        cand.recommendation === 'Reject' && "bg-red-500/10 text-red-400 border-red-500/25",
                        cand.recommendation === 'Investigate' && "bg-yellow-500/10 text-yellow-400 border-yellow-500/25"
                      )}>
                        {cand.recommendation === 'Accept' ? 'Publish' : cand.recommendation === 'Reject' ? 'Rejected' : 'Investigating'}
                      </span>
                    </div>

                    {/* Scores row */}
                    <div className="flex justify-between font-mono text-[8px] text-gray-500 border-y border-white/5 py-1">
                      <span>Impact: <strong className="text-white">{cand.importanceScore || 90}%</strong></span>
                      <span>Novelty: <strong className="text-white">{cand.noveltyScore || 85}%</strong></span>
                      <span>Cred: <strong className="text-white">{cand.credibilityScore}%</strong></span>
                    </div>

                    {cand.recommendation === 'Reject' && cand.rejectionReason && (
                      <p className="text-[8.5px] text-red-400 leading-normal pl-2 border-l border-red-500/30">
                        {cand.rejectionReason}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>

          {/* Rejected Topics Today */}
          <GlassCard className="p-5" glowColor="none">
            <div>
              <div className="mb-4">
                <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-red-400" />
                  Rejected Topics Today
                </h4>
                <p className="text-[8px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">
                  Filtered due to editorial policy thresholds
                </p>
              </div>

              <div className="space-y-2.5 max-h-[250px] overflow-y-auto pr-1">
                {rejectedTodayList.map((rej, idx) => (
                  <div key={`rej-${idx}-${rej.title.slice(0, 10)}`} className="p-3 rounded bg-black/40 border border-red-500/10 text-[9px] space-y-2">
                    <div className="flex justify-between items-start gap-1">
                      <span className="font-display font-medium text-white leading-relaxed">
                        {rej.title}
                      </span>
                      <span className="px-1.5 py-0.2 rounded text-[7px] font-mono uppercase bg-red-500/10 text-red-400 border border-red-500/20 flex-shrink-0">
                        Rejected
                      </span>
                    </div>
                    <p className="text-[8.5px] text-red-400 leading-normal pl-2 border-l border-red-500/30">
                      {rej.reason}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        </div>

        {/* Column 2: Today's Featured Publication & Drawer Triggers */}
        <div className="lg:col-span-1 space-y-4 flex flex-col">
          {posts.slice(0, 2).map((post) => (
            <GlassCard 
              key={post.id} 
              className="p-5 flex flex-col justify-between cursor-pointer border-white/5 hover:border-cyber-cyan/35 hover:scale-[1.01] transition-all duration-300"
              glowColor="cyan"
              onClick={() => setSelectedPostForDrawer(post)}
            >
              <div className="space-y-3">
                <div className="flex justify-between items-center border-b border-white/5 pb-2">
                  <span className="text-[8px] text-cyber-cyan font-mono uppercase tracking-widest font-bold">
                    Featured Publication • {post.publicationId}
                  </span>
                  <span className="font-mono text-[8px] text-cyber-emerald bg-cyber-emerald/10 px-1.5 py-0.2 rounded font-bold border border-cyber-emerald/20">
                    Conf: {post.confidenceScore}%
                  </span>
                </div>

                <h3 className="font-display text-xs font-semibold text-white tracking-wide uppercase truncate">
                  {post.title}
                </h3>

                <p className="text-[10px] text-gray-400 leading-relaxed truncate-2-lines">
                  {post.text.slice(0, 160)}...
                </p>

                {/* Explainability factors inline */}
                <div className="grid grid-cols-2 gap-2 border-t border-white/5 pt-2.5 font-mono text-[8px] text-gray-500">
                  <div className="flex justify-between">
                    <span>Credibility:</span>
                    <span className="text-white">97%</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Novelty Index:</span>
                    <span className="text-white">{post.noveltyScore}%</span>
                  </div>
                  <div className="flex justify-between font-bold">
                    <span>Impact Rating:</span>
                    <span className="text-cyber-cyan">{post.importanceScore}/100</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Memory match:</span>
                    <span className="text-cyber-emerald">12%</span>
                  </div>
                </div>

                <div className="text-[8px] text-gray-400 pl-2 border-l border-cyber-cyan/30 mt-2 font-mono">
                  {"// Click card to open full decision replay logic"}
                </div>
              </div>
            </GlassCard>
          ))}

          {/* Autonomous Timeline panel */}
          <GlassCard className="p-4 flex-1 flex flex-col justify-between" glowColor="none">
            <div className="mb-3">
              <h4 className="font-display text-[9px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-cyber-cyan" />
                Autonomous Ingestion Timeline
              </h4>
            </div>

            <div className="space-y-2 relative before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[1px] before:bg-white/5 pl-5 font-mono text-[9px]">
              <div className="relative">
                <span className="absolute -left-[20.5px] top-1.5 w-1.5 h-1.5 rounded-full bg-cyber-cyan" />
                <span className="text-gray-500">08:00</span> Scanned 111 Topics
              </div>
              <div className="relative">
                <span className="absolute -left-[20.5px] top-1.5 w-1.5 h-1.5 rounded-full bg-red-400" />
                <span className="text-gray-500">08:04</span> Rejected 71 sources
              </div>
              <div className="relative">
                <span className="absolute -left-[20.5px] top-1.5 w-1.5 h-1.5 rounded-full bg-yellow-400" />
                <span className="text-gray-500">08:07</span> Compared 46 memory nodes
              </div>
              <div className="relative">
                <span className="absolute -left-[20.5px] top-1.5 w-1.5 h-1.5 rounded-full bg-cyber-emerald" />
                <span className="text-gray-500">08:09</span> Published DeepSeek MLA Analysis
              </div>
              <div className="relative">
                <span className="absolute -left-[20.5px] top-1.5 w-1.5 h-1.5 rounded-full bg-cyber-purple" />
                <span className="text-gray-500">08:10</span> Updated Knowledge Graph nodes
              </div>
              <div className="relative pt-1 border-t border-white/5">
                <span className="absolute -left-[20.5px] top-2.5 w-1.5 h-1.5 rounded-full bg-cyber-cyan animate-pulse" />
                <span className="text-cyber-cyan font-bold">08:30</span> Next Scan sequence trigger
              </div>
            </div>
          </GlassCard>
        </div>

        {/* Column 3: Policy, Profile, Source Trust, Graph Preview */}
        <div className="lg:col-span-1 space-y-4">
          {/* Persona Card */}
          <GlassCard className="p-4" glowColor="purple">
            <div className="flex items-center gap-3 border-b border-white/5 pb-2 mb-2">
              <div className="w-7 h-7 rounded-full bg-cyber-purple/10 flex items-center justify-center border border-cyber-purple/20">
                <User className="w-4 h-4 text-cyber-purple" />
              </div>
              <div>
                <h4 className="font-display text-xs font-bold text-white uppercase">Dr. Nova Profile</h4>
                <p className="text-[8px] text-gray-500 font-mono uppercase tracking-widest">AI Systems Architect</p>
              </div>
            </div>

            <div className="space-y-1.5 text-[9px] font-mono leading-relaxed text-gray-400">
              <div><strong className="text-white uppercase font-display text-[8px]">Mission:</strong> Publish only high-impact AI engineering breakthroughs.</div>
              <div className="grid grid-cols-2 gap-2 border-t border-white/5 pt-1.5 mt-1.5 text-[8px] uppercase tracking-wider">
                <div>Personality: <strong className="text-white block mt-0.5">Research First, Calm</strong></div>
                <div>Frequency: <strong className="text-cyber-cyan block mt-0.5">Every 30 mins</strong></div>
                <div>Mood index: <strong className="text-cyber-emerald block mt-0.5">Analytical</strong></div>
                <div>Tone guideline: <strong className="text-white block mt-0.5">Skeptical of Hype</strong></div>
              </div>
            </div>
          </GlassCard>

          {/* Editorial Policy Card */}
          <GlassCard className="p-4" glowColor="none">
            <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase border-b border-white/5 pb-2 mb-2">
              Editorial Policy Heuristics
            </h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[9px] text-gray-400 mb-2">
              <div className="flex justify-between border-b border-white/2 pb-1">
                <span>Min Credibility:</span>
                <span className="text-white">90%</span>
              </div>
              <div className="flex justify-between border-b border-white/2 pb-1">
                <span>Min Eng. Impact:</span>
                <span className="text-white">85%</span>
              </div>
              <div className="flex justify-between border-b border-white/2 pb-1">
                <span>Min Novelty:</span>
                <span className="text-white">80%</span>
              </div>
              <div className="flex justify-between border-b border-white/2 pb-1">
                <span>Memory match max:</span>
                <span className="text-white">70%</span>
              </div>
            </div>
            <div className="text-[8px] text-gray-500 font-mono uppercase tracking-widest">
              Rejecting filter: <strong className="text-red-400 font-normal">Rumours, Marketing announcements, funding, duplicate news, consumer trends, memes</strong>
            </div>
          </GlassCard>

          {/* Memory Logic Audit Card */}
          <GlassCard className="p-4" glowColor="cyan">
            <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase border-b border-white/5 pb-2 mb-2">
              Memory Deduplication Engine
            </h4>
            <div className="space-y-1.5 font-mono text-[9px] text-gray-400">
              <div className="flex justify-between">
                <span>Today&apos;s Active Topic:</span>
                <span className="text-white truncate max-w-[120px]">DeepSeek-V3 MLA</span>
              </div>
              <div className="flex justify-between">
                <span>Compared database size:</span>
                <span className="text-white">18 Publications</span>
              </div>
              <div className="flex justify-between">
                <span>Similarity Probability:</span>
                <span className="text-cyber-cyan">12%</span>
              </div>
              <div className="flex justify-between">
                <span>Deduplication Verdict:</span>
                <span className="text-cyber-emerald font-bold uppercase">Unique (Approved)</span>
              </div>
              <div className="flex justify-between">
                <span>Knowledge Graph updated:</span>
                <span className="text-cyber-cyan font-bold uppercase">YES</span>
              </div>
            </div>
          </GlassCard>

          {/* Source Trust Panel */}
          <GlassCard className="p-4" glowColor="none">
            <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase border-b border-white/5 pb-2 mb-2">
              Source Trust Ratings
            </h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-[9px] text-gray-400">
              <div className="flex justify-between"><span>OpenAI:</span><span className="text-cyber-cyan font-bold">★★★★★</span></div>
              <div className="flex justify-between"><span>Anthropic:</span><span className="text-cyber-cyan font-bold">★★★★★</span></div>
              <div className="flex justify-between"><span>GitHub:</span><span className="text-cyber-cyan font-bold">★★★★★</span></div>
              <div className="flex justify-between"><span>arXiv:</span><span className="text-cyber-cyan font-bold">★★★★★</span></div>
              <div className="flex justify-between"><span>HuggingFace:</span><span className="text-cyber-cyan font-bold">★★★★★</span></div>
              <div className="flex justify-between"><span>MS Research:</span><span className="text-cyber-cyan font-bold">★★★★★</span></div>
              <div className="flex justify-between"><span>Reddit:</span><span className="text-yellow-500">★★★</span></div>
              <div className="flex justify-between"><span>X / Twitter:</span><span className="text-red-400">★★</span></div>
            </div>
          </GlassCard>

          {/* Mini Knowledge Graph Preview */}
          <GlassCard className="p-4" glowColor="cyan">
            <h4 className="font-display text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1">
              <Database className="w-3.5 h-3.5 text-cyber-cyan" />
              Graph Node Preview
            </h4>
            
            <div className="rounded border border-white/5 bg-black/60 p-2 text-center h-[90px] flex items-center justify-center">
              <svg viewBox="0 0 280 80" className="w-full h-full">
                <path d="M 30 40 L 70 40 L 110 40 L 150 40 L 190 40 L 230 40" stroke="rgba(0, 240, 255, 0.2)" strokeWidth="1" strokeDasharray="2 2" />
                <circle cx="30" cy="40" r="4" fill="#3b82f6" />
                <text x="30" y="55" textAnchor="middle" fill="rgba(255, 255, 255, 0.4)" fontSize="6" fontFamily="var(--font-mono)">DeepSeek</text>

                <circle cx="80" cy="30" r="4" fill="#a855f7" />
                <text x="80" y="20" textAnchor="middle" fill="rgba(255, 255, 255, 0.4)" fontSize="6" fontFamily="var(--font-mono)">MLA</text>

                <circle cx="130" cy="50" r="4" fill="#ea580c" />
                <text x="130" y="65" textAnchor="middle" fill="rgba(255, 255, 255, 0.4)" fontSize="6" fontFamily="var(--font-mono)">Memory</text>

                <circle cx="180" cy="30" r="4" fill="#00f0ff" />
                <text x="180" y="20" textAnchor="middle" fill="rgba(255, 255, 255, 0.4)" fontSize="6" fontFamily="var(--font-mono)">Inference</text>

                <circle cx="230" cy="40" r="4" fill="#10b981" />
                <text x="230" y="55" textAnchor="middle" fill="rgba(255, 255, 255, 0.4)" fontSize="6" fontFamily="var(--font-mono)">RAG</text>
              </svg>
            </div>
          </GlassCard>

          {/* Editorial Runtime renamed */}
          <GlassCard className="p-4" glowColor="none">
            <h4 className="font-display text-[9px] font-bold text-gray-500 uppercase tracking-widest border-b border-white/5 pb-2 mb-2">
              Agent Runtime status
            </h4>
            <div className="font-mono text-[9px] text-gray-400 space-y-1">
              <div className="flex justify-between"><span>Status:</span><span className="text-cyber-cyan font-bold uppercase animate-pulse">Monitoring Streams</span></div>
              <div className="flex justify-between"><span>Last Scan sweep:</span><span className="text-white">17 seconds ago</span></div>
              <div className="flex justify-between"><span>Topics in queue:</span><span className="text-white">12 items</span></div>
              <div className="flex justify-between"><span>Next publication block:</span><span className="text-cyber-cyan font-bold">{nextPublishCountdown}</span></div>
            </div>
          </GlassCard>
        </div>
      </div>

      {/* 6. Decision Replay Side Drawer Modal */}
      <AnimatePresence>
        {selectedPostForDrawer && (
          <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm">
            {/* Click outside to close */}
            <div className="absolute inset-0" onClick={() => setSelectedPostForDrawer(null)} />
            
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.3 }}
              className="w-full max-w-md bg-[#0b0f19] border-l border-white/10 h-full p-6 relative overflow-y-auto z-10 flex flex-col justify-between"
            >
              <div>
                <div className="flex justify-between items-start border-b border-white/10 pb-4 mb-5">
                  <div>
                    <h3 className="font-display text-sm font-bold text-cyber-cyan uppercase tracking-wider">
                      Decision Replay Logs
                    </h3>
                    <p className="text-[8px] text-gray-500 font-mono uppercase tracking-widest mt-0.5">
                      {selectedPostForDrawer.publicationId} • Complete reasoning timeline
                    </p>
                  </div>
                  <button 
                    onClick={() => setSelectedPostForDrawer(null)}
                    className="p-1 rounded bg-white/5 text-gray-400 hover:text-white transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <span className="text-[8px] text-gray-500 font-mono uppercase tracking-widest font-bold">Audited Publication Headline</span>
                    <h2 className="font-display text-xs font-bold text-white uppercase tracking-wide leading-relaxed mt-1">
                      {selectedPostForDrawer.title}
                    </h2>
                  </div>

                  {/* Flow Steps */}
                  <div className="space-y-3 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-[1px] before:bg-cyber-cyan/20 pl-7 font-mono text-[10px]">
                    <div className="relative">
                      <span className="absolute -left-[27px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500/25 border border-blue-400 flex items-center justify-center text-[6px] text-white">✓</span>
                      <span className="text-gray-500">Step 1:</span> Found Topic from verified stream
                    </div>
                    <div className="relative">
                      <span className="absolute -left-[27px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500/25 border border-blue-400 flex items-center justify-center text-[6px] text-white">✓</span>
                      <span className="text-gray-500">Step 2:</span> Verified Source credibility (<strong className="text-white">97%</strong>)
                    </div>
                    <div className="relative">
                      <span className="absolute -left-[27px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500/25 border border-blue-400 flex items-center justify-center text-[6px] text-white">✓</span>
                      <span className="text-gray-500">Step 3:</span> Compared with <strong className="text-white">18 prior publications</strong> in index
                    </div>
                    <div className="relative">
                      <span className="absolute -left-[27px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500/25 border border-blue-400 flex items-center justify-center text-[6px] text-white">✓</span>
                      <span className="text-gray-500">Step 4:</span> Memory collision check passed (<strong className="text-cyber-emerald">12% similarity</strong>)
                    </div>
                    <div className="relative">
                      <span className="absolute -left-[27px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500/25 border border-blue-400 flex items-center justify-center text-[6px] text-white">✓</span>
                      <span className="text-gray-500">Step 5:</span> Impact scored at <strong className="text-white">{selectedPostForDrawer.importanceScore}/100</strong>
                    </div>
                    <div className="relative">
                      <span className="absolute -left-[27px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500/25 border border-blue-400 flex items-center justify-center text-[6px] text-white">✓</span>
                      <span className="text-gray-500">Step 6:</span> Novelty evaluated at <strong className="text-white">{selectedPostForDrawer.noveltyScore}/100</strong>
                    </div>
                    <div className="relative font-bold">
                      <span className="absolute -left-[27px] top-1.5 w-2.5 h-2.5 rounded-full bg-cyber-cyan border border-cyber-cyan flex items-center justify-center text-[6px] text-black">✓</span>
                      <span className="text-cyber-cyan">Step 7:</span> Editorial Decision: <strong className="text-cyber-cyan">PUBLISH</strong>
                    </div>
                    <div className="relative text-cyber-purple font-bold">
                      <span className="absolute -left-[27px] top-1.5 w-2.5 h-2.5 rounded-full bg-cyber-purple border border-cyber-purple flex items-center justify-center text-[6px] text-white">✓</span>
                      <span>Step 8:</span> Knowledge Vector Graph updated: <strong className="text-cyber-purple">YES</strong>
                    </div>
                  </div>

                  {/* Summary parameters */}
                  <div className="p-3.5 rounded bg-black/40 border border-white/5 text-[9px] font-mono space-y-1.5">
                    <span className="text-white block font-display uppercase tracking-widest font-bold">Explainability Telemetry</span>
                    <div className="flex justify-between"><span>Confidence:</span><span className="text-white">93%</span></div>
                    <div className="flex justify-between"><span>Novelty:</span><span className="text-white">{selectedPostForDrawer.noveltyScore}%</span></div>
                    <div className="flex justify-between"><span>Engineering Impact:</span><span className="text-white">{selectedPostForDrawer.importanceScore}/100</span></div>
                    <div className="flex justify-between"><span>Credibility:</span><span className="text-white">97%</span></div>
                    <div className="flex justify-between"><span>Memory overlap match:</span><span className="text-cyber-emerald">12%</span></div>
                    <div className="border-t border-white/5 pt-1.5 mt-1.5 flex justify-between text-cyber-cyan font-bold">
                      <span>Verdict:</span>
                      <span>PUBLISHED BROADCAST</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-white/10 mt-6 text-center text-[8px] font-mono text-gray-500 uppercase tracking-widest">
                Aethra reasoning engine signature verified
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
