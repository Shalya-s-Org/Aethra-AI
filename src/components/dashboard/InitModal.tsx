"use client";

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAgent, AgentConfig } from '../../context/AgentContext';
import { GlowButton } from '../ui/GlowButton';
import { GlassCard } from '../ui/GlassCard';
import { Cpu, Terminal, Shield, CheckCircle, Loader } from 'lucide-react';

interface InitModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const InitModal: React.FC<InitModalProps> = ({ isOpen, onClose }) => {
  const { initializeAgent } = useAgent();
  const [formData, setFormData] = useState<AgentConfig>({
    name: "Dr. Nova",
    role: "AI Systems Architect & Technology Analyst",
    domain: "AI Engineering, Infrastructure, Security, Open Source, Agentic Systems",
    mission: "Publish only developments that materially impact AI engineering, production systems, security, infrastructure, open source, agentic AI, RAG, MCP, LLMs and AI deployment.",
    frequency: "30",
    style: "Professional, Analytical, Evidence-based, Opinionated, Concise, Calm, Highly Technical"
  });

  const [isActivating, setIsActivating] = useState(false);
  const [activationStep, setActivationStep] = useState(0);
  const [initError, setInitError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInitError(null);
    setIsActivating(true);

    // Trigger backend initialization concurrently with visual boot steps
    const initPromise = initializeAgent(formData);

    const steps = [
      "Compiling heuristic model weights...",
      "Injecting tone guidelines and editorial criteria...",
      "Testing connection to research indexes...",
      "Activating autonomous sensors..."
    ];

    for (let i = 0; i < steps.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 400));
      setActivationStep(i + 1);
    }

    const result = await initPromise;
    if (!result.ok) {
      setInitError(result.error);
      setActivationStep(0);
      setIsActivating(false);
      return;
    }
    setActivationStep(0);
    setIsActivating(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 20 }}
          className="w-full max-w-xl"
        >
          <GlassCard className="relative overflow-hidden border-cyber-cyan/30 cyan-glow p-8" glowColor="cyan">
            {/* Hologram details */}
            <div className="absolute top-0 right-0 p-4 font-mono text-[8px] text-cyber-cyan/30 pointer-events-none select-none">
              SYS.INIT.V1.2
            </div>

            {!isActivating ? (
              <form onSubmit={handleSubmit} className="space-y-5">
                {initError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 border border-red-500/40 bg-red-500/10 rounded px-3 py-2.5 text-[11px] text-red-400 font-mono"
                  >
                    <span className="mt-0.5">⚠</span>
                    <span>Initialization failed: {initError}</span>
                  </div>
                )}
                <div className="flex items-center gap-3 border-b border-white/5 pb-4">
                  <div className="w-10 h-10 rounded-lg bg-cyber-cyan/10 flex items-center justify-center border border-cyber-cyan/30">
                    <Cpu className="w-5 h-5 text-cyber-cyan animate-pulse" />
                  </div>
                  <div>
                    <h3 className="font-display text-sm font-bold tracking-wider text-white uppercase">
                      Initialize Technology Analyst
                    </h3>
                    <p className="text-[10px] text-cyber-cyan/60 uppercase tracking-widest font-mono">
                      Configure autonomous reasoning guidelines
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-display uppercase tracking-widest text-gray-400 mb-1.5 font-semibold">
                      Analyst Persona Name
                    </label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={e => setFormData({ ...formData, name: e.target.value })}
                      required
                      className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-cyber-cyan transition-colors font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-display uppercase tracking-widest text-gray-400 mb-1.5 font-semibold">
                      Role / Subtitle
                    </label>
                    <input
                      type="text"
                      value={formData.role}
                      onChange={e => setFormData({ ...formData, role: e.target.value })}
                      required
                      className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-cyber-cyan transition-colors font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-display uppercase tracking-widest text-gray-400 mb-1.5 font-semibold">
                    Specific Domains
                  </label>
                  <input
                    type="text"
                    value={formData.domain}
                    onChange={e => setFormData({ ...formData, domain: e.target.value })}
                    required
                    className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-cyber-cyan transition-colors font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-display uppercase tracking-widest text-gray-400 mb-1.5 font-semibold">
                    Editorial Mission Heuristics
                  </label>
                  <textarea
                    rows={3}
                    value={formData.mission}
                    onChange={e => setFormData({ ...formData, mission: e.target.value })}
                    required
                    className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-cyber-cyan transition-colors font-sans leading-relaxed resize-none"
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-display uppercase tracking-widest text-gray-400 mb-1.5 font-semibold">
                      Audit Interval (Minutes)
                    </label>
                    <select
                      value={formData.frequency}
                      onChange={e => setFormData({ ...formData, frequency: e.target.value })}
                      className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-cyber-cyan transition-colors font-mono cursor-pointer"
                    >
                      <option value="5">Every 5 Minutes</option>
                      <option value="10">Every 10 Minutes</option>
                      <option value="30">Every 30 Minutes</option>
                      <option value="60">Every 60 Minutes</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-display uppercase tracking-widest text-gray-400 mb-1.5 font-semibold">
                      Tone / Writing Persona
                    </label>
                    <input
                      type="text"
                      value={formData.style}
                      onChange={e => setFormData({ ...formData, style: e.target.value })}
                      required
                      className="w-full bg-black/60 border border-white/10 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-cyber-cyan transition-colors font-mono"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
                  <GlowButton type="button" variant="ghost" onClick={onClose}>
                    Abort
                  </GlowButton>
                  <GlowButton type="submit" variant="cyan">
                    Initialize Analyst
                  </GlowButton>
                </div>
              </form>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Loader className="w-12 h-12 text-cyber-cyan animate-spin mb-6" />
                <h4 className="font-display text-sm font-bold tracking-wider text-white uppercase mb-2">
                  System Boot Sequence
                </h4>
                <div className="w-48 h-1 bg-white/5 rounded-full overflow-hidden mb-4">
                  <motion.div
                    className="h-full bg-cyber-cyan"
                    initial={{ width: 0 }}
                    animate={{ width: `${(activationStep / 4) * 100}%` }}
                    transition={{ duration: 0.5 }}
                  />
                </div>
                <p className="font-mono text-[10px] text-cyber-cyan tracking-wider uppercase animate-pulse">
                  {activationStep === 0 && "Compiling model nodes..."}
                  {activationStep === 1 && "Synthesizing editorial standards..."}
                  {activationStep === 2 && "Routing neural gateways..."}
                  {activationStep === 3 && "Waking agent sub-modules..."}
                  {activationStep === 4 && "Active."}
                </p>
              </div>
            )}
          </GlassCard>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
