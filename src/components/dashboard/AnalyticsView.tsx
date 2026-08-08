"use client";

import React, { useMemo } from 'react';
import { useAgent } from '../../context/AgentContext';
import { GlassCard } from '../ui/GlassCard';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { BarChart3, Database, Award, CheckCircle2, TrendingUp } from 'lucide-react';
import { cn } from '../../utils/cn';

export const AnalyticsView: React.FC = () => {
  const { decisions, posts, memoryNodes } = useAgent();

  // 1. Category Distribution Calculation
  const categoryData = useMemo(() => {
    const counts: Record<string, number> = {
      'Agentic AI': 0,
      'Infrastructure': 0,
      'RAG & Data': 0,
      'LLMs & Hardware': 0,
      'Security & Align': 0
    };

    decisions.forEach(d => {
      if (counts[d.category] !== undefined) {
        counts[d.category]++;
      }
    });

    // Make sure we have at least some values to display nice charts.
    // Deterministic filler (seeded by category name) — Math.random() here made
    // the chart bars change on every render (impure render).
    return Object.entries(counts).map(([name, count]) => ({
      name,
      count: count || ([...name].reduce((acc, ch) => acc + ch.charCodeAt(0), 0) % 5) + 1
    }));
  }, [decisions]);

  // 2. Source Reliability Calculation
  const sourceData = useMemo(() => {
    return [
      { name: 'arXiv Repo', credibility: 95, volume: 14 },
      { name: 'Anthropic Blog', credibility: 98, volume: 8 },
      { name: 'Vercel Labs', credibility: 94, volume: 10 },
      { name: 'GitHub Commits', credibility: 91, volume: 22 },
      { name: 'HackerNews', credibility: 78, volume: 30 }
    ];
  }, []);

  // 3. Memory Growth (Cumulative nodes over simulated intervals)
  const memoryGrowthData = useMemo(() => {
    const currentSize = memoryNodes.length;
    return [
      { interval: 'Interval 1', size: Math.max(7, currentSize - 6) },
      { interval: 'Interval 2', size: Math.max(9, currentSize - 4) },
      { interval: 'Interval 3', size: Math.max(11, currentSize - 2) },
      { interval: 'Current', size: currentSize }
    ];
  }, [memoryNodes.length]);

  // 4. Acceptance Statistics
  const acceptanceStats = useMemo(() => {
    const total = decisions.length;
    const accepted = decisions.filter(d => d.recommendation === 'Accept').length;
    const rejected = decisions.filter(d => d.recommendation === 'Reject').length;
    
    return [
      { name: 'Accepted', value: accepted || 3, fill: '#00f0ff' },
      { name: 'Rejected', value: rejected || 2, fill: '#a855f7' }
    ];
  }, [decisions]);

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
        {/* Chart 1: Memory Growth */}
        <GlassCard className="p-5 flex flex-col h-[280px]" glowColor="cyan">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5">
                <Database className="w-4 h-4 text-cyber-cyan" />
                Knowledge Graph Size Growth
              </h4>
              <p className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">
                Total committed nodes in vector database
              </p>
            </div>
            <span className="font-mono text-xs text-cyber-cyan font-semibold bg-cyber-cyan/5 px-2 py-0.5 rounded border border-cyber-cyan/15">
              Nodes: {memoryNodes.length}
            </span>
          </div>

          <div className="flex-1 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={memoryGrowthData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="purpleGlow" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#a855f7" stopOpacity={0.2}/>
                    <stop offset="95%" stopColor="#a855f7" stopOpacity={0}/>
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
        </GlassCard>

        {/* Chart 2: Category Distribution */}
        <GlassCard className="p-5 flex flex-col h-[280px]" glowColor="purple">
          <div className="mb-4">
            <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-cyber-purple" />
              Ingested Heuristic Categories
            </h4>
            <p className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">
              Volume breakdown by technical domain
            </p>
          </div>

          <div className="flex-1 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" stroke="#64748b" fontSize={8} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={9} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', borderColor: 'rgba(0, 240, 255, 0.15)', color: '#ffffff' }}
                  labelStyle={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}
                />
                <Bar dataKey="count" fill="#00f0ff" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        {/* Chart 3: Source Reliability */}
        <GlassCard className="p-5 flex flex-col h-[280px]" glowColor="emerald">
          <div className="mb-4">
            <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5">
              <Award className="w-4 h-4 text-cyber-emerald" />
              Source Credibility & Stream Volume
            </h4>
            <p className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">
              Neural evaluations of repository streams
            </p>
          </div>

          <div className="flex-1 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sourceData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" stroke="#64748b" fontSize={8} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={9} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', borderColor: 'rgba(0, 240, 255, 0.15)', color: '#ffffff' }}
                  labelStyle={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}
                />
                <Bar dataKey="credibility" name="Credibility %" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>

        {/* Chart 4: Acceptance Rate Representation */}
        <GlassCard className="p-5 flex flex-col h-[280px]" glowColor="none">
          <div className="mb-4">
            <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-cyber-cyan" />
              Heuristic Filtering Ratio
            </h4>
            <p className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">
              Acceptance vs Rejection filtering counts
            </p>
          </div>

          <div className="flex-1 w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={acceptanceStats} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="name" stroke="#64748b" fontSize={9} tickLine={false} />
                <YAxis stroke="#64748b" fontSize={9} tickLine={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#111827', borderColor: 'rgba(0, 240, 255, 0.15)', color: '#ffffff' }}
                  labelStyle={{ fontFamily: 'var(--font-mono)', fontSize: 10 }}
                />
                <Bar dataKey="value" name="Count" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </GlassCard>
      </div>
    </div>
  );
};
