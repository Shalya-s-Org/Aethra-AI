"use client";

import React, { useMemo } from 'react';
import { useAgent } from '../../context/AgentContext';
import { GlassCard } from '../ui/GlassCard';
import { Radio, XCircle, Clock, ExternalLink } from 'lucide-react';
import { cn } from '../../utils/cn';
import { fmtTime, timeAgo } from './format';

// Live source health: every number here comes from the durable
// discovery_fetches table (persisted by the discovery runner). No ratings are
// synthesized — a source shows its real fetch outcomes only.
export const SourceHealthView: React.FC = () => {
  const { sourceHealth } = useAgent();

  const totals = useMemo(() => {
    let success = 0;
    let failure = 0;
    let items = 0;
    for (const s of sourceHealth) {
      success += s.successCount;
      failure += s.failureCount;
      items += s.itemCount ?? 0;
    }
    return { success, failure, items, sources: sourceHealth.length };
  }, [sourceHealth]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-display text-xl font-bold tracking-wider text-white uppercase flex items-center gap-2">
          <Radio className="w-5 h-5 text-cyber-cyan" />
          Source Health
        </h2>
        <p className="text-xs text-gray-500 uppercase tracking-widest font-mono mt-0.5">
          Persisted discovery-fetch outcomes — no synthetic ratings
        </p>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <GlassCard className="p-4" glowColor="cyan">
          <div className="text-[8px] text-gray-500 uppercase tracking-widest font-mono">Sources tracked</div>
          <div className="font-display text-lg font-bold text-white mt-1">{totals.sources}</div>
        </GlassCard>
        <GlassCard className="p-4" glowColor="emerald">
          <div className="text-[8px] text-gray-500 uppercase tracking-widest font-mono">Successful fetches</div>
          <div className="font-display text-lg font-bold text-cyber-emerald mt-1">{totals.success}</div>
        </GlassCard>
        <GlassCard className="p-4" glowColor="none">
          <div className="text-[8px] text-gray-500 uppercase tracking-widest font-mono">Failed fetches</div>
          <div className="font-display text-lg font-bold text-cyber-red mt-1">{totals.failure}</div>
        </GlassCard>
        <GlassCard className="p-4" glowColor="purple">
          <div className="text-[8px] text-gray-500 uppercase tracking-widest font-mono">Candidates ingested</div>
          <div className="font-display text-lg font-bold text-cyber-purple mt-1">{totals.items}</div>
        </GlassCard>
      </div>

      {sourceHealth.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed border-white/5 rounded-xl bg-black/20">
          <Radio className="w-12 h-12 text-gray-600 mb-3" />
          <p className="text-sm text-gray-400 uppercase tracking-wider font-semibold">No source fetches recorded</p>
          <p className="text-xs text-gray-600 font-mono mt-1">Run the discovery runner (or the cron cycle) to populate source health</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sourceHealth.map(source => (
            <GlassCard key={source.sourceName} className="p-4" glowColor={source.status === 'success' ? 'emerald' : 'none'}>
              <div className="flex items-start justify-between gap-2 border-b border-white/5 pb-2 mb-2">
                <div className="min-w-0">
                  <div className="font-display text-xs font-bold text-white uppercase tracking-wide truncate">
                    {source.sourceName}
                  </div>
                  <div className="font-mono text-[8px] text-gray-500 uppercase tracking-widest mt-0.5">
                    {source.sourceType}
                  </div>
                </div>
                <span
                  className={cn(
                    "px-1.5 py-0.5 rounded text-[8px] font-display uppercase tracking-widest font-bold border flex-shrink-0",
                    source.status === 'success'
                      ? "bg-cyber-emerald/15 text-cyber-emerald border-cyber-emerald/30"
                      : "bg-cyber-red/15 text-cyber-red border-cyber-red/30"
                  )}
                >
                  {source.status === 'success' ? 'OK' : 'DOWN'}
                </span>
              </div>

              <div className="font-mono text-[9px] text-gray-400 space-y-1">
                <div className="flex justify-between gap-2">
                  <span className="text-gray-500 truncate">Endpoint</span>
                  <a
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-cyber-cyan truncate max-w-[180px] hover:underline flex items-center gap-1"
                  >
                    {source.url.replace(/^https?:\/\//, '')}
                    <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                  </a>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Last fetch</span>
                  <span className="text-white">{timeAgo(source.fetchedAt)} · {fmtTime(source.fetchedAt)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Items</span>
                  <span className="text-white">{source.itemCount ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Ok / Failed</span>
                  <span className="text-cyber-emerald">{source.successCount} / <span className={source.failureCount > 0 ? 'text-cyber-red' : 'text-white'}>{source.failureCount}</span></span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Last success</span>
                  <span className="text-white">{source.lastSuccessAt ? timeAgo(source.lastSuccessAt) : '—'}</span>
                </div>
              </div>

              {source.error && (
                <div className="mt-2 flex items-start gap-1.5 p-2 rounded bg-cyber-red/5 border border-cyber-red/20 text-[8.5px] text-cyber-red leading-normal">
                  <XCircle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span className="font-mono">{source.error}</span>
                </div>
              )}
            </GlassCard>
          ))}
        </div>
      )}

      <p className="flex items-center gap-1.5 font-mono text-[9px] text-gray-500 uppercase tracking-widest">
        <Clock className="w-3 h-3 text-cyber-cyan" />
        Health aggregates the last 200 persisted fetches per source
      </p>
    </div>
  );
};
