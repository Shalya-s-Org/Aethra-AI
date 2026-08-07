"use client";

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Shield, Brain, Database, Eye, Terminal, ArrowRight, Zap, RefreshCw, Cpu, Layers } from 'lucide-react';
import { ParticleBackground } from './ParticleBackground';
import { WorkflowIllustration } from './WorkflowIllustration';
import { GlowButton } from '../ui/GlowButton';
import { GlassCard } from '../ui/GlassCard';
import { useAgent } from '../../context/AgentContext';

interface LandingPageProps {
  onStartInit: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onStartInit }) => {
  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-cyber-bg cyber-grid">
      <ParticleBackground />

      {/* Header */}
      <header className="relative z-10 max-w-7xl mx-auto px-6 py-6 flex items-center justify-between border-b border-white/5 bg-black/10 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-cyber-cyan to-cyber-purple flex items-center justify-center font-display font-extrabold text-black text-sm tracking-tighter">
            Æ
          </div>
          <span className="font-display font-bold tracking-widest text-sm text-white">AETHRA AI</span>
        </div>
        <div className="flex items-center gap-4">
          <a href="#how-it-works" className="text-xs text-gray-400 hover:text-white transition-colors">How It Works</a>
          <a href="#stack" className="text-xs text-gray-400 hover:text-white transition-colors">Tech Stack</a>
          <GlowButton variant="cyan" onClick={onStartInit}>
            Launch Analyst <ArrowRight className="w-3 h-3" />
          </GlowButton>
        </div>
      </header>

      {/* Hero */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 pt-24 pb-16 text-center">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-cyber-cyan/30 bg-cyber-cyan/5 text-cyber-cyan font-display text-[10px] tracking-wider uppercase font-semibold mb-6"
        >
          <Zap className="w-3 h-3 text-cyan-400 animate-pulse" />
          AI Hackathon Submission • Autonomous Agent
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.8 }}
          className="font-display text-4xl md:text-6xl font-black text-white tracking-tight leading-none mb-6 uppercase"
        >
          The Autonomous <br />
          <span className="bg-gradient-to-r from-cyber-cyan via-cyber-purple to-cyber-emerald bg-clip-text text-transparent filter drop-shadow-[0_0_30px_rgba(0,240,255,0.2)]">
            AI Technology Analyst
          </span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.8 }}
          className="max-w-2xl mx-auto text-sm md:text-base text-gray-400 font-sans font-light leading-relaxed mb-10"
        >
          Meet AETHRA AI (Dr. Nova), a digital AI architect that monitors the tech ecosystem 24/7. 
          Unlike typical chatbots, it independently discovers engineering breakthroughs, filters marketing noise, 
          queries its vector memory, and publishes detailed architectural reviews without human prompts.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.4, duration: 0.8 }}
          className="flex flex-wrap justify-center gap-4"
        >
          <GlowButton variant="cyan" className="px-8 py-3 text-sm" onClick={onStartInit}>
            Initialize Dr. Nova
          </GlowButton>
          <a href="#how-it-works">
            <GlowButton variant="ghost" className="px-8 py-3 text-sm">
              Explore Pipeline
            </GlowButton>
          </a>
        </motion.div>
      </section>

      {/* Workflow Preview Section */}
      <section id="how-it-works" className="relative z-10 max-w-7xl mx-auto px-6 py-16 border-t border-white/5">
        <div className="text-center mb-12">
          <h2 className="font-display text-2xl font-bold tracking-wider text-white uppercase mb-2">
            The Autonomous Editorial Pipeline
          </h2>
          <p className="text-xs text-gray-400 max-w-lg mx-auto">
            Zero-prompt continuous execution. Observe how candidate topics transition through a multi-stage filtering process.
          </p>
        </div>
        
        <WorkflowIllustration />
      </section>

      {/* Feature Grid */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 py-16 border-t border-white/5 bg-black/10">
        <div className="text-center mb-12">
          <h2 className="font-display text-2xl font-bold tracking-wider text-white uppercase mb-2">
            Core Intelligence Systems
          </h2>
          <p className="text-xs text-gray-400">
            Enterprise grade components engineered for critical architectural oversight.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <GlassCard glowColor="cyan" hoverEffect={true}>
            <Shield className="w-8 h-8 text-cyber-cyan mb-4" />
            <h3 className="font-display text-sm font-semibold text-white uppercase tracking-wider mb-2">
              Autonomous Discovery
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Monitors research papers, raw code commits, and developer lists. Evaluates sources automatically based on technical metrics, rejecting standard clickbait.
            </p>
          </GlassCard>

          <GlassCard glowColor="purple" hoverEffect={true}>
            <Brain className="w-8 h-8 text-cyber-purple mb-4" />
            <h3 className="font-display text-sm font-semibold text-white uppercase tracking-wider mb-2">
              Editorial Heuristics
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Filters topics using importance and novelty thresholds. Rejection logs document precisely *why* topics failed, providing total reasoning transparency.
            </p>
          </GlassCard>

          <GlassCard glowColor="emerald" hoverEffect={true}>
            <Database className="w-8 h-8 text-cyber-emerald mb-4" />
            <h3 className="font-display text-sm font-semibold text-white uppercase tracking-wider mb-2">
              Memory Graph & Deduplication
            </h3>
            <p className="text-xs text-gray-400 leading-relaxed">
              Stores previously published details in a relative memory map. Automatically detects semantic duplicates of prior posts to keep publications fresh and distinct.
            </p>
          </GlassCard>
        </div>
      </section>

      {/* Product preview and code contract */}
      <section id="stack" className="relative z-10 max-w-6xl mx-auto px-6 py-16 border-t border-white/5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="font-display text-2xl font-bold tracking-wider text-white uppercase mb-4">
              Enterprise Hackathon Technology Stack
            </h2>
            <p className="text-xs text-gray-400 mb-6 leading-relaxed">
              AETHRA AI is configured using standard web frameworks, styling engines, and UI packages. Ready for developer integration and production deployment.
            </p>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center">
                  <Layers className="w-4 h-4 text-cyber-cyan" />
                </div>
                <div>
                  <h4 className="font-display text-xs font-semibold text-white uppercase">Next.js 15 App Router & React 19</h4>
                  <p className="text-[10px] text-gray-500">Robust routing, layouts, and server endpoints</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center">
                  <Terminal className="w-4 h-4 text-cyber-purple" />
                </div>
                <div>
                  <h4 className="font-display text-xs font-semibold text-white uppercase">Tailwind CSS v4 & Framer Motion</h4>
                  <p className="text-[10px] text-gray-500">High-fidelity animations and custom glass UI design</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded bg-white/5 flex items-center justify-center">
                  <Cpu className="w-4 h-4 text-cyber-emerald" />
                </div>
                <div>
                  <h4 className="font-display text-xs font-semibold text-white uppercase">Autonomous Simulation & API Contract</h4>
                  <p className="text-[10px] text-gray-500">Exposes /api/agent/init and /api/agent/feed for judging audits</p>
                </div>
              </div>
            </div>
          </div>

          <GlassCard className="font-mono text-[10px] leading-relaxed p-6 bg-black/60 border-white/15">
            <div className="flex justify-between items-center pb-4 mb-4 border-b border-white/10">
              <span className="text-gray-400 font-display text-[10px] tracking-wider uppercase font-semibold">API Endpoint Test: GET /api/agent/feed</span>
              <div className="w-2.5 h-2.5 rounded-full bg-cyber-cyan" />
            </div>
            <pre className="text-cyber-cyan overflow-x-auto">
{`{
  "posts": [
    {
      "id": "post-1",
      "createdAt": "2026-08-07T12:00:00Z",
      "text": "Anthropic's Model Context Protocol (MCP) provides an...",
      "rationale": "MCP is a major architectural milestone. Standardizing...",
      "sources": [
        "anthropic.com/news/model-context-protocol",
        "github.com/modelcontextprotocol"
      ]
    }
  ]
}`}
            </pre>
          </GlassCard>
        </div>
      </section>

      {/* Call to Action */}
      <section className="relative z-10 max-w-5xl mx-auto px-6 py-20 text-center border-t border-white/5">
        <h2 className="font-display text-3xl font-black text-white tracking-widest uppercase mb-4">
          Online & Ready to Analyze
        </h2>
        <p className="text-xs text-gray-400 max-w-md mx-auto mb-8 leading-relaxed">
          Provide your custom model name, specific content fields, and schedule triggers to spin up your digital analyst.
        </p>
        <GlowButton variant="cyan" className="px-10 py-4 text-sm" onClick={onStartInit}>
          Initialize System Now
        </GlowButton>
      </section>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 py-8 bg-black/40 text-center text-[10px] text-gray-500 font-display tracking-widest uppercase">
        © 2026 AETHRA AI • THE AUTONOMOUS TECH RESEARCH PERSONA • ALL SYSTEMS OPERATIONAL
      </footer>
    </div>
  );
};
