"use client";

import React, { useState } from 'react';
import { useAgent } from '../../context/AgentContext';
import { GlassCard } from '../ui/GlassCard';
import { Eye, ShieldAlert, CheckCircle, HelpCircle, FileText, ExternalLink, Search, Info } from 'lucide-react';
import { cn } from '../../utils/cn';

export const DiscoveryQueue: React.FC = () => {
  const { discoveredTopics, decisions } = useAgent();
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);

  // Combine discovered queue and processed decisions to show a comprehensive list
  const allDiscovered = React.useMemo(() => {
    // Merge both lists, filter out duplicates by ID
    const merged = [...discoveredTopics, ...decisions];
    const seen = new Set();
    return merged.filter(el => {
      const duplicate = seen.has(el.id);
      seen.add(el.id);
      return !duplicate;
    });
  }, [discoveredTopics, decisions]);

  const filteredTopics = allDiscovered.filter(topic =>
    topic.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
    topic.source.toLowerCase().includes(searchTerm.toLowerCase()) ||
    topic.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedTopic = allDiscovered.find(t => t.id === selectedTopicId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="font-display text-xl font-bold tracking-wider text-white uppercase">
            Discovery Queue
          </h2>
          <p className="text-xs text-gray-500 uppercase tracking-widest font-mono mt-0.5">
            Realtime repository ingestion logs
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full md:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
          <input
            type="text"
            placeholder="Filter discovered feeds..."
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="w-full bg-black/40 border border-white/5 rounded px-3 py-1.5 pl-9 text-xs text-white focus:outline-none focus:border-cyber-cyan font-mono"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Topic List */}
        <div className="lg:col-span-2 space-y-3">
          {filteredTopics.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-white/5 rounded-xl bg-black/20">
              <Eye className="w-8 h-8 text-gray-600 mb-2" />
              <p className="text-xs text-gray-500 uppercase tracking-wider">Queue is empty or filtered</p>
              <p className="text-[10px] text-gray-600 font-mono mt-0.5">Initialize agent or modify filter query</p>
            </div>
          ) : (
            filteredTopics.map((topic) => {
              const isSelected = selectedTopicId === topic.id;
              
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
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[8px] font-display uppercase tracking-widest font-bold",
                        topic.recommendation === 'Accept' && "bg-cyber-emerald/15 text-cyber-emerald border border-cyber-emerald/30",
                        topic.recommendation === 'Reject' && "bg-cyber-red/15 text-cyber-red border border-cyber-red/30",
                        topic.recommendation === 'Investigate' && "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30"
                      )}>
                        {topic.recommendation === 'Accept' ? 'Accepted' : topic.recommendation === 'Reject' ? 'Rejected' : 'Investigating'}
                      </span>
                      
                      <span className="text-[9px] text-gray-500 font-mono">
                        {topic.category}
                      </span>
                    </div>

                    <h3 className="font-display text-xs font-semibold text-white tracking-wider leading-relaxed">
                      {topic.title}
                    </h3>

                    <div className="flex items-center gap-4 text-[9px] font-mono text-gray-500">
                      <span>Source: <strong className="text-gray-400">{topic.source}</strong></span>
                      <span>Ingested: <strong className="text-gray-400">{topic.freshness}</strong></span>
                    </div>
                  </div>

                  {/* Right scores */}
                  <div className="flex items-center gap-4 flex-shrink-0 text-right">
                    <div>
                      <div className="text-[8px] text-gray-500 font-mono uppercase">Credibility</div>
                      <div className={cn(
                        "font-mono text-xs font-semibold",
                        topic.credibilityScore > 90 ? "text-cyber-cyan" : "text-gray-300"
                      )}>{topic.credibilityScore}%</div>
                    </div>
                    <div>
                      <div className="text-[8px] text-gray-500 font-mono uppercase">Trend Velocity</div>
                      <div className="font-mono text-xs font-semibold text-white">{topic.trendScore}%</div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Selected Topic Detail Drawer / Column */}
        <div className="lg:col-span-1">
          {selectedTopic ? (
            <GlassCard className="sticky top-6 border-white/10" glowColor={selectedTopic.recommendation === 'Accept' ? 'cyan' : 'purple'}>
              <div className="flex justify-between items-start border-b border-white/5 pb-4 mb-4">
                <div>
                  <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase">
                    Audit Review Log
                  </h4>
                  <p className="text-[8px] text-cyber-cyan font-mono uppercase tracking-widest mt-0.5">
                    {selectedTopic.id}
                  </p>
                </div>

                <span className={cn(
                  "px-2 py-0.5 rounded text-[8px] font-display uppercase tracking-widest font-bold",
                  selectedTopic.recommendation === 'Accept' && "bg-cyber-emerald/15 text-cyber-emerald border border-cyber-emerald/30",
                  selectedTopic.recommendation === 'Reject' && "bg-cyber-red/15 text-cyber-red border border-cyber-red/30",
                  selectedTopic.recommendation === 'Investigate' && "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30"
                )}>
                  {selectedTopic.recommendation === 'Accept' ? 'Accept' : selectedTopic.recommendation === 'Reject' ? 'Reject' : 'Queue'}
                </span>
              </div>

              <div className="space-y-4">
                <div>
                  <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1">Title</h5>
                  <p className="text-xs font-semibold text-white leading-relaxed">
                    {selectedTopic.title}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 border-y border-white/5 py-3">
                  <div>
                    <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-0.5">Credibility Score</h5>
                    <div className="text-sm font-bold font-mono text-white">{selectedTopic.credibilityScore}%</div>
                  </div>
                  <div>
                    <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-0.5">Trend Score</h5>
                    <div className="text-sm font-bold font-mono text-white">{selectedTopic.trendScore}%</div>
                  </div>
                </div>

                {selectedTopic.recommendation === 'Reject' && selectedTopic.rejectionReason && (
                  <div className="p-3 rounded bg-cyber-red/5 border border-cyber-red/20">
                    <div className="flex items-center gap-1.5 text-cyber-red font-display text-[9px] uppercase tracking-wider font-semibold mb-1">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Rejection Explanation
                    </div>
                    <p className="text-[10px] text-cyber-red leading-relaxed font-sans">
                      {selectedTopic.rejectionReason}
                    </p>
                  </div>
                )}

                {selectedTopic.recommendation === 'Accept' && selectedTopic.detailedAnalysis && (
                  <div className="p-3 rounded bg-cyber-emerald/5 border border-cyber-emerald/20">
                    <div className="flex items-center gap-1.5 text-cyber-emerald font-display text-[9px] uppercase tracking-wider font-semibold mb-1">
                      <CheckCircle className="w-3.5 h-3.5" />
                      Ingested Synopsis
                    </div>
                    <p className="text-[10px] text-gray-300 leading-relaxed font-sans">
                      {selectedTopic.detailedAnalysis}
                    </p>
                  </div>
                )}

                {selectedTopic.sources && selectedTopic.sources.length > 0 && (
                  <div>
                    <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1.5">Scanned Sources</h5>
                    <div className="space-y-1">
                      {selectedTopic.sources.map((src, i) => (
                        <a
                          key={`src-${i}-${src}`}
                          href={`https://${src}`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center justify-between p-2 rounded bg-black/40 border border-white/5 hover:border-cyber-cyan/30 text-[10px] text-gray-400 hover:text-white transition-colors"
                        >
                          <span className="truncate font-mono">{src}</span>
                          <ExternalLink className="w-3 h-3 flex-shrink-0" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </GlassCard>
          ) : (
            <div className="border border-dashed border-white/5 rounded-xl p-8 text-center bg-black/20 text-gray-500 flex flex-col items-center justify-center">
              <Info className="w-6 h-6 mb-2 text-gray-600" />
              <p className="text-[10px] uppercase tracking-widest font-mono">No Audit Logs Loaded</p>
              <p className="text-[9px] text-gray-600 mt-0.5">Click a topic in the queue to examine its neural properties</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
