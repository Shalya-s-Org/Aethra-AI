"use client";

import React, { useState } from 'react';
import { useAgent } from '../../context/AgentContext';
import { GlassCard } from '../ui/GlassCard';
import { Radio, Rss, Calendar, ExternalLink, ShieldCheck, FileText, Award, HelpCircle, X } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../../utils/cn';
import { Post } from '../../data/mockTopics';

export const FeedView: React.FC = () => {
  const { posts } = useAgent();
  const [activePostId, setActivePostId] = useState<string | null>(null);
  const [selectedPostForDrawer, setSelectedPostForDrawer] = useState<Post | null>(null);

  const displayedPosts = React.useMemo(() => {
    return [...posts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [posts]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="font-display text-xl font-bold tracking-wider text-white uppercase">
            Publication Feed
          </h2>
          <p className="text-xs text-gray-500 uppercase tracking-widest font-mono mt-0.5">
            Broadcast channel of verified technical analyses
          </p>
        </div>

        <div className="flex items-center gap-2 bg-cyber-emerald/10 border border-cyber-emerald/20 text-cyber-emerald px-3 py-1.5 rounded text-xs font-display uppercase tracking-wider">
          <Rss className="w-3.5 h-3.5 animate-pulse" />
          Feed Active
        </div>
      </div>

      {displayedPosts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center border border-dashed border-white/5 rounded-xl bg-black/20">
          <Radio className="w-12 h-12 text-gray-600 mb-3 animate-pulse" />
          <p className="text-sm text-gray-400 uppercase tracking-wider font-semibold">Feed is Currently Silent</p>
          <p className="text-xs text-gray-600 font-mono mt-1">Wait for next automatic audit check or trigger step</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Feed Feed Stream */}
          <div className="lg:col-span-2 space-y-4">
            {displayedPosts.map((post) => {
              const isActive = activePostId === post.id;
              
              return (
                <GlassCard
                  key={post.id}
                  className={cn(
                    "p-6 transition-all duration-300 border-white/5 cursor-pointer",
                    isActive ? "border-cyber-cyan bg-cyber-cyan/3" : "hover:border-white/15"
                  )}
                  glowColor={isActive ? 'cyan' : 'none'}
                  onClick={() => {
                    setActivePostId(post.id);
                    setSelectedPostForDrawer(post);
                  }}
                >
                  <div className="flex flex-col gap-4">
                    {/* Meta tag details */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 pb-3">
                      <div className="flex items-center gap-2.5">
                        <Calendar className="w-3.5 h-3.5 text-gray-500" />
                        <span className="font-mono text-[9px] text-gray-400">
                          {new Date(post.createdAt).toLocaleString()}
                        </span>
                        <span className="text-gray-600">•</span>
                        <span className="px-2 py-0.5 rounded bg-black/40 border border-white/5 text-[8px] text-cyber-cyan font-mono tracking-widest uppercase">
                          {post.publicationId}
                        </span>
                      </div>
                      
                      <div className="flex items-center gap-3">
                        <span className="px-1.5 py-0.5 rounded bg-white/5 text-gray-400 text-[8px] font-display uppercase tracking-wider">
                          {post.category}
                        </span>
                        
                        <div className="flex items-center gap-1 font-mono text-[9px] text-cyber-emerald">
                          <ShieldCheck className="w-3 h-3" />
                          <span>Conf: {post.confidenceScore}%</span>
                        </div>
                      </div>
                    </div>

                    {/* Headline */}
                    <h3 className="font-display text-sm font-bold text-white tracking-wide uppercase hover:text-cyber-cyan transition-colors">
                      {post.title}
                    </h3>

                    {/* Technical Summary content */}
                    <div className="space-y-4">
                      <div>
                        <div className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                          <FileText className="w-3.5 h-3.5 text-cyber-cyan" />
                          Technical Summary
                        </div>
                        <p className="text-xs text-gray-300 leading-relaxed font-sans pl-4 border-l border-white/10">
                          {post.text}
                        </p>
                      </div>

                      <div>
                        <div className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                          <Award className="w-3.5 h-3.5 text-cyber-purple" />
                          Editorial Opinion
                        </div>
                        <p className="text-xs text-gray-300 leading-relaxed font-sans pl-4 border-l border-white/10 italic">
                          {post.opinion}
                        </p>
                      </div>
                    </div>

                    {/* Explainability Grid Card */}
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 border-t border-white/5 pt-3 font-mono text-[8px] text-gray-500">
                      <div>
                        <span>Confidence:</span>
                        <span className="text-white block mt-0.5 font-bold">{post.confidenceScore}%</span>
                      </div>
                      <div>
                        <span>Novelty Index:</span>
                        <span className="text-white block mt-0.5 font-bold">{post.noveltyScore}/100</span>
                      </div>
                      <div>
                        <span>Engineering Impact:</span>
                        <span className="text-cyber-cyan block mt-0.5 font-bold">{post.importanceScore}/100</span>
                      </div>
                      <div>
                        <span>Credibility Score:</span>
                        <span className="text-white block mt-0.5 font-bold">97%</span>
                      </div>
                      <div>
                        <span>Memory Collision check:</span>
                        <span className="text-cyber-emerald block mt-0.5 font-bold">12% (Passed)</span>
                      </div>
                      <div className="col-span-2 md:col-span-1">
                        <span>Ingestion Reason:</span>
                        <span className="text-gray-400 block mt-0.5 truncate">{post.rationale}</span>
                      </div>
                    </div>

                    {/* Editorial Impact Parameters */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-3 border-t border-white/5 pt-3 font-mono text-[8px] text-gray-500">
                      <div>
                        <span>Est. Eng Impact:</span>
                        <span className="text-white block mt-0.5 font-bold">{post.importanceScore}/100</span>
                      </div>
                      <div>
                        <span>Enterprise Relevance:</span>
                        <span className="text-cyber-cyan block mt-0.5 font-bold">Highly Critical</span>
                      </div>
                      <div>
                        <span>Open Source licensing:</span>
                        <span className="text-white block mt-0.5 font-bold">Public Standard</span>
                      </div>
                      <div>
                        <span>Production Readiness:</span>
                        <span className="text-cyber-emerald block mt-0.5 font-bold">Production Grade</span>
                      </div>
                      <div>
                        <span>Future Influence:</span>
                        <span className="text-white block mt-0.5 font-bold">High Dependency</span>
                      </div>
                    </div>

                    {/* Footer Sources */}
                    {post.sources && post.sources.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-white/5">
                        <span className="text-[8px] font-mono text-gray-500 uppercase tracking-widest mr-2">Verified Sources:</span>
                        {post.sources.map((src, i) => (
                          <span
                            key={`src-${i}-${src}`}
                            className="bg-black/45 border border-white/5 px-2 py-0.5 rounded text-[8px] text-gray-400 font-mono"
                          >
                            {src}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </GlassCard>
              );
            })}
          </div>

          {/* Right Explanation Column */}
          <div className="lg:col-span-1">
            {activePostId ? (() => {
              const activePost = displayedPosts.find(p => p.id === activePostId);
              if (!activePost) return null;

              return (
                <GlassCard className="sticky top-6 border-white/10" glowColor="cyan">
                  <div className="border-b border-white/5 pb-4 mb-4">
                    <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-1.5">
                      <HelpCircle className="w-4 h-4 text-cyber-cyan" />
                      Explainable Logic Report
                    </h4>
                    <p className="text-[8px] text-cyber-cyan font-mono uppercase tracking-widest mt-0.5">
                      Audited publication telemetry
                    </p>
                  </div>

                  <div className="space-y-4 text-xs">
                    <div>
                      <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1.5">Why Selected</h5>
                      <p className="text-[10px] text-gray-300 leading-relaxed font-sans bg-black/40 border border-white/5 p-3 rounded">
                        {activePost.rationale}
                      </p>
                    </div>

                    <div>
                      <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1.5">Impact Metrics</h5>
                      <div className="grid grid-cols-2 gap-3 font-mono text-[10px] border-y border-white/5 py-3">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Importance:</span>
                          <span className="text-white font-bold">{activePost.importanceScore}/100</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Novelty Index:</span>
                          <span className="text-white font-bold">{activePost.noveltyScore}/100</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Signal Confidence:</span>
                          <span className="text-white font-bold">{activePost.confidenceScore}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Duplicate Similarity:</span>
                          <span className="text-cyber-emerald font-bold">12% (Cleared)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </GlassCard>
              );
            })() : (
              <div className="border border-dashed border-white/5 rounded-xl p-8 text-center bg-black/20 text-gray-500 flex flex-col items-center justify-center">
                <HelpCircle className="w-6 h-6 mb-2 text-gray-600" />
                <p className="text-[10px] uppercase tracking-widest font-mono">Select Publication</p>
                <p className="text-[9px] text-gray-600 mt-0.5">Click any publication card to extract why it was published</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 6. Decision Replay Side Drawer Modal */}
      <AnimatePresence>
        {selectedPostForDrawer && (
          <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm">
            <div className="absolute inset-0" onClick={() => setSelectedPostForDrawer(null)} />
            
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "tween", duration: 0.3 }}
              className="w-full max-w-md bg-[#0b0f19] border-l border-white/10 h-full p-6 relative overflow-y-auto z-10 flex flex-col justify-between"
            >
              <div>
                <div className="flex justify-between items-start border-b border-white/10 pb-4 mb-5">
                  <div>
                    <h3 className="font-display text-sm font-bold text-cyber-cyan uppercase tracking-wider">
                      Decision Replay Logs
                    </h3>
                    <p className="text-[8px] text-gray-500 font-mono uppercase tracking-widest mt-0.5">
                      {selectedPostForDrawer.publicationId} • Complete reasoning timeline
                    </p>
                  </div>
                  <button 
                    onClick={() => setSelectedPostForDrawer(null)}
                    className="p-1 rounded bg-white/5 text-gray-400 hover:text-white transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <span className="text-[8px] text-gray-500 font-mono uppercase tracking-widest font-bold">Audited Publication Headline</span>
                    <h2 className="font-display text-xs font-bold text-white uppercase tracking-wide leading-relaxed mt-1">
                      {selectedPostForDrawer.title}
                    </h2>
                  </div>

                  {/* Flow Steps */}
                  <div className="space-y-3 relative before:absolute before:left-3 before:top-2 before:bottom-2 before:w-[1px] before:bg-cyber-cyan/20 pl-7 font-mono text-[10px]">
                    <div className="relative">
                      <span className="absolute -left-[27px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500/25 border border-blue-400 flex items-center justify-center text-[6px] text-white">✓</span>
                      <span className="text-gray-500">Step 1:</span> Found Topic from verified stream
                    </div>
                    <div className="relative">
                      <span className="absolute -left-[27px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500/25 border border-blue-400 flex items-center justify-center text-[6px] text-white">✓</span>
                      <span className="text-gray-500">Step 2:</span> Verified Source credibility (<strong className="text-white">97%</strong>)
                    </div>
                    <div className="relative">
                      <span className="absolute -left-[27px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500/25 border border-blue-400 flex items-center justify-center text-[6px] text-white">✓</span>
                      <span className="text-gray-500">Step 3:</span> Compared with <strong className="text-white">18 prior publications</strong> in index
                    </div>
                    <div className="relative">
                      <span className="absolute -left-[27px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500/25 border border-blue-400 flex items-center justify-center text-[6px] text-white">✓</span>
                      <span className="text-gray-500">Step 4:</span> Memory collision check passed (<strong className="text-cyber-emerald">12% similarity</strong>)
                    </div>
                    <div className="relative">
                      <span className="absolute -left-[27px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500/25 border border-blue-400 flex items-center justify-center text-[6px] text-white">✓</span>
                      <span className="text-gray-500">Step 5:</span> Impact scored at <strong className="text-white">{selectedPostForDrawer.importanceScore}/100</strong>
                    </div>
                    <div className="relative">
                      <span className="absolute -left-[27px] top-1 w-2.5 h-2.5 rounded-full bg-blue-500/25 border border-blue-400 flex items-center justify-center text-[6px] text-white">✓</span>
                      <span className="text-gray-500">Step 6:</span> Novelty evaluated at <strong className="text-white">{selectedPostForDrawer.noveltyScore}/100</strong>
                    </div>
                    <div className="relative font-bold">
                      <span className="absolute -left-[27px] top-1.5 w-2.5 h-2.5 rounded-full bg-cyber-cyan border border-cyber-cyan flex items-center justify-center text-[6px] text-black">✓</span>
                      <span className="text-cyber-cyan">Step 7:</span> Editorial Decision: <strong className="text-cyber-cyan">PUBLISH</strong>
                    </div>
                    <div className="relative text-cyber-purple font-bold">
                      <span className="absolute -left-[27px] top-1.5 w-2.5 h-2.5 rounded-full bg-cyber-purple border border-cyber-purple flex items-center justify-center text-[6px] text-white">✓</span>
                      <span>Step 8:</span> Knowledge Vector Graph updated: <strong className="text-cyber-purple">YES</strong>
                    </div>
                  </div>

                  {/* Summary parameters */}
                  <div className="p-3.5 rounded bg-black/40 border border-white/5 text-[9px] font-mono space-y-1.5">
                    <span className="text-white block font-display uppercase tracking-widest font-bold">Explainability Telemetry</span>
                    <div className="flex justify-between"><span>Confidence:</span><span className="text-white">93%</span></div>
                    <div className="flex justify-between"><span>Novelty:</span><span className="text-white">{selectedPostForDrawer.noveltyScore}%</span></div>
                    <div className="flex justify-between"><span>Engineering Impact:</span><span className="text-white">{selectedPostForDrawer.importanceScore}/100</span></div>
                    <div className="flex justify-between"><span>Credibility:</span><span className="text-white">97%</span></div>
                    <div className="flex justify-between"><span>Memory overlap match:</span><span className="text-cyber-emerald">12%</span></div>
                    <div className="border-t border-white/5 pt-1.5 mt-1.5 flex justify-between text-cyber-cyan font-bold">
                      <span>Verdict:</span>
                      <span>PUBLISHED BROADCAST</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t border-white/10 mt-6 text-center text-[8px] font-mono text-gray-500 uppercase tracking-widest">
                Aethra reasoning engine signature verified
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
