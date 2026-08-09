"use client";

import React from 'react';
import { Search, Gauge, FileText, ShieldCheck, UploadCloud } from 'lucide-react';
import { useAgent } from '../../context/AgentContext';
import { cn } from '../../utils/cn';
import { fmtCountdown, timeAgo } from './format';

interface Phase {
  label: string;
  count: number;
  icon: React.ReactNode;
  color: string;
  sub: string;
}

// Honest schematic of the REAL pipeline phases. Every number is a persisted
// count; there is no simulated stage machine behind this.
export const PipelineVisualizer: React.FC = () => {
  const { candidateQueue, discoveryDecisions, publishedPosts, scheduledJob, agentRuns } = useAgent();

  const generated = discoveryDecisions.filter(d => d.generationStatus === 'generated').length;
  const gatePassed = discoveryDecisions.filter(d => d.qualityStatus === 'passed').length;
  const realPosts = publishedPosts.filter(p => !p.isDemo).length;
  const lastRun = agentRuns[0] ?? null;

  const phases: Phase[] = [
    { label: 'DISCOVER', count: candidateQueue.length, icon: <Search className="w-4 h-4" />, color: 'text-blue-400 border-blue-500/20 bg-blue-500/5', sub: 'candidates' },
    { label: 'EDITORIAL', count: discoveryDecisions.length, icon: <Gauge className="w-4 h-4" />, color: 'text-purple-400 border-purple-500/20 bg-purple-500/5', sub: 'decisions' },
    { label: 'GENERATE', count: generated, icon: <FileText className="w-4 h-4" />, color: 'text-indigo-400 border-indigo-500/20 bg-indigo-500/5', sub: 'drafts' },
    { label: 'QUALITY GATE', count: gatePassed, icon: <ShieldCheck className="w-4 h-4" />, color: 'text-cyan-400 border-cyan-500/20 bg-cyan-500/5', sub: 'passed' },
    { label: 'PUBLISH', count: realPosts, icon: <UploadCloud className="w-4 h-4" />, color: 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5', sub: 'posts' }
  ];

  return (
    <div className="border border-white/5 bg-black/40 rounded-xl p-5 backdrop-blur-md relative overflow-hidden">
      <div className="flex justify-between items-center mb-5">
        <h4 className="font-display text-[10px] font-bold tracking-widest text-white uppercase flex items-center gap-2">
          <span className={cn('w-1.5 h-1.5 rounded-full', lastRun?.status === 'running' ? 'bg-cyber-cyan animate-ping' : 'bg-gray-600')} />
          Pipeline · persisted counts
        </h4>
        <div className="text-right font-mono text-[8px] text-gray-500 uppercase tracking-widest">
          {lastRun ? (
            <span>
              Last run <span className="text-cyber-cyan">{lastRun.status}</span> · {timeAgo(lastRun.startedAt)}
            </span>
          ) : (
            <span>No scheduled runs yet</span>
          )}
          <span className="mx-1.5 text-gray-700">|</span>
          <span>
            Next cycle{' '}
            <span className="text-cyber-cyan">{scheduledJob ? fmtCountdown(scheduledJob.nextRunAtMs) : 'unscheduled'}</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-5 gap-2.5">
        {phases.map((phase, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && <div className="w-2 self-center text-white/20 font-mono text-[10px]">›</div>}
            <div className={cn('flex flex-col items-center rounded-lg border p-2.5 transition-all duration-300', phase.color)}>
              <div className={cn('w-9 h-9 rounded-lg border flex items-center justify-center', phase.color)}>
                {phase.icon}
              </div>
              <span className="font-display text-[8px] uppercase tracking-widest mt-2 font-bold">{phase.label}</span>
              <span className="font-mono text-sm font-bold text-white mt-0.5">{phase.count}</span>
              <span className="font-mono text-[7px] text-gray-500 uppercase tracking-wider mt-0.5">{phase.sub}</span>
            </div>
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
