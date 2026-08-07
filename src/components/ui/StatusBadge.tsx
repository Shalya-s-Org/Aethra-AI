import React from 'react';
import { cn } from '../../utils/cn';

interface StatusBadgeProps {
  status: 'active' | 'idle' | 'scanning' | 'filtering' | 'reasoning' | 'memory_check' | 'writing' | 'publishing' | 'learning' | 'inactive';
  className?: string;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, className }) => {
  const configs = {
    inactive: { label: 'Offline', color: 'bg-red-500', text: 'text-red-400', border: 'border-red-500/20' },
    active: { label: 'Active', color: 'bg-cyber-cyan animate-pulse', text: 'text-cyber-cyan', border: 'border-cyber-cyan/20' },
    idle: { label: 'Monitoring', color: 'bg-cyber-cyan/60 animate-pulse', text: 'text-cyber-cyan/95', border: 'border-cyber-cyan/20' },
    scanning: { label: 'Scanning', color: 'bg-blue-400 animate-pulse', text: 'text-blue-400', border: 'border-blue-400/20' },
    filtering: { label: 'Filtering', color: 'bg-yellow-400 animate-pulse', text: 'text-yellow-400', border: 'border-yellow-400/20' },
    reasoning: { label: 'Reasoning', color: 'bg-cyber-purple animate-pulse', text: 'text-cyber-purple', border: 'border-cyber-purple/20' },
    memory_check: { label: 'Memory Check', color: 'bg-purple-500 animate-pulse', text: 'text-purple-400', border: 'border-purple-500/20' },
    writing: { label: 'Writing Draft', color: 'bg-indigo-400 animate-pulse', text: 'text-indigo-400', border: 'border-indigo-400/20' },
    publishing: { label: 'Publishing', color: 'bg-cyber-emerald animate-pulse', text: 'text-cyber-emerald', border: 'border-cyber-emerald/20' },
    learning: { label: 'Learning Node', color: 'bg-emerald-400 animate-pulse', text: 'text-emerald-400', border: 'border-emerald-400/20' },
  };

  const config = configs[status] || configs.idle;

  return (
    <div className={cn(
      "inline-flex items-center gap-2 px-3 py-1 rounded-full border bg-black/40 font-display text-[10px] tracking-wider uppercase font-semibold",
      config.border,
      config.text,
      className
    )}>
      <span className={cn("w-1.5 h-1.5 rounded-full", config.color)} />
      {config.label}
    </div>
  );
};
