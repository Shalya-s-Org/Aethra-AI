"use client";

import React, { useMemo, useState } from 'react';
import { useAgent } from '../../context/AgentContext';
import { GlassCard } from '../ui/GlassCard';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  ReferenceLine,
  LabelList
} from 'recharts';
import { BarChart3, Database, Award, CheckCircle2, Pause, Play } from 'lucide-react';
import { cn } from '../../utils/cn';

const DAY_MS = 24 * 3600_000;

export const AnalyticsView: React.FC = () => {
  const { discoveryDecisions, sourceHealth, memoryEntries, editorialThresholds } = useAgent();

  // 1. Category (source-type) distribution — real discovery decisions
  const categoryData = useMemo(() => {
    const counts: Record<string, number> = {};
    discoveryDecisions.forEach(d => {
      const key = d.sourceType || 'unknown';
      counts[key] = (counts[key] || 0) + 1;
    });
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [discoveryDecisions]);

  const categoryTotal = useMemo(() => categoryData.reduce((sum, c) => sum + c.count, 0), [categoryData]);

  // 2. Source volume + success rate — real discovery fetches
  const sourceData = useMemo(() => {
    return sourceHealth.map(s => {
      const total = s.successCount + s.failureCount;
      return {
        name: s.sourceName.replace(/^https?:\/\//, '').split('/')[0],
        volume: s.itemCount ?? 0,
        health: total > 0 ? Math.round((s.successCount / total) * 100) : 0,
        fetches: total
      };
    });
  }, [sourceHealth]);

  const topSource = useMemo(() => {
    if (sourceData.length === 0) return null;
    return sourceData.reduce((best, s) => (s.volume > best.volume ? s : best), sourceData[0]);
  }, [sourceData]);

  // 3. Memory growth — cumulative durable memory entries by day (real firstSeenAt)
  const memoryGrowthData = useMemo(() => {
    if (memoryEntries.length === 0) return [];
    const first = new Date(memoryEntries[0].firstSeenAt).getTime();
    const last = new Date(memoryEntries[memoryEntries.length - 1].firstSeenAt).getTime();
    if (Number.isNaN(first) || Number.isNaN(last)) return [];
    const days = Math.max(1, Math.ceil((last - first) / DAY_MS));
    const buckets = new Array<number>(days).fill(0);
    for (const e of memoryEntries) {
      const t = new Date(e.firstSeenAt).getTime();
      if (Number.isNaN(t)) continue;
      const idx = Math.min(days - 1, Math.floor((t - first) / DAY_MS));
      buckets[idx] += 1;
    }
    let running = 0;
    return buckets.map((n, i) => {
      running += n;
      return { interval: `D${i + 1}`, size: running };
    });
  }, [memoryEntries]);

  // 4. Acceptance statistics — real editorial decisions
  const acceptanceStats = useMemo(() => {
    const accepted = discoveryDecisions.filter(d => d.decision === 'accepted').length;
    const rejected = discoveryDecisions.filter(d => d.decision === 'rejected').length;
    const held = discoveryDecisions.filter(d => d.decision === 'held').length;
    const total = accepted + rejected + held;
    return {
      accepted,
      rejected,
      held,
      total,
      rate: total > 0 ? Math.round((accepted / total) * 100) : 0
    };
  }, [discoveryDecisions]);

  // Streaming chart pause (a11y: freeze the current value to read it)
  const [growthPaused, setGrowthPaused] = useState(false);
  const [growthSnapshot, setGrowthSnapshot] = useState<{ interval: string; size: number }[] | null>(null);

  const handleTogglePause = () => {
    if (!growthPaused) setGrowthSnapshot(memoryGrowthData);
    setGrowthPaused(p => !p);
  };

  const displayedGrowth = growthPaused && growthSnapshot ? growthSnapshot : memoryGrowthData;
  const displayedNodes = displayedGrowth.length > 0 ? displayedGrowth[displayedGrowth.length - 1].size : memoryEntries.length;

  const hasDecisions = discoveryDecisions.length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-display text-xl font-bold tracking-wider text-white uppercase">
          Analytics Console
        </h2>
        <p className="text-xs text-gray-500 uppercase tracking-widest font-mono mt-0.5">
          All series computed from persisted pipeline data
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Chart 1: Memory growth (real cumulative entries) */}
        <GlassCard className="p-5 flex flex-col h-[280px]" glowColor="cyan">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5">
                <Database className="w-4 h-4 text-cyber-cyan" />
                Durable Memory Growth
              </h4>
              <p className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">
                Cumulative memory_entries by day (first seen)
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span
                className={cn(
                  "font-mono text-xs font-semibold px-2 py-0.5 rounded border",
                  growthPaused
                    ? "text-cyber-amber bg-cyber-amber/5 border-cyber-amber/25"
                    : "text-cyber-cyan bg-cyber-cyan/5 border-cyber-cyan/15"
                )}
              >
                {growthPaused ? 'PAUSED' : 'NOW'} {displayedNodes}
              </span>
              <button
                type="button"
                onClick={handleTogglePause}
                aria-pressed={growthPaused}
                aria-label={growthPaused ? 'Resume live chart' : 'Pause live chart'}
                className="p-1.5 rounded border border-cyber-cyan/30 text-cyber-cyan hover:bg-cyber-cyan/10 transition-colors cursor-pointer"
              >
                {growthPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {memoryGrowthData.length === 0 ? (
            <div className="flex-1 flex items-center justify-center font-mono text-[10px] text-gray-600 uppercase tracking-widest">
              No memory entries persisted yet
            </div>
          ) : (
            <div
              role="img"
              aria-label={`Durable memory growth, current ${displayedNodes} entries${growthPaused ? ', paused' : ', live'}`}
              className="flex-1 w-full text-xs"
            >
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={displayedGrowth} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="purpleGlow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#a855f7" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="interval" stroke="#64748b" fontSize={9} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={9} tickLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', borderColor: 'rgba(0, 240, 255, 0.15)', color: '#ffffff' }}
                    labelStyle={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}
                  />
                  <Area type="monotone" dataKey="size" stroke="#a855f7" strokeWidth={2} fillOpacity={1} fill="url(#purpleGlow)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </GlassCard>

        {/* Chart 2: Source-type distribution of decisions */}
        <GlassCard className="p-5 flex flex-col h-[280px]" glowColor="purple">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5">
                <BarChart3 className="w-4 h-4 text-cyber-purple" />
                Decisions by Source Type
              </h4>
              <p className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">
                Volume breakdown across persisted decisions
              </p>
            </div>
            <span className="font-mono text-xs text-cyber-purple font-semibold bg-cyber-purple/5 px-2 py-0.5 rounded border border-cyber-purple/15 shrink-0">
              TOTAL {categoryTotal}
            </span>
          </div>

          {categoryData.length === 0 ? (
            <div className="flex-1 flex items-center justify-center font-mono text-[10px] text-gray-600 uppercase tracking-widest">
              No decisions recorded yet
            </div>
          ) : (
            <div
              role="img"
              aria-label={`Decisions by source type: ${categoryData.map(c => `${c.name} ${c.count}`).join(', ')}`}
              className="flex-1 w-full text-xs"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" stroke="#64748b" fontSize={8} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={9} tickLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', borderColor: 'rgba(0, 240, 255, 0.15)', color: '#ffffff' }}
                    labelStyle={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}
                  />
                  <Bar dataKey="count" fill="#00f0ff" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="count" position="top" fill="#94a3b8" fontSize={9} fontFamily="var(--font-mono)" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </GlassCard>

        {/* Chart 3: Source fetch volume & success rate */}
        <GlassCard className="p-5 flex flex-col h-[280px]" glowColor="emerald">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5">
                <Award className="w-4 h-4 text-cyber-emerald" />
                Source Fetch Volume &amp; Success
              </h4>
              <p className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">
                Items ingested and fetch success rate per source
              </p>
            </div>
            {topSource && (
              <span className="font-mono text-xs text-cyber-emerald font-semibold bg-cyber-emerald/5 px-2 py-0.5 rounded border border-cyber-emerald/15 shrink-0">
                TOP {topSource.name} · {topSource.volume} items
              </span>
            )}
          </div>

          {sourceData.length === 0 ? (
            <div className="flex-1 flex items-center justify-center font-mono text-[10px] text-gray-600 uppercase tracking-widest">
              No source fetches recorded yet
            </div>
          ) : (
            <div
              role="img"
              aria-label={`Source fetch volume: ${sourceData.map(s => `${s.name} ${s.volume} items, ${s.health} percent success`).join(', ')}`}
              className="flex-1 w-full text-xs"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sourceData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <XAxis dataKey="name" stroke="#64748b" fontSize={8} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={9} tickLine={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', borderColor: 'rgba(0, 240, 255, 0.15)', color: '#ffffff' }}
                    labelStyle={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}
                    formatter={(value, name) => (name === 'health' ? `${value}%` : String(value))}
                  />
                  <Bar dataKey="volume" name="Items" fill="#10b981" radius={[4, 4, 0, 0]}>
                    <LabelList dataKey="volume" position="top" fill="#94a3b8" fontSize={9} fontFamily="var(--font-mono)" />
                  </Bar>
                  <Bar dataKey="health" name="Success %" fill="#00f0ff" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </GlassCard>

        {/* Chart 4: Acceptance rate — bullet chart vs real publish threshold */}
        <GlassCard className="p-5 flex flex-col h-[280px]" glowColor="none">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-cyber-cyan" />
                Editorial Acceptance Rate
              </h4>
              <p className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">
                Accepted vs the {editorialThresholds.publish} publish threshold
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="font-mono text-xs text-cyber-emerald font-semibold bg-cyber-emerald/5 px-2 py-0.5 rounded border border-cyber-emerald/15">
                RATE {acceptanceStats.rate}%
              </span>
              <span className="font-mono text-xs text-cyber-cyan font-semibold bg-cyber-cyan/5 px-2 py-0.5 rounded border border-cyber-cyan/15">
                TGT {editorialThresholds.publish}%
              </span>
            </div>
          </div>

          {!hasDecisions ? (
            <div className="flex-1 flex items-center justify-center font-mono text-[10px] text-gray-600 uppercase tracking-widest">
              No decisions recorded yet
            </div>
          ) : (
            <div
              role="img"
              aria-label={`Acceptance rate ${acceptanceStats.rate} percent of ${acceptanceStats.total} decisions (${acceptanceStats.accepted} accepted, ${acceptanceStats.rejected} rejected, ${acceptanceStats.held} held), publish threshold ${editorialThresholds.publish} percent`}
              className="flex-1 w-full text-xs"
            >
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  layout="vertical"
                  data={[{ name: 'Acceptance rate', value: acceptanceStats.rate }]}
                  margin={{ top: 10, right: 44, left: 0, bottom: 0 }}
                >
                  <XAxis type="number" domain={[0, 100]} unit="%" stroke="#64748b" fontSize={9} tickLine={false} />
                  <YAxis type="category" dataKey="name" hide />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', borderColor: 'rgba(0, 240, 255, 0.15)', color: '#ffffff' }}
                    labelStyle={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}
                    formatter={(value) => `${value}%`}
                  />
                  <ReferenceLine
                    x={editorialThresholds.publish}
                    stroke="#00f0ff"
                    strokeDasharray="6 3"
                    strokeWidth={1.5}
                    label={{
                      value: `PUBLISH ${editorialThresholds.publish}%`,
                      position: 'top',
                      fill: '#00f0ff',
                      fontSize: 9,
                      fontFamily: 'var(--font-mono)'
                    }}
                  />
                  <Bar dataKey="value" fill="#10b981" radius={[0, 4, 4, 0]} barSize={22}>
                    <LabelList dataKey="value" position="right" formatter={(value) => `${value}%`} fill="#ffffff" fontSize={11} fontFamily="var(--font-mono)" />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <p className="mt-2 font-mono text-[10px] text-gray-500 uppercase tracking-widest">
            ACCEPTED {acceptanceStats.accepted} · REJECTED {acceptanceStats.rejected} · HELD {acceptanceStats.held} · RATE {acceptanceStats.rate}%
          </p>
        </GlassCard>
      </div>
    </div>
  );
};
