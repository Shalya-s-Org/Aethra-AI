"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { Search, Filter, Cpu, Database, Award, ArrowRight, BookOpen, Lightbulb } from 'lucide-react';

interface Stage {
  title: string;
  desc: string;
  icon: React.ReactNode;
  color: string;
}

const stages: Stage[] = [
  {
    title: "1. Scan Sources",
    desc: "Dr. Nova monitors GitHub, research repositories, security advisories, and developer blogs 24/7.",
    icon: <Search className="w-5 h-5 text-blue-400" />,
    color: "from-blue-500/20 to-blue-500/5 border-blue-500/30"
  },
  {
    title: "2. Noise Filter",
    desc: "Rejects consumer clickbait, marketing hype, copycat announcements, and low-impact releases.",
    icon: <Filter className="w-5 h-5 text-yellow-400" />,
    color: "from-yellow-500/20 to-yellow-500/5 border-yellow-500/30"
  },
  {
    title: "3. Reasoning Engine",
    desc: "Scores credibility, architectural importance, and novelty using customized heuristics.",
    icon: <Cpu className="w-5 h-5 text-purple-400" />,
    color: "from-purple-500/20 to-purple-500/5 border-purple-500/30"
  },
  {
    title: "4. Memory Audit",
    desc: "Queries the vector knowledge base to detect duplicate ideas and cross-reference histories.",
    icon: <Database className="w-5 h-5 text-cyan-400" />,
    color: "from-cyan-500/20 to-cyan-500/5 border-cyan-500/30"
  },
  {
    title: "5. Production Writing",
    desc: "Synthesizes detailed technical architecture reports and highly opinionated commentary.",
    icon: <BookOpen className="w-5 h-5 text-indigo-400" />,
    color: "from-indigo-500/20 to-indigo-500/5 border-indigo-500/30"
  },
  {
    title: "6. Publication",
    desc: "Broadcasts the finished report, including sources, rationale, and publication signatures.",
    icon: <Award className="w-5 h-5 text-emerald-400" />,
    color: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/30"
  },
  {
    title: "7. Graph Synthesis",
    desc: "Integrates takeaways back into the memory map, updating predictions and opinions.",
    icon: <Lightbulb className="w-5 h-5 text-pink-400" />,
    color: "from-pink-500/20 to-pink-500/5 border-pink-500/30"
  }
];

export const WorkflowIllustration: React.FC = () => {
  return (
    <div className="relative w-full max-w-5xl mx-auto py-12">
      {/* Dynamic connecting line */}
      <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500 -translate-y-1/2 opacity-20 hidden md:block" />
      
      <div className="grid grid-cols-1 md:grid-cols-7 gap-4 relative z-10">
        {stages.map((stage, index) => (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: index * 0.1, duration: 0.5 }}
            className={`flex flex-col items-center md:items-start p-4 rounded-xl border bg-gradient-to-b ${stage.color} backdrop-blur-sm relative group hover:border-cyan-500/50 transition-all duration-300`}
          >
            <div className="w-10 h-10 rounded-lg bg-black/40 flex items-center justify-center border border-white/10 mb-4 group-hover:scale-110 transition-transform duration-300">
              {stage.icon}
            </div>
            
            <h4 className="font-display text-xs font-semibold text-white tracking-wider mb-2 uppercase text-center md:text-left">
              {stage.title}
            </h4>
            
            <p className="text-[11px] text-gray-400 leading-relaxed text-center md:text-left">
              {stage.desc}
            </p>
            
            {index < stages.length - 1 && (
              <div className="absolute top-1/2 -right-3 -translate-y-1/2 text-white/20 hidden md:block group-hover:text-cyan-500/50 transition-colors duration-300">
                <ArrowRight className="w-4 h-4" />
              </div>
            )}
          </motion.div>
        ))}
      </div>
    </div>
  );
};
