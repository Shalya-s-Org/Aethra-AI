"use client";

import React, { useState, useMemo } from 'react';
import { useAgent } from '../../context/AgentContext';
import { GlassCard } from '../ui/GlassCard';
import { Eye, ShieldAlert, ExternalLink, Search, Info, FileText } from 'lucide-react';
import { cn } from '../../utils/cn';
import { fmtTime, timeAgo } from './format';
import type { CandidateQueueLite } from '../../lib/agentTypes';

export const DiscoveryQueue: React.FC = () => {
  const { candidateQueue } = useAgent();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);

  const filteredTopics = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return candidateQueue.filter(c =>
      c.title.toLowerCase().includes(term) ||
      c.sourceName.toLowerCase().includes(term) ||
      (c.sourceType || '').toLowerCase().includes(term)
    );
  }, [candidateQueue, searchTerm]);

  const selectedTopic = candidateQueue.find(c => c.id === selectedTopicId) || null;

  const decisionBadge = (d: CandidateQueueLite['decision']) => {
    switch (d) {
      case 'accepted': return { label: 'ACCEPTED', cls: 'bg-cyber-emerald/15 text-cyber-emerald border-cyber-emerald/30' };
      case 'rejected': return { label: 'REJECTED', cls: 'bg-cyber-red/15 text-cyber-red border-cyber-red/30' };
      case 'held': return { label: 'HELD', cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' };
      default: return { label: 'PENDING', cls: 'bg-gray-500/15 text-gray-400 border-gray-500/30' };
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="font-display text-xl font-bold tracking-wider text-white uppercase">
            Discovery Queue
          </h2>
          <p className="text-xs text-gray-500 uppercase tracking-widest font-mono mt-0.5">
            Persisted discovery_candidates — {candidateQueue.length} total
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            placeholder="Filter candidates..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-black/40 border border-white/5 rounded px-3 py-1.5 pl-9 text-xs text-white focus:outline-none focus:border-cyber-cyan font-mono"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Candidate List */}
        <div className="lg:col-span-2 space-y-3">
          {filteredTopics.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-white/5 rounded-xl bg-black/20">
              <Eye className="w-8 h-8 text-gray-600 mb-2" />
              <p className="text-xs text-gray-500 uppercase tracking-wider">Queue is empty or filtered</p>
              <p className="text-[10px] text-gray-600 font-mono mt-0.5">Run discovery to populate candidates</p>
            </div>
          ) : (
            filteredTopics.map((topic) => {
              const isSelected = selectedTopicId === topic.id;
              const badge = decisionBadge(topic.decision);

              return (
                <div
                  key={topic.id}
                  onClick={() => setSelectedTopicId(topic.id)}
                  className={cn(
                    "p-4 rounded-xl border transition-all duration-300 cursor-pointer flex justify-between items-start gap-4",
                    isSelected
                      ? "bg-cyber-cyan/5 border-cyber-cyan shadow-[0_0_15px_rgba(0,240,255,0.05)]"
                      : "bg-cyber-card/45 border-white/5 hover:border-white/15 hover:bg-black/40"
                  )}
                >
                  <div className="space-y-2 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-display uppercase tracking-widest font-bold border", badge.cls)}>
                        {badge.label}
                      </span>
                      <span className="text-[9px] text-gray-500 font-mono">{topic.sourceType}</span>
                    </div>

                    <h3 className="font-display text-xs font-semibold text-white tracking-wider leading-relaxed">
                      {topic.title}
                    </h3>

                    <div className="flex items-center gap-4 text-[9px] font-mono text-gray-500">
                      <span>Source: <strong className="text-gray-400">{topic.sourceName}</strong></span>
                      <span>Published: <strong className="text-gray-400">{fmtTime(topic.publishedAt)}</strong></span>
                      <span>Fetched: <strong className="text-gray-400">{timeAgo(topic.fetchedAt)}</strong></span>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 flex-shrink-0 text-right">
                    <div>
                      <div className="text-[8px] text-gray-500 font-mono uppercase">Score</div>
                      <div className="font-mono text-xs font-semibold text-white">
                        {topic.totalScore != null ? `${topic.totalScore}/100` : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Selected Candidate Detail */}
        <div className="lg:col-span-1">
          {selectedTopic ? (
            <GlassCard className="sticky top-6 border-white/10" glowColor={selectedTopic.decision === 'accepted' ? 'cyan' : 'purple'}>
              <div className="flex justify-between items-start border-b border-white/5 pb-4 mb-4">
                <div>
                  <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase">
                    Candidate Audit
                  </h4>
                  <p className="text-[8px] text-cyber-cyan font-mono uppercase tracking-widest mt-0.5">
                    {selectedTopic.id}
                  </p>
                </div>
                <span className={cn("px-2 py-0.5 rounded text-[8px] font-display uppercase tracking-widest font-bold border", decisionBadge(selectedTopic.decision).cls)}>
                  {decisionBadge(selectedTopic.decision).label}
                </span>
              </div>

              <div className="space-y-4">
                <div>
                  <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1">Title</h5>
                  <p className="text-xs font-semibold text-white leading-relaxed">{selectedTopic.title}</p>
                </div>

                <div className="grid grid-cols-2 gap-4 border-y border-white/5 py-3">
                  <div>
                    <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-0.5">Editorial Score</h5>
                    <div className="text-sm font-bold font-mono text-white">{selectedTopic.totalScore != null ? `${selectedTopic.totalScore}/100` : '—'}</div>
                  </div>
                  <div>
                    <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-0.5">Source Type</h5>
                    <div className="text-sm font-bold font-mono text-white">{selectedTopic.sourceType}</div>
                  </div>
                </div>

                {selectedTopic.summary && (
                  <div className="p-3 rounded bg-black/40 border border-white/5">
                    <div className="flex items-center gap-1.5 text-cyber-cyan font-display text-[9px] uppercase tracking-wider font-semibold mb-1">
                      <FileText className="w-3.5 h-3.5" />
                      Summary
                    </div>
                    <p className="text-[10px] text-gray-300 leading-relaxed font-sans">{selectedTopic.summary}</p>
                  </div>
                )}

                {selectedTopic.explanation && (
                  <div className="p-3 rounded bg-cyber-red/5 border border-cyber-red/20">
                    <div className="flex items-center gap-1.5 text-cyber-red font-display text-[9px] uppercase tracking-wider font-semibold mb-1">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Decision Explanation
                    </div>
                    <p className="text-[10px] text-gray-200 leading-relaxed font-sans">{selectedTopic.explanation}</p>
                  </div>
                )}

                <div>
                  <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1.5">Canonical Source</h5>
                  <a
                    href={selectedTopic.canonicalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center justify-between p-2 rounded bg-black/40 border border-white/5 hover:border-cyber-cyan/30 text-[10px] text-cyber-cyan transition-colors"
                  >
                    <span className="truncate font-mono">{selectedTopic.canonicalUrl.replace(/^https?:\/\//, '')}</span>
                    <ExternalLink className="w-3 h-3 flex-shrink-0" />
                  </a>
                </div>

                <div className="grid grid-cols-2 gap-3 border-t border-white/5 pt-3 font-mono text-[9px] text-gray-400">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Published</span>
                    <span className="text-white">{fmtTime(selectedTopic.publishedAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Fetched</span>
                    <span className="text-white">{timeAgo(selectedTopic.fetchedAt)}</span>
                  </div>
                </div>
              </div>
            </GlassCard>
          ) : (
            <div className="border border-dashed border-white/5 rounded-xl p-8 text-center bg-black/20 text-gray-500 flex flex-col items-center justify-center">
              <Info className="w-6 h-6 mb-2 text-gray-600" />
              <p className="text-[10px] uppercase tracking-widest font-mono">No Candidate Selected</p>
              <p className="text-[9px] text-gray-600 mt-0.5">Click a candidate in the queue to inspect its persisted audit log</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
