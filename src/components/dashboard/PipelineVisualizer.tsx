"use client";

import React from 'react';
import { Search, Filter, Cpu, Database, FileText, UploadCloud, GraduationCap } from 'lucide-react';
import { useAgent, AgentStatus } from '../../context/AgentContext';
import { cn } from '../../utils/cn';

interface Step {
  status: AgentStatus;
  label: string;
  countKey: string;
  icon: React.ReactNode;
  color: string;
}

export const PipelineVisualizer: React.FC = () => {
  const { status, activeTopic, pipelineProgress, currentActionDetails, pipelineStats } = useAgent();

  const pipelineSteps: Step[] = [
    { status: 'scanning', label: 'OBSERVE', countKey: 'AI Ecosystem', icon: <Search className="w-4 h-4" />, color: 'text-blue-400 border-blue-500/20 bg-blue-500/5' },
    { status: 'filtering', label: 'PURGE', countKey: 'Low-Value', icon: <Filter className="w-4 h-4" />, color: 'text-yellow-400 border-yellow-500/20 bg-yellow-500/5' },
    { status: 'reasoning', label: 'EVALUATE', countKey: 'Significance', icon: <Cpu className="w-4 h-4" />, color: 'text-purple-400 border-purple-500/20 bg-purple-500/5' },
    { status: 'memory_check', label: 'COMPARE', countKey: 'Memory Index', icon: <Database className="w-4 h-4" />, color: 'text-cyan-400 border-cyan-500/20 bg-cyan-500/5' },
    { status: 'writing', label: 'SYNTHESIZE', countKey: 'Report Draft', icon: <FileText className="w-4 h-4" />, color: 'text-indigo-400 border-indigo-500/20 bg-indigo-500/5' },
    { status: 'publishing', label: 'SHARE', countKey: 'Tech Insight', icon: <UploadCloud className="w-4 h-4" />, color: 'text-emerald-400 border-emerald-500/20 bg-emerald-500/5' },
    { status: 'learning', label: 'LEARN', countKey: 'From Today', icon: <GraduationCap className="w-4 h-4" />, color: 'text-pink-400 border-pink-500/20 bg-pink-500/5' }
  ];

  return (
    <div className="border border-white/5 bg-black/40 rounded-xl p-5 backdrop-blur-md relative overflow-hidden">
      {status !== 'idle' && status !== 'inactive' && (
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-cyber-cyan to-transparent animate-pulse" />
      )}

      <div className="flex justify-between items-center mb-5">
        <div>
          <h4 className="font-display text-[10px] font-bold tracking-widest text-white uppercase flex items-center gap-2">
            <span className={cn("w-1.5 h-1.5 rounded-full", status !== 'idle' && status !== 'inactive' ? "bg-cyber-cyan animate-ping" : "bg-gray-600")} />
            Pipeline Logic Ingestion Load
          </h4>
        </div>

        {activeTopic && (
          <div className="text-right">
            <span className="font-mono text-[8px] text-cyber-cyan uppercase tracking-widest animate-pulse mr-2">
              Evaluating input:
            </span>
            <span className="font-display text-[10px] font-bold text-white max-w-[200px] truncate">
              {activeTopic.title}
            </span>
          </div>
        )}
      </div>

      {/* Steps Pipeline */}
      <div className="grid grid-cols-7 gap-2.5 relative">
        {pipelineSteps.map((step, idx) => {
          const isActive = status === step.status;
          const stepOrder = ['inactive', 'idle', 'scanning', 'filtering', 'reasoning', 'memory_check', 'writing', 'publishing', 'learning'];
          const isDone = stepOrder.indexOf(status) > stepOrder.indexOf(step.status) && status !== 'idle' && status !== 'inactive';

          return (
            <div key={idx} className="flex flex-col items-center">
              <div className={cn(
                "w-9 h-9 rounded-lg border flex items-center justify-center transition-all duration-300 relative",
                step.color,
                isActive && "border-cyber-cyan scale-110 shadow-[0_0_12px_rgba(0,240,255,0.25)] bg-cyber-cyan/10",
                isDone && "border-cyber-emerald bg-cyber-emerald/5 opacity-60"
              )}>
                {step.icon}
                {isActive && (
                  <span className="absolute -inset-1 rounded-lg border border-cyber-cyan/35 animate-ping pointer-events-none" />
                )}
              </div>
              <span className={cn(
                "font-display text-[8px] uppercase tracking-widest mt-2 font-bold",
                isActive ? "text-cyber-cyan" : isDone ? "text-cyber-emerald" : "text-gray-400"
              )}>
                {step.label}
              </span>
              <span className="font-mono text-[7px] text-gray-500 uppercase mt-0.5 tracking-wider text-center">
                {step.countKey}
              </span>
              
              {isActive && (
                <div className="w-8 h-[2px] bg-white/5 rounded-full mt-1.5 overflow-hidden">
                  <div className="h-full bg-cyber-cyan transition-all duration-100" style={{ width: `${pipelineProgress}%` }} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Details Box */}
      <div className="bg-black/60 border border-white/5 rounded mt-4 px-3 py-2 font-mono text-[9px] leading-relaxed flex items-center justify-between text-gray-400">
        <div className="flex items-center gap-1.5">
          <span className="text-cyber-cyan animate-pulse">&gt;</span>
          <span className="text-white">{currentActionDetails}</span>
        </div>
      </div>
    </div>
  );
};
