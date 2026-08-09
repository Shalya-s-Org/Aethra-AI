"use client";

import React, { useMemo, useState, useEffect } from 'react';
import { useAgent } from '../../context/AgentContext';
import { GlassCard } from '../ui/GlassCard';
import { PipelineVisualizer } from './PipelineVisualizer';
import {
  Search, Database, Award, ShieldAlert, TrendingUp, Clock, FileText, ChevronRight,
  User, Activity, Gauge
} from 'lucide-react';
import { motion } from 'framer-motion';
import { cn } from '../../utils/cn';
import { DecisionDrawer, DecisionDrawerItem } from './DecisionDrawer';
import { timeAgo, fmtCountdown } from './format';
import type { CandidateQueueLite, DiscoveryDecisionLite, PublishedPostLite } from '../../lib/agentTypes';

export const DashboardOverview: React.FC = () => {
  const {
    config,
    discoveryDecisions,
    candidateQueue,
    memoryEntries,
    publishedPosts,
    sourceHealth,
    scheduledJob,
    agentRuns,
    editorialThresholds,
    setActiveTab
  } = useAgent();

  const [drawerItem, setDrawerItem] = useState<DecisionDrawerItem | null>(null);
  const [logIndex, setLogIndex] = useState(0);

  // Real pipeline counts (all from persisted tables)
  const acceptedCount = useMemo(() => discoveryDecisions.filter(d => d.decision === 'accepted').length, [discoveryDecisions]);
  const rejectedCount = useMemo(() => discoveryDecisions.filter(d => d.decision === 'rejected').length, [discoveryDecisions]);
  const heldCount = useMemo(() => discoveryDecisions.filter(d => d.decision === 'held').length, [discoveryDecisions]);
  const totalDecisions = discoveryDecisions.length;
  const acceptanceRate = totalDecisions > 0 ? Math.round((acceptedCount / totalDecisions) * 100) : null;
  const realPosts = useMemo(() => publishedPosts.filter(p => !p.isDemo), [publishedPosts]);
  const demoPosts = useMemo(() => publishedPosts.filter(p => p.isDemo), [publishedPosts]);

  const decisionByPost = useMemo(() => {
    const map = new Map<string, DiscoveryDecisionLite>();
    for (const d of discoveryDecisions) if (d.publishedPostId) map.set(d.publishedPostId, d);
    return map;
  }, [discoveryDecisions]);

  // Persisted rejected decisions with human-readable reasons (real only).
  const rejectedToday = useMemo(
    () => discoveryDecisions.filter(d => d.decision === 'rejected').map(d => ({ title: d.title, reason: d.explanation })),
    [discoveryDecisions]
  );

  const toDrawerCandidate = (c: CandidateQueueLite): DecisionDrawerItem => ({
    kind: 'candidate',
    title: c.title,
    sourceName: c.sourceName,
    sourceType: c.sourceType,
    canonicalUrl: c.canonicalUrl,
    summary: c.summary,
    publishedAt: c.publishedAt,
    decision: c.decision,
    totalScore: c.totalScore,
    explanation: c.explanation
  });

  const toDrawerPost = (p: PublishedPostLite): DecisionDrawerItem => {
    const dec = decisionByPost.get(p.id);
    return {
      kind: 'post',
      title: p.title,
      createdAt: p.createdAt,
      isDemo: p.isDemo,
      decision: dec ? dec.decision : (p.isDemo ? null : 'accepted'),
      totalScore: dec ? dec.totalScore : p.totalScore,
      componentScores: dec ? [
        { label: 'Persona relevance', value: dec.personaRelevance },
        { label: 'Technical impact', value: dec.technicalImpact },
        { label: 'Source quality', value: dec.sourceQuality },
        { label: 'Recency', value: dec.recency },
        { label: 'Novelty', value: dec.novelty },
        { label: 'Discussion value', value: dec.discussionValue },
        { label: 'Evidence confidence', value: dec.evidenceConfidence }
      ] : null,
      explanation: dec ? dec.explanation : null,
      generationStatus: dec ? dec.generationStatus : undefined,
      generationFailure: dec ? dec.generationFailure : null,
      quality: dec ? dec.quality : null,
      body: p.body,
      opinion: p.opinion,
      rationale: p.rationale,
      confidence: p.confidence,
      citedUrls: p.citedUrls,
      relatedPosts: p.relatedPosts,
      links: p.links,
      sources: p.sources,
      sourceName: dec ? dec.sourceName : null,
      publishedAt: undefined
    };
  };

  // Real activity, derived from persisted records (agent_runs + published
  // posts). Nothing here is invented on the client.
  const realActivity = useMemo(() => {
    const lines: Array<{ timestamp: string; message: string }> = [];
    for (const run of agentRuns.slice(0, 8)) {
      lines.push({ timestamp: timeAgo(run.startedAt), message: `Run ${run.status}${run.outcome ? ` — ${run.outcome}` : ''}` });
    }
    for (const post of publishedPosts.slice(0, 6)) {
      lines.push({ timestamp: timeAgo(post.createdAt), message: `Published: ${post.title.slice(0, 64)}` });
    }
    return lines;
  }, [agentRuns, publishedPosts]);

  const activityMessages = useMemo(
    () => (realActivity.length > 0 ? realActivity.map(l => l.message) : ['No runs recorded yet — waiting for the first scheduled cycle']),
    [realActivity]
  );

  useEffect(() => {
    if (activityMessages.length <= 1) return;
    const interval = setInterval(() => setLogIndex(prev => (prev + 1) % activityMessages.length), 4500);
    return () => clearInterval(interval);
  }, [activityMessages.length]);

  const nextCycleLabel = scheduledJob
    ? `Next cycle ${fmtCountdown(scheduledJob.nextRunAtMs)}`
    : 'No scheduled job — init the agent to schedule recurring work';

  // Real engine/runtime readouts (persisted records only).
  const engineStatus = scheduledJob ? scheduledJob.status : 'unscheduled';
  const lastRun = agentRuns[0] ?? null;
  const lastDecisionAgo = discoveryDecisions.length > 0 ? timeAgo(discoveryDecisions[0].decidedAt) : '—';
  const flowStep = (active: boolean, activeClass: string) => cn(active ? activeClass : 'bg-black/40 border-white/5 opacity-70');

  // Top metrics — all real persisted counts
  const editorialMetrics = useMemo(() => {
    return [
      {
        title: "Candidates Discovered",
        value: `${candidateQueue.length}`,
        subtitle: "Persisted by the discovery runner",
        icon: <Search className="w-5 h-5 text-blue-400" />,
        glow: "cyan" as const
      },
      {
        title: "Editorial Acceptance",
        value: acceptanceRate == null ? "n/a" : `${acceptanceRate}%`,
        subtitle: `${acceptedCount}/${totalDecisions} decisions accepted`,
        icon: <TrendingUp className="w-5 h-5 text-cyber-cyan" />,
        glow: "cyan" as const
      },
      {
        title: "Durable Memory",
        value: `${memoryEntries.length}`,
        subtitle: "Persisted editorial memory entries",
        icon: <Database className="w-5 h-5 text-cyber-purple" />,
        glow: "purple" as const
      },
      {
        title: "Publications",
        value: `${realPosts.length}`,
        subtitle: demoPosts.length > 0 ? `${demoPosts.length} demo/seed posts labeled` : "From the durable posts table",
        icon: <Award className="w-5 h-5 text-cyber-emerald" />,
        glow: "emerald" as const
      }
    ];
  }, [candidateQueue.length, acceptanceRate, acceptedCount, totalDecisions, memoryEntries.length, realPosts.length, demoPosts.length]);



  return (
    <div className="space-y-6">
      {/* Activity stream */}
      <div className="bg-black/60 border border-cyber-cyan/20 px-4 py-2.5 rounded-lg flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyber-cyan opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyber-cyan"></span>
          </span>
          <span className="font-display font-semibold uppercase tracking-wider text-cyber-cyan">Activity Log:</span>
          <motion.span
            key={logIndex}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            className="text-gray-300 font-mono italic"
          >
            {`"${activityMessages[logIndex % activityMessages.length] ?? 'No activity yet'}"`}
          </motion.span>
        </div>

        {/* Pulse Heartbeat */}
        <div className="flex items-center gap-1.5 font-mono text-[9px] text-gray-500 uppercase tracking-widest pl-1 border-t md:border-t-0 border-white/5 pt-1.5 md:pt-0">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyber-emerald opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-cyber-emerald"></span>
          </span>
          <span className="text-white font-bold">● ENGINE ACTIVE</span>
          <span className="text-gray-700">|</span>
          <span>Last decision: <strong className="text-cyber-cyan">{lastDecisionAgo}</strong></span>
          <span className="text-gray-700">|</span>
          <span>Next cycle: <strong className="text-cyber-purple">{scheduledJob ? fmtCountdown(scheduledJob.nextRunAtMs) : 'unscheduled'}</strong></span>
        </div>
      </div>

      {/* 1. Live Activity Hero Banner */}
      <div className="bg-gradient-to-r from-cyber-cyan/15 via-cyber-purple/5 to-transparent border border-cyber-cyan/20 rounded-xl p-6 relative overflow-hidden">
        <div className="absolute right-4 bottom-2 opacity-5 font-mono text-[80px] text-cyber-cyan pointer-events-none select-none font-bold uppercase tracking-widest leading-none">
          {config.name}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
          <div className="lg:col-span-2 space-y-3">
            <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full border border-cyber-cyan/35 bg-cyber-cyan/10 text-cyber-cyan font-mono text-[9px] tracking-wider uppercase font-semibold">
              <Activity className="w-3 h-3 text-cyan-400" />
              {lastRun?.status === 'running' ? 'Scheduled run in progress' : nextCycleLabel}
            </div>

            <div>
              <h2 className="font-display text-xs font-bold text-gray-500 uppercase tracking-widest font-mono">
                Current Mission
              </h2>
              <p className="font-display text-base font-bold text-white tracking-wide uppercase mt-1">
                {config.mission}
              </p>
            </div>

            <div className="space-y-1.5">
              <div className="flex justify-between font-mono text-[9px] text-gray-400">
                <span>Pipeline progress</span>
                <span className="text-cyber-cyan font-semibold">
                  Idle — waiting for next scheduled cycle
                </span>
              </div>
              <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-cyber-cyan to-cyber-purple transition-all duration-300"
                  style={{ width: '0%' }}
                />
              </div>
            </div>
          </div>

          <div className="border-t lg:border-t-0 lg:border-l border-white/10 pt-4 lg:pt-0 lg:pl-6 space-y-3.5">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <span className="block text-[8px] text-gray-500 font-mono uppercase tracking-widest">Scheduled job</span>
                <span className="font-display text-[10px] text-white font-bold tracking-wider uppercase mt-1 block">
                  {engineStatus}
                </span>
              </div>
              <div>
                <span className="block text-[8px] text-gray-500 font-mono uppercase tracking-widest">Next scheduled job</span>
                <span className="font-mono text-[10px] text-cyber-cyan font-bold tracking-wider mt-1 block">
                  {nextCycleLabel}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 2. Top Editorial Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {editorialMetrics.map((met) => (
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

      {/* 3. Editorial Decision Flow — persisted counts */}
      <div className="border border-white/5 bg-black/45 rounded-xl p-5 backdrop-blur-md">
        <h4 className="font-display text-[10px] font-bold tracking-widest text-white uppercase flex items-center gap-1.5 mb-4">
          <Gauge className="w-3.5 h-3.5 text-cyber-cyan" />
          Editorial Pipeline · Persisted Counts
        </h4>

        <div className="flex flex-col md:flex-row items-center justify-between gap-3 text-center md:text-left">
          <div className={cn(
            "p-3 rounded border w-full md:w-auto md:flex-1 transition-all duration-300",
            flowStep(candidateQueue.length > 0, "bg-blue-500/10 border-blue-500/50")
          )}>
            <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider">Candidates</div>
            <div className="font-display text-sm font-bold text-blue-400 mt-0.5">{candidateQueue.length}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-white/20 hidden md:block" />

          <div className={cn(
            "p-3 rounded border w-full md:w-auto md:flex-1 transition-all duration-300",
            flowStep(rejectedCount > 0, "bg-cyber-red/10 border-cyber-red/50")
          )}>
            <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider">Rejected</div>
            <div className="font-display text-sm font-bold text-cyber-red mt-0.5">{rejectedCount}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-white/20 hidden md:block" />

          <div className={cn(
            "p-3 rounded border w-full md:w-auto md:flex-1 transition-all duration-300",
            flowStep(heldCount > 0, "bg-yellow-500/10 border-yellow-500/50")
          )}>
            <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider">Held</div>
            <div className="font-display text-sm font-bold text-yellow-400 mt-0.5">{heldCount}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-white/20 hidden md:block" />

          <div className={cn(
            "p-3 rounded border w-full md:w-auto md:flex-1 transition-all duration-300",
            flowStep(acceptedCount > 0, "bg-purple-500/10 border-purple-500/50")
          )}>
            <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider">Accepted</div>
            <div className="font-display text-sm font-bold text-cyber-purple mt-0.5">{acceptedCount}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-white/20 hidden md:block" />

          <div className={cn(
            "p-3 rounded border w-full md:w-auto md:flex-1 transition-all duration-300",
            flowStep(realPosts.length > 0, "bg-emerald-500/10 border-emerald-500/50")
          )}>
            <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider">Published</div>
            <div className="font-display text-sm font-bold text-cyber-emerald mt-0.5">{realPosts.length}</div>
          </div>
          <ChevronRight className="w-4 h-4 text-white/20 hidden md:block" />

          <div className={cn(
            "p-3 rounded border w-full md:w-auto md:flex-1 transition-all duration-300",
            flowStep(memoryEntries.length > 0, "bg-pink-500/10 border-pink-500/50")
          )}>
            <div className="text-[8px] text-gray-500 uppercase font-mono tracking-wider">Memory</div>
            <div className="font-display text-sm font-bold text-pink-400 mt-0.5">{memoryEntries.length}</div>
          </div>
        </div>
      </div>

      {/* 4. Real pipeline schematic (persisted counts) */}
      <PipelineVisualizer />

      {/* 5. Main Content Grid (3 Columns layout) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Column 1: Candidate queue + rejected */}
        <div className="lg:col-span-1 space-y-4">
          {/* Candidate Queue */}
          <GlassCard className="p-5" glowColor="cyan">
            <div>
              <div className="mb-4">
                <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5">
                  <Search className="w-3.5 h-3.5 text-cyber-cyan" />
                  Candidate Queue
                </h4>
                <p className="text-[8px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">
                  Persisted discovery candidates
                </p>
              </div>

              <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
                {candidateQueue.length === 0 && (
                  <p className="text-[10px] text-gray-600 font-mono text-center py-6">No candidates persisted yet</p>
                )}
                {candidateQueue.map(cand => (
                  <div
                    key={cand.id}
                    className="p-3 rounded bg-black/40 border border-white/5 text-[10px] space-y-2 cursor-pointer hover:border-cyber-cyan/35 transition-colors"
                    onClick={() => setDrawerItem(toDrawerCandidate(cand))}
                  >
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-display font-medium text-white leading-relaxed truncate max-w-[170px]">
                        {cand.title}
                      </span>
                      <span className={cn(
                        "px-1 py-0.2 rounded text-[7px] font-display uppercase tracking-widest font-bold border flex-shrink-0",
                        cand.decision === 'accepted' && "bg-cyber-emerald/10 text-cyber-emerald border-cyber-emerald/25",
                        cand.decision === 'rejected' && "bg-cyber-red/10 text-cyber-red border-cyber-red/25",
                        cand.decision === 'held' && "bg-yellow-500/10 text-yellow-400 border-yellow-500/25",
                        cand.decision == null && "bg-gray-500/10 text-gray-400 border-gray-500/25"
                      )}>
                        {cand.decision ?? 'pending'}
                      </span>
                    </div>

                    <div className="flex justify-between font-mono text-[8px] text-gray-500 border-y border-white/5 py-1">
                      <span>Source: <strong className="text-white truncate max-w-[100px] inline-block align-bottom">{cand.sourceName}</strong></span>
                      {cand.totalScore != null && <span>Score: <strong className="text-white">{cand.totalScore}</strong></span>}
                    </div>

                    {cand.decision === 'rejected' && cand.explanation && (
                      <p className="text-[8.5px] text-cyber-red leading-normal pl-2 border-l border-cyber-red/30">
                        {cand.explanation}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>

          {/* Rejected Topics */}
          <GlassCard className="p-5" glowColor="none">
            <div>
              <div className="mb-4">
                <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5">
                  <ShieldAlert className="w-4 h-4 text-cyber-red" />
                  Rejected Topics &amp; Reasons
                </h4>
                <p className="text-[8px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">
                  Persisted editorial rejections
                </p>
              </div>

              <div className="space-y-2.5 max-h-[250px] overflow-y-auto pr-1">
                {rejectedToday.length === 0 && (
                  <p className="text-[10px] text-gray-600 font-mono text-center py-6">No rejections recorded</p>
                )}
                {rejectedToday.map(rej => (
                  <div key={`rej-${rej.title.slice(0, 40)}`} className="p-3 rounded bg-black/40 border border-cyber-red/10 text-[9px] space-y-2">
                    <div className="flex justify-between items-start gap-1">
                      <span className="font-display font-medium text-white leading-relaxed">{rej.title}</span>
                      <span className="px-1.5 py-0.2 rounded text-[7px] font-mono uppercase bg-cyber-red/10 text-cyber-red border border-cyber-red/20 flex-shrink-0">
                        Rejected
                      </span>
                    </div>
                    <p className="text-[8.5px] text-cyber-red leading-normal pl-2 border-l border-cyber-red/30">{rej.reason}</p>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        </div>

        {/* Column 2: Publications + timeline */}
        <div className="lg:col-span-1 space-y-4 flex flex-col justify-between">
          <div className="space-y-4">
            {(realPosts.length > 0 ? realPosts.slice(0, 2) : demoPosts.slice(0, 2)).map((post) => (
              <GlassCard
                key={post.id}
                className="p-5 flex flex-col justify-between cursor-pointer border-white/5 hover:border-cyber-cyan/35 hover:scale-[1.01] transition-all duration-300"
                glowColor="cyan"
                onClick={() => setDrawerItem(toDrawerPost(post))}
              >
                <div className="space-y-3">
                  <div className="flex justify-between items-center border-b border-white/5 pb-2">
                    <span className="text-[8px] text-cyber-cyan font-mono uppercase tracking-widest font-bold">
                      {post.isDemo ? 'Demo / Seed Publication' : 'Published'}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {post.isDemo && (
                        <span className="font-mono text-[8px] text-yellow-400 bg-yellow-500/10 px-1.5 py-0.2 rounded font-bold border border-yellow-500/20">
                          DEMO
                        </span>
                      )}
                      {post.confidence != null && (
                        <span className="font-mono text-[8px] text-cyber-emerald bg-cyber-emerald/10 px-1.5 py-0.2 rounded font-bold border border-cyber-emerald/20">
                          Conf: {post.confidence}%
                        </span>
                      )}
                    </div>
                  </div>

                  <h3 className="font-display text-xs font-semibold text-white tracking-wide uppercase truncate">
                    {post.title}
                  </h3>

                  <p className="text-[10px] text-gray-400 leading-relaxed truncate-2-lines">
                    {post.body.slice(0, 160)}...
                  </p>

                  {/* Real explainability factors */}
                  <div className="grid grid-cols-2 gap-2 border-t border-white/5 pt-2.5 font-mono text-[8px] text-gray-500">
                    <div className="flex justify-between">
                      <span>Editorial score:</span>
                      <span className="text-white">{post.totalScore != null ? `${post.totalScore}/100` : '—'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Related posts:</span>
                      <span className="text-cyber-purple">{post.links.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Cited sources:</span>
                      <span className="text-cyber-cyan">{post.citedUrls.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Published:</span>
                      <span className="text-white">{timeAgo(post.createdAt)}</span>
                    </div>
                  </div>
                </div>
              </GlassCard>
            ))}

            {publishedPosts.length === 0 && (
              <div className="border border-dashed border-white/5 rounded-xl bg-black/20 p-8 text-center">
                <FileText className="w-6 h-6 text-gray-600 mx-auto mb-2" />
                <p className="text-xs text-gray-500 uppercase tracking-wider">No posts published yet</p>
                <p className="text-[10px] text-gray-600 font-mono mt-0.5">Accepted decisions that pass the quality gate appear here</p>
              </div>
            )}
          </div>

          {/* Timeline panel */}
          <GlassCard className="p-4 flex-1 flex flex-col justify-between" glowColor="none">
            <div className="mb-3">
              <h4 className="font-display text-[9px] font-bold text-gray-500 uppercase tracking-widest flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-cyber-cyan" />
                Recent Activity · persisted records
              </h4>
            </div>

            <div className="space-y-2.5 max-h-[170px] overflow-y-auto pr-1 relative before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[1px] before:bg-white/5 pl-5 font-mono text-[9px]">
              {realActivity.map((log, idx) => (
                <div key={`${log.timestamp}-${idx}`} className="relative">
                  <span className="absolute -left-[20.5px] top-1.5 w-1.5 h-1.5 rounded-full bg-cyber-cyan" />
                  <span className="text-gray-500 mr-1">{log.timestamp}</span> {log.message}
                </div>
              ))}
              <div className="relative pt-1 border-t border-white/5">
                <span className="absolute -left-[20.5px] top-2.5 w-1.5 h-1.5 rounded-full bg-cyber-purple animate-pulse" />
                <span className="text-cyber-purple font-bold">{nextCycleLabel}</span>
              </div>
            </div>
          </GlassCard>
        </div>

        {/* Column 3: Persona, policy, memory, source health, runtime */}
        <div className="lg:col-span-1 space-y-4">
          {/* Persona Card */}
          <GlassCard className="p-4" glowColor="purple">
            <div className="flex items-center gap-3 border-b border-white/5 pb-2 mb-2">
              <div className="w-7 h-7 rounded-full bg-cyber-purple/10 flex items-center justify-center border border-cyber-purple/20">
                <User className="w-4 h-4 text-cyber-purple" />
              </div>
              <div>
                <h4 className="font-display text-xs font-bold text-white uppercase">{config.name} Profile</h4>
                <p className="text-[8px] text-gray-500 font-mono uppercase tracking-widest">{config.role}</p>
              </div>
            </div>

            <div className="space-y-1.5 text-[9px] font-mono leading-relaxed text-gray-400">
              <div><strong className="text-white uppercase font-display text-[8px]">Mission:</strong> {config.mission}</div>

              <div className="border-t border-white/5 pt-2 mt-2 space-y-1 text-gray-300 font-mono">
                <div className="flex justify-between text-[8px] uppercase tracking-wider text-gray-500">
                  <span>Scheduled job</span>
                  <span className="text-cyber-cyan">{engineStatus}</span>
                </div>
                <div><span className="text-cyber-cyan">Domain:</span> {config.domain}</div>
                <div><span className="text-cyber-cyan">Role:</span> {config.role}</div>
                <div><span className="text-cyber-cyan">Last run:</span> {lastRun ? `${lastRun.status} · ${timeAgo(lastRun.startedAt)}` : 'none yet'}</div>
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-white/5 pt-1.5 mt-1.5 text-[8px] uppercase tracking-wider">
                <div>Personality: <strong className="text-white block mt-0.5">{config.style.split(",")[0] || "Research First"}</strong></div>
                <div>Frequency: <strong className="text-cyber-cyan block mt-0.5">Every {config.frequency} mins</strong></div>
                <div>Mood index: <strong className="text-cyber-emerald block mt-0.5">{config.style.split(",")[1] || "Analytical"}</strong></div>
                <div>Tone guideline: <strong className="text-white block mt-0.5">{config.style.split(",").slice(-1)[0] || "Highly Technical"}</strong></div>
              </div>
            </div>
          </GlassCard>

          {/* Editorial Policy Card — real engine thresholds */}
          <GlassCard className="p-4" glowColor="none">
            <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase border-b border-white/5 pb-2 mb-2">
              Editorial Policy Thresholds
            </h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[9px] text-gray-400 mb-2">
              <div className="flex justify-between border-b border-white/2 pb-1">
                <span>Publish at:</span>
                <span className="text-cyber-emerald">≥ {editorialThresholds.publish}/100</span>
              </div>
              <div className="flex justify-between border-b border-white/2 pb-1">
                <span>Reject below:</span>
                <span className="text-cyber-red">&lt; {editorialThresholds.reject}/100</span>
              </div>
              <div className="flex justify-between border-b border-white/2 pb-1">
                <span>Daily post cap:</span>
                <span className="text-white">{editorialThresholds.dailyCap}</span>
              </div>
              <div className="flex justify-between border-b border-white/2 pb-1">
                <span>Routine interval:</span>
                <span className="text-white">{editorialThresholds.routineIntervalMinutes}m</span>
              </div>
            </div>
            <div className="text-[8px] text-gray-500 font-mono uppercase tracking-widest leading-relaxed">
              Rejecting filter: <strong className="text-cyber-red font-normal">duplicate canonical URL · title match · unsupported claims · low-quality marketing · persona exclusions</strong>
            </div>
          </GlassCard>

          {/* Memory card — real durable memory */}
          <GlassCard className="p-4" glowColor="cyan">
            <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase border-b border-white/5 pb-2 mb-2">
              Durable Editorial Memory
            </h4>
            <div className="space-y-1.5 font-mono text-[9px] text-gray-400">
              <div className="flex justify-between">
                <span>Memory entries:</span>
                <span className="text-white">{memoryEntries.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Published posts:</span>
                <span className="text-white">{realPosts.length}</span>
              </div>
              <div className="flex justify-between">
                <span>Duplicate check order:</span>
                <span className="text-cyber-cyan text-right max-w-[160px]">canonical URL → title hash → keyword overlap → semantic</span>
              </div>
              <div className="flex justify-between">
                <span>Memory scope:</span>
                <span className="text-cyber-emerald font-bold uppercase">Durable (SQLite)</span>
              </div>
            </div>
          </GlassCard>

          {/* Source Health (real) */}
          <GlassCard className="p-4" glowColor="none">
            <div className="flex items-center justify-between border-b border-white/5 pb-2 mb-2">
              <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase">
                Source Health
              </h4>
              <button
                onClick={() => setActiveTab('sources')}
                className="text-[8px] font-mono uppercase tracking-widest text-cyber-cyan hover:underline cursor-pointer"
              >
                View all
              </button>
            </div>
            <div className="space-y-1.5 font-mono text-[9px] text-gray-400">
              {sourceHealth.length === 0 && (
                <p className="text-[10px] text-gray-600 text-center py-3">No source fetches recorded</p>
              )}
              {sourceHealth.slice(0, 6).map(source => (
                <div key={source.sourceName} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className={cn("w-1.5 h-1.5 rounded-full flex-shrink-0", source.status === 'success' ? "bg-cyber-emerald" : "bg-cyber-red animate-pulse")} />
                    <span className="truncate">{source.sourceName}</span>
                  </span>
                  <span className="text-gray-500 flex-shrink-0">{timeAgo(source.fetchedAt)} · {source.itemCount ?? '—'}</span>
                </div>
              ))}
            </div>
          </GlassCard>

          {/* Mini Knowledge Graph — real memory subjects */}
          <GlassCard className="p-4" glowColor="cyan">
            <h4 className="font-display text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1">
              <Database className="w-3.5 h-3.5 text-cyber-cyan" />
              Durable Memory Subjects
            </h4>

            {memoryEntries.length === 0 ? (
              <div className="rounded border border-white/5 bg-black/60 p-3 text-center font-mono text-[9px] text-gray-600">
                No memory entries yet
              </div>
            ) : (
              <div className="rounded border border-white/5 bg-black/60 p-2 text-center h-[110px] flex items-center justify-center">
                <svg viewBox="0 0 280 90" className="w-full h-full">
                  <path d="M 30 45 L 90 45 L 150 45 L 210 45 L 250 45" stroke="rgba(0, 240, 255, 0.2)" strokeWidth="1" strokeDasharray="2 2" />
                  {memoryEntries.slice(0, 5).map((entry, i) => {
                    const x = 30 + i * 60;
                    const y = 45 + (i % 2 === 0 ? -10 : 10);
                    return (
                      <g key={entry.id}>
                        <circle cx={x} cy={y} r="4" fill={i % 2 === 0 ? '#3b82f6' : '#a855f7'} />
                        <text x={x} y={y + (i % 2 === 0 ? 16 : -10)} textAnchor="middle" fill="rgba(255, 255, 255, 0.45)" fontSize="6" fontFamily="var(--font-mono)">
                          {entry.subject.slice(0, 12)}
                        </text>
                      </g>
                    );
                  })}
                  {memoryEntries.length > 5 && (
                    <text x="255" y="50" textAnchor="middle" fill="rgba(0, 240, 255, 0.6)" fontSize="7" fontFamily="var(--font-mono)">
                      +{memoryEntries.length - 5}
                    </text>
                  )}
                </svg>
              </div>
            )}
          </GlassCard>

          {/* Agent Runtime status */}
          <GlassCard className="p-4" glowColor="none">
            <h4 className="font-display text-[9px] font-bold text-gray-500 uppercase tracking-widest border-b border-white/5 pb-2 mb-2">
              Engine Runtime
            </h4>
            <div className="font-mono text-[9px] text-gray-400 space-y-1">
              <div className="flex justify-between"><span>Job status:</span><span className="text-cyber-cyan font-bold uppercase">{engineStatus}</span></div>
              <div className="flex justify-between"><span>Last run:</span><span className="text-white">{lastRun ? `${lastRun.status} · ${timeAgo(lastRun.startedAt)}` : 'none yet'}</span></div>
              <div className="flex justify-between"><span>Memory entries:</span><span className="text-white">{memoryEntries.length}</span></div>
              <div className="flex justify-between"><span>Next cycle:</span><span className="text-cyber-cyan font-bold">{scheduledJob ? fmtCountdown(scheduledJob.nextRunAtMs) : 'unscheduled'}</span></div>
            </div>
          </GlassCard>
        </div>
      </div>

      {/* Decision Drawer */}
      <DecisionDrawer open={drawerItem != null} onClose={() => setDrawerItem(null)} item={drawerItem} />
    </div>
  );
};
