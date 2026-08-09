"use client";

import React, { useState, useEffect } from 'react';
import { useAgent } from '../../context/AgentContext';
import { LayoutDashboard, Radio, Database, Scale, Eye, BarChart3, Settings, Power, Activity, History } from 'lucide-react';
import { StatusBadge } from '../ui/StatusBadge';
import { cn } from '../../utils/cn';

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children }) => {
  const { activeTab, setActiveTab, status, isInitialized, resetAgent, config, hasLoadedSnapshot, agentId } = useAgent();
  const [timeString, setTimeString] = useState('');

  // Clock tick
  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      setTimeString(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' UTC');
    };
    updateClock();
    const interval = setInterval(updateClock, 1000);
    return () => clearInterval(interval);
  }, []);

  const navItems = [
    { id: 'dashboard', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'feed', label: 'Publication Feed', icon: <Radio className="w-4 h-4" /> },
    { id: 'memory', label: 'Knowledge Memory', icon: <Database className="w-4 h-4" /> },
    { id: 'decisions', label: 'Editorial Decisions', icon: <Scale className="w-4 h-4" /> },
    { id: 'queue', label: 'Discovery Queue', icon: <Eye className="w-4 h-4" /> },
    { id: 'sources', label: 'Source Health', icon: <Activity className="w-4 h-4" /> },
    { id: 'runs', label: 'Run History', icon: <History className="w-4 h-4" /> },
    { id: 'analytics', label: 'Analytics Console', icon: <BarChart3 className="w-4 h-4" /> },
    { id: 'settings', label: 'Settings Console', icon: <Settings className="w-4 h-4" /> },
  ];

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-cyber-bg text-white cyber-grid font-sans">
      {/* Sidebar */}
      <aside className="w-64 border-r border-white/5 bg-black/40 backdrop-blur-md flex flex-col justify-between">
        <div>
          {/* Brand header */}
          <div className="p-6 border-b border-white/5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded bg-gradient-to-br from-cyber-cyan to-cyber-purple flex items-center justify-center font-display font-extrabold text-black text-xs tracking-tighter">
                Æ
              </div>
              <span className="font-display font-bold tracking-widest text-xs">AETHRA AI</span>
            </div>
            <div className="px-1.5 py-0.5 rounded bg-cyber-cyan/15 text-cyber-cyan border border-cyber-cyan/30 text-[8px] font-mono tracking-wider">
              V0.9
            </div>
          </div>

          {/* Persona quick display */}
          <div className="p-4 border-b border-white/5 bg-white/2">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-cyber-purple/10 flex items-center justify-center border border-cyber-purple/30">
                <span className="font-display text-xs text-cyber-purple font-bold">
                  {config.name.slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="truncate">
                <div className="font-display text-xs font-bold text-white truncate">{config.name}</div>
                <div className="text-[9px] text-gray-500 font-mono truncate uppercase">{config.role}</div>
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="p-4 space-y-1">
            {navItems.map(item => (
              <button
                key={item.id}
                onClick={() => isInitialized && setActiveTab(item.id)}
                disabled={!isInitialized}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2 rounded text-xs transition-all cursor-pointer font-display tracking-wider text-left",
                  !isInitialized && "opacity-30 cursor-not-allowed",
                  isInitialized && activeTab === item.id 
                    ? "bg-cyber-cyan/10 text-cyber-cyan border-l-2 border-cyber-cyan font-bold" 
                    : "text-gray-400 hover:text-white hover:bg-white/3"
                )}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Sidebar Footer Controls */}
        <div className="p-4 border-t border-white/5 space-y-3">
          <div className="flex items-center justify-between text-[9px] font-mono text-gray-500 uppercase tracking-widest px-2">
            <span>Systems Status</span>
            <span className="text-cyber-emerald">Nominal</span>
          </div>

          {isInitialized && (
            <button
              onClick={resetAgent}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded border border-cyber-red/20 text-cyber-red hover:bg-cyber-red/10 transition-colors text-[10px] font-display uppercase tracking-widest font-bold cursor-pointer"
            >
              <Power className="w-3.5 h-3.5" />
              Reset Analyst
            </button>
          )}
        </div>
      </aside>

      {/* Main Panel Content Area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header */}
        <header className="h-16 border-b border-white/5 bg-black/20 backdrop-blur-md px-8 flex items-center justify-between relative z-10">
          <div className="flex items-center gap-4">
            <StatusBadge status={status} />
            {isInitialized && (
              <span className="text-xs text-gray-500 font-mono hidden md:inline">
                {`// Pipeline Trigger Cycle Interval: ${config.frequency}m`}
              </span>
            )}
          </div>
          
          <div className="flex items-center gap-4">
            {/* Clock Widget */}
            <div className="font-mono text-xs text-cyber-cyan font-semibold bg-cyber-cyan/5 px-3 py-1.5 rounded border border-cyber-cyan/15">
              {timeString || "00:00:00 UTC"}
            </div>
          </div>
        </header>

        {/* View Layout wrapper */}
        <main className="flex-1 overflow-y-auto p-8 relative">
          {agentId === 'demo-dashboard' && (
            <div className="mb-5 rounded border border-cyber-amber/30 bg-cyber-amber/10 px-4 py-3 text-xs text-cyber-amber">
              Demo data is displayed while Vercel has no shared persistent database. Initialize an analyst after connecting durable storage to replace it with live data.
            </div>
          )}
          {isInitialized && !hasLoadedSnapshot ? (
            <div className="space-y-6" aria-busy="true" aria-label="Loading agent telemetry">
              <div className="space-y-2">
                <div className="h-6 w-56 rounded bg-white/5 animate-pulse" />
                <div className="h-3 w-80 rounded bg-white/5 animate-pulse" />
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-24 rounded-xl border border-white/5 bg-white/3 animate-pulse" />
                ))}
              </div>
              <div className="h-64 rounded-xl border border-white/5 bg-white/3 animate-pulse" />
              <div className="h-40 rounded-xl border border-white/5 bg-white/3 animate-pulse" />
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
};
