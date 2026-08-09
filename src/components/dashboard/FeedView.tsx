"use client";

import React, { useMemo, useState } from 'react';
import { useAgent } from '../../context/AgentContext';
import { GlassCard } from '../ui/GlassCard';
import { Radio, Rss, Calendar, ShieldCheck, FileText, Award, XCircle, ExternalLink } from 'lucide-react';
import { DecisionDrawer, DecisionDrawerItem } from './DecisionDrawer';
import { timeAgo } from './format';
import type { DiscoveryDecisionLite, PublishedPostLite } from '../../lib/agentTypes';

const isHttp = (s: string) => /^https?:\/\//.test(s);

export const FeedView: React.FC = () => {
  const { publishedPosts, discoveryDecisions } = useAgent();
  const [drawerItem, setDrawerItem] = useState<DecisionDrawerItem | null>(null);

  const decisionByPost = useMemo(() => {
    const map = new Map<string, DiscoveryDecisionLite>();
    for (const d of discoveryDecisions) if (d.publishedPostId) map.set(d.publishedPostId, d);
    return map;
  }, [discoveryDecisions]);

  // Newest first; real publications before labeled demo/seed content.
  const displayedPosts = useMemo(() => {
    return [...publishedPosts].sort((a, b) => {
      if (a.isDemo !== b.isDemo) return a.isDemo ? 1 : -1;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [publishedPosts]);

  const recentRejected = useMemo(
    () => discoveryDecisions.filter(d => d.decision === 'rejected').slice(0, 3),
    [discoveryDecisions]
  );

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
      sourceName: dec ? dec.sourceName : null
    };
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="font-display text-xl font-bold tracking-wider text-white uppercase">
            Publication Feed
          </h2>
          <p className="text-xs text-gray-500 uppercase tracking-widest font-mono mt-0.5">
            Persisted posts — demo/seed content explicitly labeled
          </p>
        </div>

        <div className="flex items-center gap-2 bg-cyber-emerald/10 border border-cyber-emerald/20 text-cyber-emerald px-3 py-1.5 rounded text-xs font-display uppercase tracking-wider">
          <Rss className="w-3.5 h-3.5 animate-pulse" />
          {publishedPosts.filter(p => !p.isDemo).length} published
        </div>
      </div>

      {displayedPosts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed border-white/5 rounded-xl bg-black/20">
          <Radio className="w-12 h-12 text-gray-600 mb-3 animate-pulse" />
          <p className="text-sm text-gray-400 uppercase tracking-wider font-semibold">Feed is Currently Silent</p>
          <p className="text-xs text-gray-600 font-mono mt-1">Accepted decisions that pass the quality gate are published here</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Feed */}
          <div className="lg:col-span-2 space-y-4">
            {displayedPosts.map(post => {
              const dec = decisionByPost.get(post.id);
              return (
                <GlassCard
                  key={post.id}
                  className="p-6 transition-all duration-300 border-white/5 cursor-pointer hover:border-cyber-cyan/35"
                  glowColor={post.isDemo ? 'none' : 'cyan'}
                  onClick={() => setDrawerItem(toDrawerPost(post))}
                >
                  <div className="flex flex-col gap-4">
                    {/* Meta */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
                      <div className="flex items-center gap-2.5">
                        <Calendar className="w-3.5 h-3.5 text-gray-500" />
                        <span className="font-mono text-[9px] text-gray-400">
                          {new Date(post.createdAt).toLocaleString()}
                        </span>
                        <span className="text-gray-600">•</span>
                        <span className="font-mono text-[9px] text-gray-500">{timeAgo(post.createdAt)}</span>
                      </div>

                      <div className="flex items-center gap-3">
                        {post.isDemo && (
                          <span className="px-1.5 py-0.5 rounded bg-yellow-500/10 text-yellow-400 border border-yellow-500/25 text-[8px] font-display uppercase tracking-wider">
                            SIMULATION PREVIEW
                          </span>
                        )}
                        {post.confidence != null && (
                          <div className="flex items-center gap-1 font-mono text-[9px] text-cyber-emerald">
                            <ShieldCheck className="w-3 h-3" />
                            <span>Model Conf: {post.confidence}%</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Headline */}
                    <h3 className="font-display text-sm font-bold text-white tracking-wide uppercase">
                      {post.title}
                    </h3>

                    {/* Content */}
                    <div className="space-y-4">
                      <div>
                        <div className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5 text-cyber-cyan" />
                          Technical Summary
                        </div>
                        <p className="text-xs text-gray-300 leading-relaxed font-sans pl-4 border-l border-white/10 whitespace-pre-line">
                          {post.body}
                        </p>
                      </div>

                      {post.opinion && (
                        <div>
                          <div className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                            <Award className="w-3.5 h-3.5 text-cyber-purple" />
                            Editorial Opinion
                          </div>
                          <p className="text-xs text-gray-300 leading-relaxed font-sans pl-4 border-l border-white/10 italic">
                            {post.opinion}
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Real score data */}
                    {dec && (
                      <div className="border-t border-white/5 pt-4 space-y-2 font-mono text-[9px] text-gray-500">
                        <span className="text-white block font-display uppercase tracking-widest font-bold text-[8px]">
                          Editorial Score Breakdown
                        </span>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="p-2 rounded bg-black/40 border border-white/5">
                            <div className="flex justify-between font-bold">
                              <span>Editorial score:</span>
                              <span className="text-cyber-cyan">{dec.totalScore}/100</span>
                            </div>
                            <p className="text-[7.5px] text-gray-500 leading-normal mt-0.5">
                              {dec.decision} by the decision engine
                            </p>
                          </div>
                          <div className="p-2 rounded bg-black/40 border border-white/5">
                            <div className="flex justify-between font-bold">
                              <span>Technical impact:</span>
                              <span className="text-cyber-cyan">{dec.technicalImpact}/20</span>
                            </div>
                            <p className="text-[7.5px] text-gray-500 leading-normal mt-0.5">
                              Architecture &amp; significance component
                            </p>
                          </div>
                          <div className="p-2 rounded bg-black/40 border border-white/5">
                            <div className="flex justify-between font-bold">
                              <span>Novelty:</span>
                              <span className="text-cyber-cyan">{dec.novelty}/15</span>
                            </div>
                            <p className="text-[7.5px] text-gray-500 leading-normal mt-0.5">
                              Versus durable editorial memory
                            </p>
                          </div>
                        </div>
                        {dec.quality && (
                          <p className="text-[8.5px] text-gray-400">
                            Quality gate: <span className={dec.qualityStatus === 'passed' ? 'text-cyber-emerald' : 'text-yellow-400'}>{dec.qualityStatus.toUpperCase()}</span> · {Math.round(dec.quality.score * 100)}% checks passed
                          </p>
                        )}
                      </div>
                    )}

                    {/* Sources */}
                    {post.sources.some(isHttp) && (
                      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/5">
                        <span className="text-[8px] font-mono text-gray-500 uppercase tracking-widest mr-2">Cited sources:</span>
                        {post.sources.filter(isHttp).map((src, i) => (
                          <a
                            key={`src-${i}-${src}`}
                            href={src}
                            target="_blank"
                            rel="noreferrer"
                            className="bg-black/45 border border-white/5 px-2 py-0.5 rounded text-[8px] text-gray-400 font-mono hover:border-cyber-cyan/30 hover:text-white transition-colors flex items-center gap-1"
                          >
                            <ExternalLink className="w-2.5 h-2.5" />
                            <span className="max-w-[160px] truncate">{src.replace(/^https?:\/\//, '')}</span>
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </GlassCard>
              );
            })}
          </div>

          {/* Right column: rationale + rejected alternatives */}
          <div className="lg:col-span-1 space-y-4">
            {/* Rejected alternatives (real) */}
            <GlassCard className="p-4 border-white/10" glowColor="none">
              <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5 border-b border-white/5 pb-3 mb-3">
                <XCircle className="w-4 h-4 text-cyber-red" />
                Rejected Alternatives
              </h4>
              {recentRejected.length === 0 ? (
                <p className="text-[10px] text-gray-600 font-mono">No rejected decisions recorded</p>
              ) : (
                <div className="space-y-2">
                  {recentRejected.map(dec => (
                    <div key={dec.id} className="p-2.5 rounded border border-cyber-red/20 bg-cyber-red/5 space-y-1">
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-white font-semibold text-[9.5px] leading-snug">{dec.title}</span>
                        <span className="px-1 py-0.5 rounded text-[7px] font-mono uppercase bg-cyber-red/10 text-cyber-red border border-cyber-red/25 flex-shrink-0">
                          {dec.totalScore}/100
                        </span>
                      </div>
                      <p className="text-[8.5px] text-gray-500 leading-relaxed">{dec.explanation}</p>
                    </div>
                  ))}
                </div>
              )}
            </GlassCard>

            {/* Selected-post rationale */}
            {drawerItem && (
              <GlassCard className="p-4 border-white/10 sticky top-6" glowColor="cyan">
                <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5 border-b border-white/5 pb-3 mb-3">
                  <Award className="w-4 h-4 text-cyber-cyan" />
                  Selected: Rationale
                </h4>
                <p className="text-[10px] text-gray-300 leading-relaxed">{drawerItem.rationale || drawerItem.explanation || '—'}</p>
                {drawerItem.links && drawerItem.links.length > 0 && (
                  <div className="mt-3 border-t border-white/5 pt-3">
                    <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest mb-1.5 font-bold">
                      Related prior posts ({drawerItem.links.length})
                    </div>
                    <div className="space-y-1">
                      {drawerItem.links.map(l => (
                        <div key={l.relatedPostId} className="text-[9px] text-gray-400">
                          <span className="text-cyber-cyan">↳</span> {l.relatedTitle}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </GlassCard>
            )}
          </div>
        </div>
      )}

      {/* Decision Drawer */}
      <DecisionDrawer open={drawerItem != null} onClose={() => setDrawerItem(null)} item={drawerItem} />
    </div>
  );
};
