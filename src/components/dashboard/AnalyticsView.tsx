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

// Editorial thresholds rendered as dashed target/floor markers (line style, not
// color alone, differentiates them from the live series).
const MEMORY_TARGET = 150;      // knowledge-graph node growth target
const CREDIBILITY_FLOOR = 95;   // minimum credibility for publication
const ACCEPTANCE_TARGET = 75;   // % of editorial decisions accepted

export const AnalyticsView: React.FC = () => {
  const { decisions, memoryNodes } = useAgent();

  // 1. Category Distribution Calculation
  const categoryData = useMemo(() => {
    const counts: Record<string, number> = {};

    decisions.forEach(d => {
      counts[d.category] = (counts[d.category] || 0) + 1;
    });

    // Make sure we have at least some values to display nice charts.
    // Deterministic filler (seeded by category name) — Math.random() here made
    // the chart bars change on every render (impure render).
    return Object.entries(counts).map(([name, count]) => ({
      name,
      count: count || ([...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 5) + 1
    }));
  }, [decisions]);

  const categoryTotal = useMemo(
    () => categoryData.reduce((sum, c) => sum + c.count, 0),
    [categoryData]
  );

  // 2. Source Reliability Calculation
  const sourceData = useMemo(() => {
    const counts: Record<string, { totalCred: number; count: number }> = {};

    decisions.forEach(d => {
      if (!counts[d.source]) {
        counts[d.source] = { totalCred: 0, count: 0 };
      }
      counts[d.source].totalCred += d.credibilityScore;
      counts[d.source].count += 1;
    });

    const mapped = Object.entries(counts).map(([name, val]) => ({
      name: name.replace("http://", "").replace("https://", "").split("/")[0],
      credibility: Math.round(val.totalCred / val.count),
      volume: val.count
    }));

    if (mapped.length === 0) {
      return [
        { name: 'arXiv Repo', credibility: 95, volume: 14 },
        { name: 'Anthropic Blog', credibility: 98, volume: 8 },
        { name: 'GitHub Commits', credibility: 91, volume: 22 },
        { name: 'OpenAI Blog', credibility: 96, volume: 12 }
      ];
    }
    return mapped;
  }, [decisions]);

  const topSource = useMemo(() => {
    if (sourceData.length === 0) return null;
    return sourceData.reduce((best, s) => (s.credibility > best.credibility ? s : best), sourceData[0]);
  }, [sourceData]);

  // 3. Memory Growth (Cumulative nodes over simulated intervals)
  const memoryGrowthData = useMemo(() => {
    const currentSize = memoryNodes.length;
    return [
      { interval: 'Interval 1', size: Math.max(2, currentSize - 6) },
      { interval: 'Interval 2', size: Math.max(3, currentSize - 4) },
      { interval: 'Interval 3', size: Math.max(4, currentSize - 2) },
      { interval: 'Current', size: currentSize }
    ];
  }, [memoryNodes.length]);

  // 4. Acceptance Statistics
  const acceptanceStats = useMemo(() => {
    const accepted = decisions.filter(d => d.recommendation === 'Accept').length;
    const rejected = decisions.filter(d => d.recommendation === 'Reject').length;
    const total = accepted + rejected;
    return {
      accepted,
      rejected,
      total,
      rate: total > 0 ? Math.round((accepted / total) * 100) : 0
    };
  }, [decisions]);

  // Streaming chart pause: freeze the displayed series (and the readout chips)
  // so the current value can be read while the live chart is sliding. The
  // snapshot is captured in the click handler (whose closure is fresh every
  // poll tick) and only read while paused — no refs or effects needed.
  const [growthPaused, setGrowthPaused] = useState(false);
  const [growthSnapshot, setGrowthSnapshot] = useState<{ interval: string; size: number }[] | null>(null);

  const handleTogglePause = () => {
    if (!growthPaused) {
      setGrowthSnapshot(memoryGrowthData);
    }
    setGrowthPaused(p => !p);
  };

  const displayedGrowth = growthPaused && growthSnapshot ? growthSnapshot : memoryGrowthData;
  const displayedNodes =
    displayedGrowth.length > 0 ? displayedGrowth[displayedGrowth.length - 1].size : memoryNodes.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-display text-xl font-bold tracking-wider text-white uppercase">
          Analytics Console
        </h2>
        <p className="text-xs text-gray-500 uppercase tracking-widest font-mono mt-0.5">
          Autonomous heuristic evaluation logs & growth projections
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Chart 1: Memory Growth (streaming, pause/resume + target marker) */}
        <GlassCard className="p-5 flex flex-col h-[280px]" glowColor="cyan">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5">
                <Database className="w-4 h-4 text-cyber-cyan" />
                Knowledge Graph Size Growth
              </h4>
              <p className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">
                Total committed nodes in vector database
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
              <span className="font-mono text-xs text-cyber-amber font-semibold bg-cyber-amber/5 px-2 py-0.5 rounded border border-cyber-amber/25">
                TGT {MEMORY_TARGET}
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

          <div
            role="img"
            aria-label={`Knowledge graph size ${displayedNodes} nodes, target ${MEMORY_TARGET} nodes${growthPaused ? ', paused' : ', live'}`}
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
                <ReferenceLine
                  y={MEMORY_TARGET}
                  stroke="#f59e0b"
                  strokeDasharray="6 3"
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
                  label={{
                    value: `TARGET ${MEMORY_TARGET}`,
                    position: 'insideTopRight',
                    fill: '#f59e0b',
                    fontSize: 9,
                    fontFamily: 'var(--font-mono)'
                  }}
                />
                <Area type="monotone" dataKey="size" stroke="#a855f7" strokeWidth={2} fillOpacity={1} fill="url(#purpleGlow)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        {/* Chart 2: Category Distribution */}
        <GlassCard className="p-5 flex flex-col h-[280px]" glowColor="purple">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5">
                <BarChart3 className="w-4 h-4 text-cyber-purple" />
                Ingested Heuristic Categories
              </h4>
              <p className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">
                Volume breakdown by technical domain
              </p>
            </div>
            <span className="font-mono text-xs text-cyber-purple font-semibold bg-cyber-purple/5 px-2 py-0.5 rounded border border-cyber-purple/15 shrink-0">
              TOTAL {categoryTotal}
            </span>
          </div>

          <div
            role="img"
            aria-label={`Category distribution: ${categoryData.map(c => `${c.name} ${c.count}`).join(', ')}`}
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
        </GlassCard>

        {/* Chart 3: Source Reliability */}
        <GlassCard className="p-5 flex flex-col h-[280px]" glowColor="emerald">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5">
                <Award className="w-4 h-4 text-cyber-emerald" />
                Source Credibility & Stream Volume
              </h4>
              <p className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">
                Neural evaluations of repository streams
              </p>
            </div>
            {topSource && (
              <span className="font-mono text-xs text-cyber-emerald font-semibold bg-cyber-emerald/5 px-2 py-0.5 rounded border border-cyber-emerald/15 shrink-0">
                TOP {topSource.name} · {topSource.credibility}%
              </span>
            )}
          </div>

          <div
            role="img"
            aria-label={`Source credibility, ${CREDIBILITY_FLOOR} percent floor: ${sourceData.map(s => `${s.name} ${s.credibility} percent`).join(', ')}`}
            className="flex-1 w-full text-xs"
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sourceData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" stroke="#64748b" fontSize={8} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={9} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', borderColor: 'rgba(0, 240, 255, 0.15)', color: '#ffffff' }}
                  labelStyle={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}
                />
                <ReferenceLine
                  y={CREDIBILITY_FLOOR}
                  stroke="#00f0ff"
                  strokeDasharray="6 3"
                  strokeWidth={1.5}
                  ifOverflow="extendDomain"
                  label={{
                    value: `FLOOR ${CREDIBILITY_FLOOR}%`,
                    position: 'insideTopRight',
                    fill: '#00f0ff',
                    fontSize: 9,
                    fontFamily: 'var(--font-mono)'
                  }}
                />
                <Bar dataKey="credibility" name="Credibility %" fill="#10b981" radius={[4, 4, 0, 0]}>
                  <LabelList dataKey="credibility" position="top" fill="#94a3b8" fontSize={9} fontFamily="var(--font-mono)" />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        {/* Chart 4: Acceptance Rate — bullet chart (KPI vs target) */}
        <GlassCard className="p-5 flex flex-col h-[280px]" glowColor="none">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-cyber-cyan" />
                Heuristic Filtering Ratio
              </h4>
              <p className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">
                Acceptance rate vs {ACCEPTANCE_TARGET}% editorial target
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="font-mono text-xs text-cyber-emerald font-semibold bg-cyber-emerald/5 px-2 py-0.5 rounded border border-cyber-emerald/15">
                RATE {acceptanceStats.rate}%
              </span>
              <span className="font-mono text-xs text-cyber-cyan font-semibold bg-cyber-cyan/5 px-2 py-0.5 rounded border border-cyber-cyan/15">
                TGT {ACCEPTANCE_TARGET}%
              </span>
            </div>
          </div>

          <div
            role="img"
            aria-label={`Acceptance rate ${acceptanceStats.rate} percent of ${acceptanceStats.total} decisions (${acceptanceStats.accepted} accepted, ${acceptanceStats.rejected} rejected), target ${ACCEPTANCE_TARGET} percent`}
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
                  x={ACCEPTANCE_TARGET}
                  stroke="#00f0ff"
                  strokeDasharray="6 3"
                  strokeWidth={1.5}
                  label={{
                    value: `TARGET ${ACCEPTANCE_TARGET}%`,
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

          <p className="mt-2 font-mono text-[10px] text-gray-500 uppercase tracking-widest">
            ACCEPTED {acceptanceStats.accepted} · REJECTED {acceptanceStats.rejected} · RATE {acceptanceStats.rate}%
          </p>
        </GlassCard>
      </div>
    </div>
  );
};
