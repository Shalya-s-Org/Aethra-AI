"use client";

import React, { useState, useMemo } from 'react';
import { useAgent } from '../../context/AgentContext';
import { GlassCard } from '../ui/GlassCard';
import { Database, Sparkles, Clock, Info } from 'lucide-react';
import { cn } from '../../utils/cn';

interface KnowledgeNode {
  id: string;
  label: string;
  group: 'organization' | 'model' | 'capability' | 'protocol' | 'architecture' | 'security' | 'infra';
  details: string;
  x: number;
  y: number;
  timestamp: string;
  connections?: string[];
}

const STATIC_CHAIN_NODES: KnowledgeNode[] = [
  { id: "node-1", label: "OpenAI", group: "organization", details: "Core LLM research lab. Historical memory database logs o1 reasoning benchmarks and GPT-4 API parameter optimizations.", x: 50, y: 180, timestamp: "2026-08-07T08:00:00Z", connections: ["GPT-5"] },
  { id: "node-2", label: "GPT-5", group: "model", details: "Next-generation frontier model. Active predictions track speculative mixture-of-agents routing and latent reasoning compressions.", x: 100, y: 250, timestamp: "2026-08-07T09:12:00Z", connections: ["OpenAI", "Reasoning"] },
  { id: "node-3", label: "Reasoning", group: "capability", details: "System-2 thinking paradigm. Focuses on shifting LLM compute budgets from training to test-time search and Monte Carlo tree search algorithms.", x: 150, y: 170, timestamp: "2026-08-07T10:05:00Z", connections: ["GPT-5", "MCP"] },
  { id: "node-4", label: "MCP", group: "protocol", details: "Model Context Protocol by Anthropic. Standardized open API for connecting LLMs to developmental files, databases, and local tooling interfaces.", x: 200, y: 240, timestamp: "2026-08-07T12:00:00Z", connections: ["Reasoning", "RAG"] },
  { id: "node-5", label: "RAG", group: "architecture", details: "Retrieval-Augmented Generation. Memory index tracks GraphRAG embeddings, hybrid dense-sparse vectors, and metadata isolation techniques.", x: 250, y: 160, timestamp: "2026-08-07T14:30:00Z", connections: ["MCP", "Security"] },
  { id: "node-6", label: "Security", group: "security", details: "Threat boundary maps. Examines injection vulnerabilities inside metadata filters and sandboxing environments for agent tool-calls.", x: 300, y: 230, timestamp: "2026-08-07T16:15:00Z", connections: ["RAG", "Inference"] },
  { id: "node-7", label: "Inference", group: "infra", details: "Production deployment parameters. Analyzes memory-bandwidth barriers, KV cache pruning, MLA rank compressions, and Edge runtime speedups.", x: 350, y: 170, timestamp: "2026-08-07T18:40:00Z", connections: ["Security"] }
];

