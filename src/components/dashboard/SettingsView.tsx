"use client";

import React, { useState } from 'react';
import { useAgent, AgentConfig } from '../../context/AgentContext';
import { GlassCard } from '../ui/GlassCard';
import { GlowButton } from '../ui/GlowButton';
import { Settings, Cpu, ShieldAlert, CheckCircle2 } from 'lucide-react';

export const SettingsView: React.FC = () => {
  const { config, initializeAgent, resetAgent } = useAgent();
  const [formData, setFormData] = useState<AgentConfig>({ ...config });
  const [isSaved, setIsSaved] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    initializeAgent(formData);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 3000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div>
        <h2 className="font-display text-xl font-bold tracking-wider text-white uppercase flex items-center gap-2">
          <Settings className="w-5 h-5 text-cyber-cyan" />
          Settings Console
        </h2>
        <p className="text-xs text-gray-500 uppercase tracking-widest font-mono mt-0.5">
          Modify active agent heuristics and telemetry parameters
        </p>
      </div>

      <GlassCard glowColor="cyan" className="p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="flex items-center justify-between border-b border-white/5 pb-4 mb-4">
            <h3 className="font-display text-xs font-bold tracking-wider text-white uppercase">
              Configure Heuristic Thresholds
            </h3>
            {isSaved && (
              <div className="flex items-center gap-1.5 text-cyber-emerald text-[10px] uppercase font-display tracking-widest font-bold">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Parameters updated
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-display uppercase tracking-widest text-gray-400 mb-1.5 font-semibold">
                Persona Name
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                required
                className="w-full bg-black/60 border border-white/5 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-cyber-cyan font-mono"
              />
            </div>
            <div>
              <label className="block text-[10px] font-display uppercase tracking-widest text-gray-400 mb-1.5 font-semibold">
                Persona Role
              </label>
              <input
                type="text"
                value={formData.role}
                onChange={e => setFormData({ ...formData, role: e.target.value })}
                required
                className="w-full bg-black/60 border border-white/5 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-cyber-cyan font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-display uppercase tracking-widest text-gray-400 mb-1.5 font-semibold">
              Scan Domains
            </label>
            <input
              type="text"
              value={formData.domain}
              onChange={e => setFormData({ ...formData, domain: e.target.value })}
              required
              className="w-full bg-black/60 border border-white/5 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-cyber-cyan font-mono"
            />
          </div>

          <div>
            <label className="block text-[10px] font-display uppercase tracking-widest text-gray-400 mb-1.5 font-semibold">
              Editorial Mission
            </label>
            <textarea
              rows={3}
              value={formData.mission}
              onChange={e => setFormData({ ...formData, mission: e.target.value })}
              required
              className="w-full bg-black/60 border border-white/5 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-cyber-cyan font-sans leading-relaxed resize-none"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-display uppercase tracking-widest text-gray-400 mb-1.5 font-semibold">
                Frequency Interval (Minutes)
              </label>
              <select
                value={formData.frequency}
                onChange={e => setFormData({ ...formData, frequency: e.target.value })}
                className="w-full bg-black/60 border border-white/5 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-cyber-cyan font-mono cursor-pointer"
              >
                <option value="5">Every 5 Minutes</option>
                <option value="10">Every 10 Minutes</option>
                <option value="30">Every 30 Minutes</option>
                <option value="60">Every 60 Minutes</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-display uppercase tracking-widest text-gray-400 mb-1.5 font-semibold">
                Tone Guidelines
              </label>
              <input
                type="text"
                value={formData.style}
                onChange={e => setFormData({ ...formData, style: e.target.value })}
                required
                className="w-full bg-black/60 border border-white/5 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-cyber-cyan font-mono"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
            <GlowButton type="button" variant="ghost" onClick={resetAgent}>
              Deactivate Agent
            </GlowButton>
            <GlowButton type="submit" variant="cyan">
              Commit Settings
            </GlowButton>
          </div>
        </form>
      </GlassCard>
    </div>
  );
};
