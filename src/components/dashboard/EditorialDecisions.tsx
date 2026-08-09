"use client";

import React, { useState } from 'react';
import { useAgent } from '../../context/AgentContext';
import { Scale, CheckCircle2, XCircle, ChevronDown, Cpu, ShieldCheck, ShieldAlert, Clock, Sparkles, FileText } from 'lucide-react';
import { cn } from '../../utils/cn';
import type { DiscoveryDecisionLite } from '../../lib/agentTypes';

export const EditorialDecisions: React.FC = () => {
  const { discoveryDecisions, publishedPosts } = useAgent();
  const [expandedDiscoveryId, setExpandedDiscoveryId] = useState<string | null>(null);

  const postByDecision = React.useMemo(() => {
    const map = new Map<string, typeof publishedPosts[number]>();
    for (const p of publishedPosts) if (p.decisionId) map.set(p.decisionId, p);
    return map;
  }, [publishedPosts]);

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
          Persisted editorial decisions with score breakdowns, quality-gate results, and explanations
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
            PERSISTED
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

                        {/* Real score breakdown */}
                        <div>
                          <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest mb-2 font-bold">
                            Score Breakdown · {dec.totalScore}/100
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1.5">
                            {[
                              { label: 'Persona relevance', value: dec.personaRelevance, max: 20 },
                              { label: 'Technical impact', value: dec.technicalImpact, max: 20 },
                              { label: 'Source quality', value: dec.sourceQuality, max: 15 },
                              { label: 'Recency', value: dec.recency, max: 15 },
                              { label: 'Novelty', value: dec.novelty, max: 15 },
                              { label: 'Discussion value', value: dec.discussionValue, max: 10 },
                              { label: 'Evidence confidence', value: dec.evidenceConfidence, max: 5 }
                            ].map(c => (
                              <div key={c.label} className="flex items-center gap-2 font-mono text-[9px]">
                                <span className="text-gray-400 truncate">{c.label}</span>
                                <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-cyber-cyan"
                                    style={{ width: `${Math.round((c.value / c.max) * 100)}%` }}
                                  />
                                </div>
                                <span className="text-white w-6 text-right">{c.value}</span>
                              </div>
                            ))}
                          </div>
                        </div>

                        {dec.candidateUrl && (
                          <div className="font-mono text-[9px] text-gray-400">
                            Source: <span className="text-cyber-cyan">{dec.sourceName ?? '—'}</span>{dec.sourceType ? ` (${dec.sourceType})` : ''} ·{' '}
                            <a href={dec.candidateUrl} target="_blank" rel="noreferrer" className="text-cyber-cyan hover:underline">
                              {dec.candidateUrl.replace(/^https?:\/\//, '')}
                            </a>
                          </div>
                        )}

                        {(() => {
                          const post = postByDecision.get(dec.id);
                          if (!post) return null;
                          return (
                            <div className="border-t border-white/5 pt-3">
                              <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest mb-2 font-bold flex items-center gap-1">
                                <FileText className="w-3.5 h-3.5 text-cyber-emerald" />
                                Published Post (persisted)
                              </div>
                              <div className="space-y-2">
                                <p className="text-[10.5px] text-white font-semibold leading-relaxed">{post.title}</p>
                                {post.body && <p className="text-[9.5px] text-gray-300 leading-relaxed whitespace-pre-line pl-3 border-l border-white/10">{post.body}</p>}
                                {post.rationale && (
                                  <p className="text-[9px] text-gray-400 leading-relaxed pl-3 border-l border-white/10">
                                    <span className="text-gray-500 uppercase tracking-widest text-[8px]">Rationale: </span>{post.rationale}
                                  </p>
                                )}
                                {post.citedUrls.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5 pt-1">
                                    {post.citedUrls.map((u, i) => (
                                      <a key={`cu-${i}`} href={u} target="_blank" rel="noreferrer" className="px-1.5 py-0.5 rounded bg-black/40 border border-white/5 text-[8px] text-cyber-cyan font-mono hover:border-cyber-cyan/30">
                                        {u.replace(/^https?:\/\//, '').slice(0, 40)}
                                      </a>
                                    ))}
                                  </div>
                                )}
                                {post.links.length > 0 && (
                                  <div className="text-[9px] text-gray-400 pt-1">
                                    <span className="text-gray-500 uppercase tracking-widest text-[8px]">Related prior posts: </span>
                                    {post.links.map(l => l.relatedTitle).join(' · ')}
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()}

                        {dec.generationFailure && (
                          <div className="p-2 rounded bg-cyber-red/5 border border-cyber-red/20 text-[9px] text-cyber-red font-mono">
                            Generation failure: {dec.generationFailure}
                          </div>
                        )}

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

    </div>
  );
};