export const MemoryEngine: React.FC = () => {
  const { memoryNodes, config } = useAgent();
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const groups = [
    { id: 'all', label: 'All Memory' },
    { id: 'protocol', label: 'Topics' },
    { id: 'architecture', label: 'Opinions' },
    { id: 'model', label: 'Predictions' },
    { id: 'infra', label: 'Style Heuristics' }
  ];

  // Map backend groups to SVG styling classes
  const mapGroup = (group: string): 'organization' | 'model' | 'capability' | 'protocol' | 'architecture' | 'security' | 'infra' => {
    switch (group) {
      case 'topic': return 'protocol';
      case 'opinion': return 'architecture';
      case 'prediction': return 'model';
      case 'style': return 'infra';
      default: return 'organization';
    }
  };

  // Convert context memoryNodes to coordinates-mapped SVG elements
  const allNodes = useMemo(() => {
    return memoryNodes.map((node, index) => {
      // Form a beautiful staggered horizontal grid inside the 520x360 SVG viewPort
      const cols = 5;
      const x = 50 + (index % cols) * 100;
      const y = 100 + Math.floor(index / cols) * 90 + Math.sin(index * 1.5) * 20;

      return {
        id: node.id,
        label: node.label,
        group: mapGroup(node.group),
        details: node.details,
        x: Math.min(x, 480),
        y: Math.min(y, 320),
        timestamp: node.timestamp,
        connections: node.connections
      };
    });
  }, [memoryNodes]);

  // Filtering nodes
  const filteredNodes = useMemo(() => {
    if (selectedGroup === 'all') return allNodes;
    return allNodes.filter(n => n.group === selectedGroup);
  }, [selectedGroup, allNodes]);

  // Selected Node details
  const activeNodeId = selectedNodeId || (allNodes[0]?.id || null);
  const selectedNode = useMemo(() => {
    return allNodes.find(n => n.id === activeNodeId);
  }, [activeNodeId, allNodes]);

  // Compute detailed relationships for explainability
  const nodeDetails = useMemo(() => {
    if (!selectedNode) return null;
    
    return {
      related: [
        `${config.domain} Ingest of ${selectedNode.label}`,
        `Heuristic validation indexing of category: ${selectedNode.group}`
      ],
      mentions: [
        `Vector node ingress: ${new Date(selectedNode.timestamp).toLocaleTimeString()} UTC`,
        `Semantic correlation index committed`
      ],
      connected: selectedNode.connections || ["Core Node"],
      relationships: [
        `Direct logical parent: ${selectedNode.group} category`,
        `Vector Cosine Similarity match: ${10 + (selectedNode.label.length % 15)}% unique`
      ],
      history: [
        `Committed to vector memory database`,
        `Autonomous agent index sweep confirmed`
      ]
    };
  }, [selectedNode, config.domain]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="font-display text-xl font-bold tracking-wider text-white uppercase">
            Knowledge Vector Memory
          </h2>
          <p className="text-xs text-gray-500 uppercase tracking-widest font-mono mt-0.5">
            Neural deduplication index of registered publications
          </p>
        </div>

        <div className="flex items-center gap-2 bg-cyber-purple/10 border border-cyber-purple/20 text-cyber-purple px-3 py-1.5 rounded text-xs font-display uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5" />
          Index Live ({allNodes.length} Nodes)
        </div>
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Interactive SVG Graph */}
        <div className="lg:col-span-2 flex flex-col h-[400px]">
          <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
            {groups.map(g => (
              <button
                key={g.id}
                onClick={() => setSelectedGroup(g.id)}
                className={cn(
                  "px-3 py-1 text-[10px] font-display uppercase tracking-wider border rounded cursor-pointer transition-colors whitespace-nowrap",
                  selectedGroup === g.id
                    ? "bg-cyber-cyan/15 text-cyber-cyan border-cyber-cyan/35 shadow-[0_0_10px_rgba(0,240,255,0.05)]"
                    : "bg-black/40 text-gray-400 border-white/5 hover:text-white"
                )}
              >
                {g.label}
              </button>
            ))}
          </div>

          <div className="flex-1 rounded border border-white/5 bg-black/40 overflow-hidden relative">
            <svg 
              viewBox="0 0 520 360" 
              className="w-full h-full"
            >
              {/* Connected Line Paths */}
              {allNodes.map((node, idx) => {
                if (idx === allNodes.length - 1) return null;
                const nextNode = allNodes[idx + 1];
                return (
                  <g key={`path-${idx}`}>
                    {/* Glowing path */}
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
                    
                    {/* Tiny animated signal dot along paths */}
                    <circle r="2" fill="#00f0ff" className="animate-ping">
                      <animateMotion 
                        dur="6s" 
                        repeatCount="indefinite" 
                        path={`M ${node.x} ${node.y} L ${nextNode.x} ${nextNode.y}`}
                      />
                    </circle>
                  </g>
                );
              })}

              {/* Node Circles */}
              {allNodes.map((node) => {
                const isSelected = activeNodeId === node.id;
                const isFilteredOut = selectedGroup !== 'all' && node.group !== selectedGroup;

                const groupColors = {
                  organization: { stroke: "#3b82f6", fill: "rgba(59,130,246,0.15)" },
                  model: { stroke: "#a855f7", fill: "rgba(168,85,247,0.15)" },
                  capability: { stroke: "#ea580c", fill: "rgba(234,88,12,0.15)" },
                  protocol: { stroke: "#00f0ff", fill: "rgba(0,240,255,0.15)" },
                  architecture: { stroke: "#10b981", fill: "rgba(16,185,129,0.15)" },
                  security: { stroke: "#f43f5e", fill: "rgba(244,63,94,0.15)" },
                  infra: { stroke: "#ec4899", fill: "rgba(236,72,153,0.15)" }
                };

                const colors = groupColors[node.group] || groupColors.organization;

                return (
                  <g 
                    key={node.id} 
                    className={cn("cursor-pointer group transition-all duration-300", isFilteredOut && "opacity-20")}
                    onClick={() => setSelectedNodeId(node.id)}
                  >
                    {/* Glowing outer circle */}
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={isSelected ? 16 : 11}
                      fill="transparent"
                      stroke={colors.stroke}
                      strokeWidth="1.5"
                      opacity={isSelected ? 0.8 : 0.2}
                      className="group-hover:opacity-85 transition-all duration-300"
                    />

                    {/* Central circle */}
                    <circle
                      cx={node.x}
                      cy={node.y}
                      r={isSelected ? 7 : 5}
                      fill={colors.fill}
                      stroke={colors.stroke}
                      strokeWidth="1.5"
                      className="transition-all duration-300"
                    />

                    {/* Labels */}
                    <text
                      x={node.x}
                      y={node.y - 15}
                      textAnchor="middle"
                      fill={isSelected ? '#ffffff' : 'rgba(255, 255, 255, 0.45)'}
                      fontSize="8"
                      fontWeight="bold"
                      fontFamily="var(--font-display)"
                      className="transition-colors duration-300 tracking-wide"
                    >
                      {node.label}
                    </text>
                  </g>
                );
              })}
            </svg>

            {/* Help info overlay */}
            <div className="absolute bottom-3 left-3 flex items-center gap-1.5 text-[8px] font-mono text-gray-500 uppercase tracking-widest">
              <Info className="w-3.5 h-3.5 text-cyber-cyan" /> Click nodes to inspect vector index relationships
            </div>
          </div>
        </div>

        {/* Right Detail Inspect Panel Drawer */}
        <div className="lg:col-span-1 space-y-4">
          {selectedNode ? (
            <GlassCard className="border-white/10" glowColor="cyan">
              <div className="flex justify-between items-start border-b border-white/5 pb-4 mb-4">
                <div>
                  <h4 className="font-display text-xs font-bold tracking-wider text-white uppercase">
                    Node Payload Inspect
                  </h4>
                  <p className="text-[8px] text-cyber-cyan font-mono uppercase tracking-widest mt-0.5">
                    {selectedNode.id}
                  </p>
                </div>
                
                <span className={cn(
                  "px-2 py-0.5 rounded text-[8px] font-display uppercase tracking-widest font-bold",
                  selectedNode.group === 'protocol' && "bg-cyber-cyan/15 text-cyber-cyan border border-cyber-cyan/30",
                  selectedNode.group === 'organization' && "bg-blue-500/15 text-blue-400 border border-blue-500/30",
                  selectedNode.group === 'model' && "bg-cyber-purple/15 text-cyber-purple border border-cyber-purple/30",
                  selectedNode.group === 'capability' && "bg-orange-500/15 text-orange-400 border border-orange-500/30",
                  selectedNode.group === 'architecture' && "bg-cyber-emerald/15 text-cyber-emerald border border-cyber-emerald/30",
                  selectedNode.group === 'security' && "bg-red-500/15 text-red-400 border border-red-500/30",
                  selectedNode.group === 'infra' && "bg-pink-500/15 text-pink-400 border border-pink-500/30"
                )}>
                  {selectedNode.group}
                </span>
              </div>

              <div className="space-y-4 text-[10px] font-mono leading-relaxed">
                <div>
                  <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1">Entity Label</h5>
                  <p className="text-xs font-semibold text-cyber-cyan font-display">
                    {selectedNode.label}
                  </p>
                </div>

                <div>
                  <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1">Vector Storage Summary</h5>
                  <p className="text-[9.5px] text-gray-300 leading-relaxed font-sans bg-black/40 border border-white/5 p-3 rounded">
                    {selectedNode.details}
                  </p>
                </div>

                {/* Related Publications */}
                <div>
                  <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1">Related Publications</h5>
                  <div className="space-y-1 bg-black/40 border border-white/5 p-2 rounded">
                    {nodeDetails?.related.map((pub, idx) => (
                      <div key={idx} className="text-gray-300 leading-normal">// {pub}</div>
                    ))}
                  </div>
                </div>

                {/* Previous Mentions */}
                <div>
                  <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1">Previous Mentions</h5>
                  <div className="space-y-1 bg-black/40 border border-white/5 p-2 rounded">
                    {nodeDetails?.mentions.map((men, idx) => (
                      <div key={idx} className="text-gray-300 leading-normal">// {men}</div>
                    ))}
                  </div>
                </div>

                {/* Connected Topics */}
                <div>
                  <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1">Connected Topics</h5>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {nodeDetails?.connected.map((conn, idx) => (
                      <span key={idx} className="px-1.5 py-0.5 rounded bg-white/5 text-gray-400 text-[8px] font-mono">
                        {conn}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Knowledge Relationships */}
                <div>
                  <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1">Knowledge Relationships</h5>
                  <div className="space-y-1 bg-black/40 border border-white/5 p-2 rounded">
                    {nodeDetails?.relationships.map((rel, idx) => (
                      <div key={idx} className="text-cyber-cyan font-bold">// {rel}</div>
                    ))}
                  </div>
                </div>

                {/* Memory History */}
                <div>
                  <h5 className="text-[9px] font-mono text-gray-500 uppercase tracking-widest mb-1">Memory History</h5>
                  <div className="space-y-1 bg-black/40 border border-white/5 p-2 rounded">
                    {nodeDetails?.history.map((his, idx) => (
                      <div key={idx} className="text-gray-300">// {his}</div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-white/5 pt-3">
                  <div className="flex justify-between items-center text-[9px] font-mono text-gray-500">
                    <span>Audit Time:</span>
                    <span>{new Date(selectedNode.timestamp).toLocaleTimeString()} UTC</span>
                  </div>
                </div>
              </div>
            </GlassCard>
          ) : (
            <GlassCard className="border-white/5 p-5 text-center bg-black/20 text-gray-500 flex flex-col items-center justify-center h-full max-h-[250px]">
              <Database className="w-8 h-8 mb-2 text-gray-600 animate-pulse" />
              <p className="text-[10px] uppercase tracking-widest font-mono">Select Graph Entity</p>
              <p className="text-[9px] text-gray-600 mt-0.5">Click any circle in the reasoning chain to query metadata parameters</p>
            </GlassCard>
          )}

          {/* Ingestion timeline logs */}
          <GlassCard className="p-4 border-white/5 bg-white/1" glowColor="none">
            <h4 className="font-display text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-cyber-cyan" />
              Node Ingestion Logs
            </h4>
            
            <div className="space-y-3 relative before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[1px] before:bg-white/5 pl-5 max-h-[140px] overflow-y-auto pr-1">
              {filteredNodes.map((node) => (
                <div key={node.id} className="relative text-[10px] cursor-pointer" onClick={() => setSelectedNodeId(node.id)}>
                  <span className={cn(
                    "absolute -left-[21px] top-1 w-1.5 h-1.5 rounded-full border border-black",
                    activeNodeId === node.id ? "bg-cyber-cyan animate-pulse" : "bg-gray-600"
                  )} />
                  <div className="font-mono text-[8px] text-gray-500">
                    {new Date(node.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} UTC
                  </div>
                  <div className="text-white font-medium truncate mt-0.5">
                    {node.label}
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>
    </div>
  );
};
