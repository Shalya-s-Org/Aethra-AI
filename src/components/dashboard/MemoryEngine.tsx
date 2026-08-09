"use client";

import React, { useState, useMemo } from 'react';
import { useAgent } from '../../context/AgentContext';
import { GlassCard } from '../ui/GlassCard';
import { Database, Clock, Info, Layers } from 'lucide-react';
import { cn } from '../../utils/cn';
import { fmtTime, timeAgo } from './format';

// Durable editorial memory: every node is a row in the memory_entries table.
// The similarity index is token/keyword based (canonical URL + title hash +
// keyword overlap) — no vector embeddings are claimed anywhere in the UI.
export const MemoryEngine: React.FC = () => {
  const { memoryEntries } = useAgent();
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const groups = [
    { id: 'all', label: 'All Entries' },
    { id: 'short_term', label: 'Short-term' },
    { id: 'long_term', label: 'Long-term' },
    { id: 'editorial', label: 'Editorial' }
  ];

  // Map entries to coordinates-mapped SVG elements
  const allNodes = useMemo(() => {
    return memoryEntries.map((node, index) => {
      const cols = 5;
      const x = 50 + (index % cols) * 100;
      const y = 100 + Math.floor(index / cols) * 90 + Math.sin(index * 1.5) * 20;
      return {
        id: node.id,
        label: node.subject,
        kind: node.kind,
        content: node.content,
        importance: node.importance,
        occurrences: node.occurrences,
        firstSeenAt: node.firstSeenAt,
        lastSeenAt: node.lastSeenAt,
        relation: node.relation,
        identifiers: node.identifiers ?? [],
        themes: node.themes ?? [],
        x: Math.min(x, 480),
        y: Math.min(y, 320)
      };
    });
  }, [memoryEntries]);

  const filteredNodes = useMemo(() => {
    if (selectedGroup === 'all') return allNodes;
    return allNodes.filter(n => n.kind === selectedGroup);
  }, [selectedGroup, allNodes]);

  const activeNodeId = selectedNodeId || (allNodes[0]?.id || null);
  const selectedNode = useMemo(() => allNodes.find(n => n.id === activeNodeId), [activeNodeId, allNodes]);

  const kindColors: Record<string, { stroke: string; fill: string; label: string; cls: string }> = {
    short_term: { stroke: "#00f0ff", fill: "rgba(0,240,255,0.15)", label: "SHORT-TERM", cls: "bg-cyber-cyan/15 text-cyber-cyan border-cyber-cyan/30" },
    long_term: { stroke: "#a855f7", fill: "rgba(168,85,247,0.15)", label: "LONG-TERM", cls: "bg-cyber-purple/15 text-cyber-purple border-cyber-purple/30" },
    editorial: { stroke: "#10b981", fill: "rgba(16,185,129,0.15)", label: "EDITORIAL", cls: "bg-cyber-emerald/15 text-cyber-emerald border-cyber-emerald/30" }
  };

  // Editorial-memory continuity: the persisted relation of the newest evidence
  // to the persona's prior stance on the story (memory_entries metadata).
  const relationBadge = (relation: string | undefined) => {
    switch (relation) {
      case 'updates': return { label: 'UPDATES PRIOR STANCE', cls: 'bg-cyber-cyan/15 text-cyber-cyan border-cyber-cyan/30' };
      case 'contradicts': return { label: 'CONTRADICTS PRIOR STANCE', cls: 'bg-cyber-red/15 text-cyber-red border-cyber-red/30' };
      case 'confirms': return { label: 'CONFIRMS PRIOR STANCE', cls: 'bg-cyber-emerald/15 text-cyber-emerald border-cyber-emerald/30' };
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="font-display text-xl font-bold tracking-wider text-white uppercase">
            Durable Editorial Memory
          </h2>
          <p className="text-xs text-gray-500 uppercase tracking-widest font-mono mt-0.5">
            memory_entries table — token/keyword index, not vectors
          </p>
        </div>

        <div className="flex items-center gap-2 bg-cyber-purple/10 border border-cyber-purple/20 text-cyber-purple px-3 py-1.5 rounded text-xs font-display uppercase tracking-wider">
          <Database className="w-3.5 h-3.5" />
          Persisted ({allNodes.length} Entries)
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Visual Chain */}
        <GlassCard className="lg:col-span-2 p-5 bg-black/60 border-white/5 flex flex-col h-[480px]" glowColor="cyan">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase flex items-center gap-2">
                <Layers className="w-4 h-4 text-cyber-cyan" />
                Memory Subject Chain
              </h4>
              <p className="text-[9px] text-gray-500 uppercase tracking-widest font-mono mt-0.5">
                Subjects ordered by most recently seen
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {groups.map(g => (
                <button
                  key={g.id}
                  onClick={() => setSelectedGroup(g.id)}
                  className={cn(
                    "px-2 py-0.5 rounded text-[8px] font-display uppercase tracking-widest border transition-colors cursor-pointer",
                    selectedGroup === g.id
                      ? "bg-cyber-cyan/15 text-cyber-cyan border-cyber-cyan/30"
                      : "bg-black/40 text-gray-500 border-white/10 hover:text-white"
                  )}
                >
                  {g.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 rounded border border-white/5 bg-black/40 overflow-hidden relative">
            {allNodes.length === 0 ? (
              <div className="h-full flex items-center justify-center font-mono text-[10px] text-gray-600 uppercase tracking-widest">
                No memory entries persisted yet
              </div>
            ) : (
              <svg viewBox="0 0 520 360" className="w-full h-full">
                {filteredNodes.map((node, idx) => {
                  if (idx === filteredNodes.length - 1) return null;
                  const nextNode = filteredNodes[idx + 1];
                  return (
                    <g key={`path-${idx}`}>
                      <line
                        x1={node.x}
                        y1={node.y}
                        x2={nextNode.x}
                        y2={nextNode.y}
                        stroke="rgba(0, 240, 255, 0.25)"
                        strokeWidth="2"
                        strokeDasharray="4 4"
                        className="animate-pulse"
                      />
                    </g>
                  );
                })}

                {filteredNodes.map(node => {
                  const isSelected = activeNodeId === node.id;
                  const colors = kindColors[node.kind] || kindColors.short_term;
                  return (
                    <g
                      key={node.id}
                      className="cursor-pointer transition-all duration-300"
                      onClick={() => setSelectedNodeId(node.id)}
                    >
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={isSelected ? 16 : 11}
                        fill="transparent"
                        stroke={colors.stroke}
                        strokeWidth="1.5"
                        opacity={isSelected ? 0.8 : 0.2}
                      />
                      <circle
                        cx={node.x}
                        cy={node.y}
                        r={isSelected ? 7 : 5}
                        fill={colors.fill}
                        stroke={colors.stroke}
                        strokeWidth="1.5"
                      />
                      <text
                        x={node.x}
                        y={node.y - 15}
                        textAnchor="middle"
                        fill={isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.45)'}
                        fontSize="8"
                        fontWeight="bold"
                        fontFamily="var(--font-display)"
                      >
                        {node.label.length > 14 ? `${node.label.slice(0, 13)}…` : node.label}
                      </text>
                    </g>
                  );
                })}
              </svg>
            )}

            <div className="absolute bottom-3 left-3 flex items-center gap-1.5 text-[8px] font-mono text-gray-500 uppercase tracking-widest">
              <Info className="w-3.5 h-3.5 text-cyber-cyan" /> Click a subject to inspect its persisted content
            </div>
          </div>
        </GlassCard>

        {/* Detail Panel */}
        <div className="lg:col-span-1 space-y-4">
          {selectedNode ? (
            <GlassCard className="border-white/10" glowColor="cyan">
              <div className="flex justify-between items-start border-b border-white/5 pb-4 mb-4">
                <div>
                  <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase">
                    Memory Entry
                  </h4>
                  <p className="text-[8px] text-cyber-cyan font-mono uppercase tracking-widest mt-0.5">
                    {selectedNode.id}
                  </p>
                </div>
                <span className={cn("px-2 py-0.5 rounded text-[8px] font-display uppercase tracking-widest font-bold border", kindColors[selectedNode.kind]?.cls)}>
                  {kindColors[selectedNode.kind]?.label ?? selectedNode.kind}
                </span>
                {selectedNode.relation && (
                  <span className={cn("px-2 py-0.5 rounded text-[8px] font-display uppercase tracking-widest font-bold border", relationBadge(selectedNode.relation)?.cls)}>
                    {relationBadge(selectedNode.relation)?.label}
                  </span>
                )}
              </div>

              <div className="space-y-4 text-[10px] font-mono leading-relaxed">
                <div>
                  <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1">Subject</h5>
                  <p className="text-xs font-semibold text-cyber-cyan font-display">{selectedNode.label}</p>
                </div>

                <div>
                  <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1">Persisted Content</h5>
                  <p className="text-[9.5px] text-gray-300 leading-relaxed font-sans bg-black/40 border border-white/5 p-3 rounded">
                    {selectedNode.content}
                  </p>
                </div>

                {(selectedNode.identifiers.length > 0 || selectedNode.themes.length > 0) && (
                  <div className="space-y-1.5">
                    {selectedNode.identifiers.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {selectedNode.identifiers.map(id => (
                          <span key={id} className="px-1.5 py-0.5 rounded bg-black/40 border border-white/10 text-[8px] text-cyber-cyan font-mono">
                            {id}
                          </span>
                        ))}
                      </div>
                    )}
                    {selectedNode.themes.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {selectedNode.themes.map(t => (
                          <span key={t} className="px-1.5 py-0.5 rounded bg-cyber-purple/10 border border-cyber-purple/20 text-[8px] text-cyber-purple font-mono">
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 border-y border-white/5 py-3 text-[9px]">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Importance</span>
                    <span className="text-white">{selectedNode.importance}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Occurrences</span>
                    <span className="text-white">{selectedNode.occurrences}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">First seen</span>
                    <span className="text-white">{fmtTime(selectedNode.firstSeenAt)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Last seen</span>
                    <span className="text-white">{timeAgo(selectedNode.lastSeenAt)}</span>
                  </div>
                </div>
              </div>
            </GlassCard>
          ) : (
            <GlassCard className="border-white/5 p-5 text-center bg-black/20 text-gray-500 flex flex-col items-center justify-center h-full max-h-[250px]">
              <Database className="w-8 h-8 mb-2 text-gray-600 animate-pulse" />
              <p className="text-[10px] uppercase tracking-widest font-mono">Select Memory Subject</p>
              <p className="text-[9px] text-gray-600 mt-0.5">Click any subject in the chain to inspect its persisted entry</p>
            </GlassCard>
          )}

          {/* Entry log */}
          <GlassCard className="p-4 border-white/5 bg-white/1" glowColor="none">
            <h4 className="font-display text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-cyber-cyan" />
              Recent Entries (by last seen)
            </h4>

            <div className="space-y-3 relative before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[1px] before:bg-white/5 pl-5 max-h-[200px] overflow-y-auto pr-1">
              {filteredNodes.length === 0 && (
                <p className="text-[10px] text-gray-600 font-mono">No entries</p>
              )}
              {filteredNodes.slice(0, 20).map(node => (
                <div key={node.id} className="relative text-[10px] cursor-pointer" onClick={() => setSelectedNodeId(node.id)}>
                  <span className={cn(
                    "absolute -left-[21px] top-1 w-1.5 h-1.5 rounded-full border border-black",
                    activeNodeId === node.id ? "bg-cyber-cyan animate-pulse" : "bg-gray-600"
                  )} />
                  <div className="font-mono text-[8px] text-gray-500">{timeAgo(node.lastSeenAt)} · {node.kind}</div>
                  <div className="text-white font-medium truncate mt-0.5">{node.label}</div>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
};
