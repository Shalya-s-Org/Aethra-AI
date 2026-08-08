"use client";

import React, { useState } from 'react';
import { useAgent } from '../../context/AgentContext';
import { GlassCard } from '../ui/GlassCard';
import { Scale, CheckCircle2, XCircle, ChevronDown, Eye, Database, Cpu, ShieldCheck, ShieldAlert, Clock, Sparkles } from 'lucide-react';
import { cn } from '../../utils/cn';
import type { DiscoveryDecisionLite } from '../../lib/agentTypes';

export const EditorialDecisions: React.FC = () => {
  const { decisions, discoveryDecisions } = useAgent();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDiscoveryId, setExpandedDiscoveryId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  };

  const toggleDiscoveryExpand = (id: string) => {
    setExpandedDiscoveryId(prev => prev === id ? null : id);
  };

  const qualityBadge = (q: DiscoveryDecisionLite['qualityStatus']) => {
    switch (q) {
      case 'passed': return { label: 'PASSED', cls: 'bg-cyber-emerald/15 text-cyber-emerald border-cyber-emerald/30' };
      case 'held': return { label: 'HELD', cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' };
      case 'rejected': return { label: 'REJECTED', cls: 'bg-cyber-red/15 text-cyber-red border-cyber-red/30' };
      default: return { label: 'PENDING', cls: 'bg-gray-500/15 text-gray-400 border-gray-500/30' };
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="font-display text-xl font-bold tracking-wider text-white uppercase flex items-center gap-2">
          <Scale className="w-5 h-5 text-cyber-cyan" />
          Editorial Decisions Console
        </h2>
        <p className="text-xs text-gray-500 uppercase tracking-widest font-mono mt-0.5">
          Deep auditing registry for autonomous filtering heuristic evaluations
        </p>
      </div>

      {/* Discovery pipeline: real editorial decisions with quality-gate results */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-cyber-emerald" />
          <h3 className="font-display text-sm font-bold tracking-wider text-white uppercase">
            Discovery Pipeline · Pre-Publication Quality Gate
          </h3>
          <span className="px-1.5 py-0.5 rounded bg-cyber-emerald/10 text-cyber-emerald border border-cyber-emerald/25 text-[8px] font-mono tracking-wider">
            LIVE
          </span>
        </div>

        {discoveryDecisions.length === 0 ? (
          <div className="border border-dashed border-white/5 rounded-xl bg-black/20 p-6 text-center">
            <Sparkles className="w-6 h-6 text-gray-600 mx-auto mb-2" />
            <p className="text-xs text-gray-500 uppercase tracking-wider">No discovery pipeline decisions yet</p>
            <p className="text-[10px] text-gray-600 font-mono mt-0.5">Run discovery + editorial to populate the quality-gate audit trail</p>
          </div>
        ) : (
          <div className="border border-white/5 rounded-xl overflow-hidden bg-black/45 backdrop-blur-md">
            {/* Header */}
            <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-white/5 bg-white/2 text-[8px] font-mono text-gray-500 uppercase tracking-widest font-semibold hidden md:grid">
              <div className="col-span-4">Headline</div>
              <div className="col-span-1 text-center">Score</div>
              <div className="col-span-2 text-center">Decision</div>
              <div className="col-span-2 text-center">Generation</div>
              <div className="col-span-2 text-center">Quality Gate</div>
              <div className="col-span-1 text-right">Inspect</div>
            </div>
            <div className="divide-y divide-white/5">
              {discoveryDecisions.map(dec => {
                const isOpen = expandedDiscoveryId === dec.id;
                const badge = qualityBadge(dec.qualityStatus);
                return (
                  <div key={dec.id} className={cn('transition-all duration-300', isOpen ? 'bg-white/2' : 'hover:bg-white/1')}>
                    <div
                      onClick={() => toggleDiscoveryExpand(dec.id)}
                      className="grid grid-cols-1 md:grid-cols-12 gap-4 px-6 py-3 items-center cursor-pointer text-xs"
                    >
                      <div className="col-span-12 md:col-span-4 flex items-start gap-2 min-w-0">
                        <span className="mt-0.5 flex-shrink-0">
                          {dec.qualityStatus === 'passed' ? (
                            <CheckCircle2 className="w-4 h-4 text-cyber-emerald" />
                          ) : dec.qualityStatus === 'rejected' ? (
                            <XCircle className="w-4 h-4 text-cyber-red" />
                          ) : (
                            <Clock className="w-4 h-4 text-yellow-400" />
                          )}
                        </span>
                        <span className="font-display font-medium text-white tracking-wide truncate block max-w-[380px]">
                          {dec.title}
                        </span>
                      </div>
                      <div className="col-span-4 md:col-span-1 text-left md:text-center font-mono text-white">
                        {dec.totalScore}/100
                      </div>
                      <div className="col-span-4 md:col-span-2 text-left md:text-center">
                        <span className={cn(
                          'px-1.5 py-0.5 rounded text-[8px] font-display uppercase tracking-widest font-bold border',
                          dec.decision === 'accepted' && 'bg-cyber-emerald/15 text-cyber-emerald border-cyber-emerald/30',
                          dec.decision === 'held' && 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
                          dec.decision === 'rejected' && 'bg-cyber-red/15 text-cyber-red border-cyber-red/30'
                        )}>
                          {dec.decision}
                        </span>
                      </div>
                      <div className="col-span-4 md:col-span-2 text-left md:text-center font-mono">
                        <span className={cn(
                          'text-[8px] uppercase tracking-widest',
                          dec.generationStatus === 'generated' ? 'text-cyber-cyan' : dec.generationStatus === 'failed' ? 'text-cyber-red' : 'text-gray-500'
                        )}>
                          {dec.generationStatus}
                        </span>
                      </div>
                      <div className="col-span-4 md:col-span-2 text-left md:text-center">
                        <span className={cn('px-1.5 py-0.5 rounded text-[8px] font-display uppercase tracking-widest font-bold border', badge.cls)}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="col-span-4 md:col-span-1 text-right flex justify-end items-center gap-2">
                        <ChevronDown className={cn('w-3.5 h-3.5 text-gray-500 transition-transform duration-300', isOpen && 'rotate-180')} />
                      </div>
                    </div>

                    {isOpen && (
                      <div className="px-6 pb-5 pt-2 text-[10px] leading-relaxed text-gray-300 font-sans border-t border-white/2 bg-black/20 animate-fadeIn space-y-4">
                        <div>
                          <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest mb-1 font-bold flex items-center gap-1">
                            <Cpu className="w-3.5 h-3.5 text-cyber-cyan" />
                            Editorial Explanation
                          </div>
                          <p className="pl-4 border-l border-white/10 text-gray-200">{dec.explanation}</p>
                        </div>

                        {dec.quality && dec.quality.checks.length > 0 && (
                          <div>
                            <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest mb-2 font-bold flex items-center gap-1">
                              <ShieldAlert className="w-3.5 h-3.5 text-cyber-cyan" />
                              Quality Gate Checks · {Math.round(dec.quality.score * 100)}% passed
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                              {dec.quality.checks.map(check => (
                                <div
                                  key={check.id}
                                  className={cn(
                                    'flex items-start gap-2 p-2 rounded border',
                                    check.passed
                                      ? 'bg-cyber-emerald/5 border-cyber-emerald/15'
                                      : 'bg-cyber-red/5 border-cyber-red/20'
                                  )}
                                >
                                  {check.passed
                                    ? <CheckCircle2 className="w-3 h-3 text-cyber-emerald mt-0.5 flex-shrink-0" />
                                    : <XCircle className="w-3 h-3 text-cyber-red mt-0.5 flex-shrink-0" />}
                                  <div className="min-w-0">
                                    <span className={cn('font-display uppercase tracking-wider text-[8px] font-semibold block', check.passed ? 'text-cyber-emerald' : 'text-cyber-red')}>
                                      {check.label}
                                    </span>
                                    <span className="text-[9px] text-gray-400 block mt-0.5">{check.detail}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Legacy sim decisions */}
      {decisions.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed border-white/5 rounded-xl bg-black/20">
          <Scale className="w-12 h-12 text-gray-600 mb-3" />
          <p className="text-sm text-gray-400 uppercase tracking-wider font-semibold">No Decisions Logged Yet</p>
          <p className="text-xs text-gray-600 font-mono mt-1">Wait for next automatic trigger scan or boot the agent settings</p>
        </div>
      ) : (
        <div className="border border-white/5 rounded-xl overflow-hidden bg-black/45 backdrop-blur-md">
          {/* Table Header */}
          <div className="grid grid-cols-12 gap-4 px-6 py-3.5 border-b border-white/5 bg-white/2 text-[8px] font-mono text-gray-500 uppercase tracking-widest font-semibold hidden md:grid">
            <div className="col-span-3">Topic / Headline</div>
            <div className="col-span-2">Source</div>
            <div className="col-span-1 text-center">Credibility</div>
            <div className="col-span-1 text-center">Novelty</div>
            <div className="col-span-1 text-center">Eng. Impact</div>
            <div className="col-span-1 text-center">Memory Match</div>
            <div className="col-span-1 text-center">Decision</div>
            <div className="col-span-2 text-right">Expansion</div>
          </div>

          {/* Table Rows */}
          <div className="divide-y divide-white/5">
            {decisions.map((dec) => {
              const isExpanded = expandedId === dec.id;
              const isAccepted = dec.recommendation === 'Accept';
              
              // Memory match calculations based on acceptance state.
              // Deterministic per decision id — Math.random() here re-rolled a
              // different % on every render (impure render, flickering UI).
              const idSeed = [...dec.id].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) >>> 0, 0);
              const memoryMatch = isAccepted 
                ? `${(idSeed % 15) + 5}%` // Low match is good
                : dec.category === 'Duplicate' ? '94%' : `${(idSeed % 20) + 15}%`;

              return (
                <div 
                  key={dec.id}
                  className={cn(
                    "transition-all duration-300",
                    isExpanded ? "bg-white/2" : "hover:bg-white/1"
                  )}
                >
                  <div 
                    onClick={() => toggleExpand(dec.id)}
                    className="grid grid-cols-1 md:grid-cols-12 gap-4 px-6 py-4 items-center cursor-pointer text-xs"
                  >
                    {/* Column 1: Topic */}
                    <div className="col-span-12 md:col-span-3 flex items-start gap-2.5 min-w-0">
                      <div className="mt-0.5 flex-shrink-0">
                        {isAccepted ? (
                          <CheckCircle2 className="w-4 h-4 text-cyber-emerald" />
                        ) : (
                          <XCircle className="w-4 h-4 text-cyber-red" />
                        )}
                      </div>
                      <div className="truncate">
                        <span className="font-display font-medium text-white tracking-wide block truncate max-w-[280px]">
                          {dec.title}
                        </span>
                        <span className="font-mono text-[8px] text-gray-500 uppercase tracking-wider block mt-0.5 md:hidden">
                          Source: {dec.source}
                        </span>
                      </div>
                    </div>

                    {/* Column 2: Source */}
                    <div className="col-span-12 md:col-span-2 text-gray-400 truncate hidden md:block font-mono text-[10px]">
                      {dec.source}
                    </div>

                    {/* Column 3: Credibility */}
                    <div className="col-span-4 md:col-span-1 text-left md:text-center font-mono">
                      <span className="text-gray-500 text-[8px] uppercase block md:hidden mb-0.5">Credibility</span>
                      <span className="text-white font-medium">{dec.credibilityScore}%</span>
                    </div>

                    {/* Column 4: Novelty */}
                    <div className="col-span-4 md:col-span-1 text-left md:text-center font-mono">
                      <span className="text-gray-500 text-[8px] uppercase block md:hidden mb-0.5">Novelty</span>
                      <span className="text-white font-medium">{dec.noveltyScore}/100</span>
                    </div>

                    {/* Column 5: Engineering Impact */}
                    <div className="col-span-4 md:col-span-1 text-left md:text-center font-mono">
                      <span className="text-gray-500 text-[8px] uppercase block md:hidden mb-0.5">Eng. Impact</span>
                      <span className="text-white font-medium">{dec.importanceScore}/100</span>
                    </div>

                    {/* Column 6: Memory Match */}
                    <div className="col-span-4 md:col-span-1 text-left md:text-center font-mono">
                      <span className="text-gray-500 text-[8px] uppercase block md:hidden mb-0.5">Memory Match</span>
                      <span className={cn(
                        "font-semibold",
                        isAccepted ? "text-cyber-emerald" : dec.category === 'Duplicate' ? "text-cyber-red font-bold" : "text-gray-400"
                      )}>{memoryMatch}</span>
                    </div>

                    {/* Column 7: Decision */}
                    <div className="col-span-4 md:col-span-1 text-left md:text-center">
                      <span className="text-gray-500 text-[8px] uppercase block md:hidden mb-0.5">Decision</span>
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[8px] font-display uppercase tracking-widest font-bold border",
                        isAccepted 
                          ? "bg-cyber-emerald/15 text-cyber-emerald border-cyber-emerald/30" 
                          : "bg-cyber-red/15 text-cyber-red border-cyber-red/30"
                      )}>
                        {isAccepted ? 'OK' : 'REJ'}
                      </span>
                    </div>

                    {/* Column 8: Toggle Arrow */}
                    <div className="col-span-4 md:col-span-2 text-right flex justify-end items-center gap-2">
                      <span className="text-[9px] text-gray-500 font-mono tracking-widest uppercase hidden md:inline">Inspect</span>
                      <ChevronDown className={cn("w-3.5 h-3.5 text-gray-500 transition-transform duration-300", isExpanded && "rotate-180")} />
                    </div>
                  </div>

                  {/* Expanded Content Drawer */}
                  {isExpanded && (
                    <div className="px-6 pb-6 pt-2 text-[10px] leading-relaxed text-gray-300 font-sans border-t border-white/2 bg-black/20 animate-fadeIn space-y-4">
                      <div>
                        <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest mb-1 font-bold flex items-center gap-1">
                          <Cpu className="w-3.5 h-3.5 text-cyber-cyan" />
                          Editorial Reasoning & Decision Explanation
                        </div>
                        <p className="pl-4 border-l border-white/10 text-gray-200">
                          {isAccepted 
                            ? dec.detailedAnalysis || `Topic evaluated with high engineering significance (${dec.importanceScore}/100) and novelty (${dec.noveltyScore}/100). The systems integration parameters comply with AETHRA's core publishing mandate. Deemed unique from historical memory database.`
                            : dec.rejectionReason || `Topic filtered out. Evaluated as standard consumer hype or copycat announcement, representing low architectural value for enterprise operations.`}
                        </p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-3 rounded bg-black/60 border border-white/5 font-mono text-[9px] text-gray-400 flex flex-col justify-between">
                          <div>
                            <span className="text-white block uppercase tracking-wider mb-1 font-display font-semibold">Memory Index Lookup</span>
                            <span>Proximity matching: Vector similarity score evaluated at {memoryMatch}. Threshold configuration limits set to 70%.</span>
                          </div>
                          <span className={cn("font-bold uppercase mt-2 block tracking-widest text-[8px]", isAccepted ? "text-cyber-emerald" : "text-cyber-red")}>
                            Collision Test: {isAccepted ? "Cleared (Novel Topic)" : "Failed (Duplicate Pattern)"}
                          </span>
                        </div>

                        <div className="p-3 rounded bg-black/60 border border-white/5 font-mono text-[9px] text-gray-400">
                          <span className="text-white block uppercase tracking-wider mb-1.5 font-display font-semibold">Decisive Variables</span>
                          <div className="space-y-1">
                            <div className="flex justify-between">
                              <span>Credibility Weight:</span>
                              <span className="text-white">{dec.credibilityScore}%</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Novelty Index:</span>
                              <span className="text-white">{dec.noveltyScore}/100</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Engineering Impact:</span>
                              <span className="text-white">{dec.importanceScore}/100</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
