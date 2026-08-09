"use client";

import React, { useMemo } from 'react';
import { useAgent } from '../../context/AgentContext';
import { GlassCard } from '../ui/GlassCard';
import { History, CalendarClock, RotateCcw, AlertTriangle, CheckCircle2, Loader2, Ban } from 'lucide-react';
import { cn } from '../../utils/cn';
import { fmtCountdown, fmtDuration, fmtTime, timeAgo } from './format';

// Agent run history + the durable scheduled job: everything comes from the
// agent_runs and scheduled_jobs tables (SQLite), not from client state.
export const RunHistoryView: React.FC = () => {
  const { agentRuns, scheduledJob } = useAgent();

  const runBadge = (status: string) => {
    switch (status) {
      case 'completed': return { label: 'COMPLETED', icon: <CheckCircle2 className="w-3 h-3" />, cls: 'bg-cyber-emerald/15 text-cyber-emerald border-cyber-emerald/30' };
      case 'failed': return { label: 'FAILED', icon: <AlertTriangle className="w-3 h-3" />, cls: 'bg-cyber-red/15 text-cyber-red border-cyber-red/30' };
      case 'running': return { label: 'RUNNING', icon: <Loader2 className="w-3 h-3 animate-spin" />, cls: 'bg-cyber-cyan/15 text-cyber-cyan border-cyber-cyan/30' };
      case 'queued': return { label: 'QUEUED', icon: <CalendarClock className="w-3 h-3" />, cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' };
      default: return { label: 'SKIPPED', icon: <Ban className="w-3 h-3" />, cls: 'bg-gray-500/15 text-gray-400 border-gray-500/30' };
    }
  };

  const failures = useMemo(() => agentRuns.filter(r => r.status === 'failed').length, [agentRuns]);
  const completed = useMemo(() => agentRuns.filter(r => r.status === 'completed').length, [agentRuns]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-display text-xl font-bold tracking-wider text-white uppercase flex items-center gap-2">
          <History className="w-5 h-5 text-cyber-cyan" />
          Agent Run History
        </h2>
        <p className="text-xs text-gray-500 uppercase tracking-widest font-mono mt-0.5">
          Durable agent_runs + scheduled_jobs records — every run is a database row
        </p>
      </div>

      {/* Scheduled job card */}
      <GlassCard className="p-5" glowColor={scheduledJob?.status === 'active' ? 'cyan' : 'none'}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded flex items-center justify-center border bg-cyber-cyan/10 border-cyber-cyan/20">
              <RotateCcw className="w-5 h-5 text-cyber-cyan" />
            </div>
            <div>
              <div className="font-display text-xs font-bold text-white uppercase tracking-wide">
                Durable Scheduled Job
              </div>
              <div className="font-mono text-[8px] text-gray-500 uppercase tracking-widest mt-0.5">
                {scheduledJob ? scheduledJob.jobType : 'No job scheduled yet'}
              </div>
            </div>
          </div>

          {scheduledJob && (
            <div className="flex flex-wrap items-center gap-3 font-mono text-[9px] text-gray-400">
              <span className={cn(
                "px-1.5 py-0.5 rounded text-[8px] font-display uppercase tracking-widest font-bold border",
                scheduledJob.status === 'active' && "bg-cyber-emerald/15 text-cyber-emerald border-cyber-emerald/30",
                scheduledJob.status === 'paused' && "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
                scheduledJob.status === 'terminal' && "bg-cyber-red/15 text-cyber-red border-cyber-red/30"
              )}>
                {scheduledJob.status.toUpperCase()}
              </span>
              <span>Every {Math.round(scheduledJob.scheduleMs / 60_000)}m</span>
              <span>Next: <strong className="text-cyber-cyan">{fmtCountdown(scheduledJob.nextRunAtMs)}</strong></span>
              <span>Attempts: <strong className="text-white">{scheduledJob.attempts}/{scheduledJob.maxAttempts}</strong></span>
            </div>
          )}
        </div>

        {scheduledJob && (
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-white/5 pt-3 font-mono text-[9px] text-gray-400">
            <div className="flex justify-between gap-2">
              <span className="text-gray-500">Last run</span>
              <span className="text-white">{scheduledJob.lastRunAtMs != null ? timeAgo(new Date(scheduledJob.lastRunAtMs).toISOString()) : '—'}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-gray-500">Backoff</span>
              <span className="text-white">{Math.round(scheduledJob.backoffMs / 1000)}s</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-gray-500">Lease</span>
              <span className="text-white">{scheduledJob.leaseOwner ? (scheduledJob.leaseExpiresAtMs != null ? fmtCountdown(scheduledJob.leaseExpiresAtMs) : 'held') : 'free'}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-gray-500">Id</span>
              <span className="text-white truncate max-w-[120px]">{scheduledJob.id}</span>
            </div>
            {scheduledJob.lastError && (
              <div className="col-span-2 md:col-span-4 flex items-start gap-1.5 p-2 rounded bg-cyber-red/5 border border-cyber-red/20 text-cyber-red leading-normal">
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span className="font-mono">{scheduledJob.lastError}</span>
              </div>
            )}
          </div>
        )}
      </GlassCard>

      {/* Run table */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h3 className="font-display text-sm font-bold tracking-wider text-white uppercase">Pipeline Runs</h3>
          <span className="px-1.5 py-0.5 rounded bg-white/5 text-gray-400 border border-white/10 text-[8px] font-mono tracking-wider">
            {completed} OK · <span className="text-cyber-red">{failures} FAILED</span> · {agentRuns.length} TOTAL
          </span>
        </div>

        {agentRuns.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-white/5 rounded-xl bg-black/20">
            <History className="w-12 h-12 text-gray-600 mb-3" />
            <p className="text-sm text-gray-400 uppercase tracking-wider font-semibold">No runs recorded</p>
            <p className="text-xs text-gray-600 font-mono mt-1">Trigger the cron endpoint or worker to execute a cycle</p>
          </div>
        ) : (
          <div className="border border-white/5 rounded-xl overflow-hidden bg-black/45 backdrop-blur-md">
            <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-white/5 bg-white/2 text-[8px] font-mono text-gray-500 uppercase tracking-widest font-semibold hidden md:grid">
              <div className="col-span-3">Run / Topic</div>
              <div className="col-span-2">Status</div>
              <div className="col-span-2">Started</div>
              <div className="col-span-2">Duration</div>
              <div className="col-span-3">Outcome / Error</div>
            </div>
            <div className="divide-y divide-white/5">
              {agentRuns.map(run => {
                const badge = runBadge(run.status);
                return (
                  <div key={run.id} className="grid grid-cols-1 md:grid-cols-12 gap-2 md:gap-4 px-6 py-3 items-center text-xs">
                    <div className="col-span-12 md:col-span-3 min-w-0">
                      <div className="font-mono text-[9px] text-gray-500 truncate">{run.id}</div>
                      <div className="text-[10px] text-gray-400 truncate mt-0.5">{run.topicId ?? '—'}</div>
                    </div>
                    <div className="col-span-4 md:col-span-2">
                      <span className={cn("inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[8px] font-display uppercase tracking-widest font-bold border", badge.cls)}>
                        {badge.icon}
                        {badge.label}
                      </span>
                    </div>
                    <div className="col-span-4 md:col-span-2 font-mono text-[9px] text-gray-400">
                      {fmtTime(run.startedAt)}
                    </div>
                    <div className="col-span-4 md:col-span-2 font-mono text-[9px] text-gray-400">
                      {fmtDuration(run.startedAt, run.finishedAt)}
                    </div>
                    <div className="col-span-12 md:col-span-3 font-mono text-[9px] text-gray-400 min-w-0">
                      {run.status === 'failed' && run.error ? (
                        <span className="text-cyber-red block truncate">{run.error}</span>
                      ) : (
                        <span className="truncate block">{run.outcome ?? '—'}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
