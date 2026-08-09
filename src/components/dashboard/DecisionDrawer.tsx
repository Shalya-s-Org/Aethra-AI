"use client";

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Cpu, ShieldAlert, FileText, Award, ExternalLink, Link2, Sparkles, Ban, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '../../utils/cn';
import { fmtTime } from './format';

export interface DecisionDrawerItem {
  kind: 'candidate' | 'post';
  title: string;
  // Candidate / decision fields (persisted)
  sourceName?: string | null;
  sourceType?: string | null;
  canonicalUrl?: string;
  summary?: string | null;
  publishedAt?: string;
  decision?: 'accepted' | 'held' | 'rejected' | null;
  totalScore?: number | null;
  explanation?: string | null;
  generationStatus?: 'none' | 'generated' | 'failed';
  generationFailure?: string | null;
  componentScores?: Array<{ label: string; value: number }> | null;
  quality?: {
    verdict: 'pass' | 'hold' | 'reject';
    score: number;
    checks: Array<{ id: string; label: string; passed: boolean; required: boolean; detail: string }>;
  } | null;
  // Post fields
  body?: string;
  opinion?: string;
  rationale?: string;
  confidence?: number | null;
  citedUrls?: string[];
  relatedPosts?: string[];
  links?: Array<{ relatedPostId: string; relatedTitle: string; relationType: string; similarity: number | null; reason: string | null }>;
  sources?: string[];
  createdAt?: string;
  isDemo?: boolean;
}

interface DecisionDrawerProps {
  open: boolean;
  onClose: () => void;
  item: DecisionDrawerItem | null;
}

const decisionBadge = (d: DecisionDrawerItem['decision']) => {
  switch (d) {
    case 'accepted': return { label: 'ACCEPTED', cls: 'bg-cyber-emerald/15 text-cyber-emerald border-cyber-emerald/30' };
    case 'held': return { label: 'HELD', cls: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30' };
    case 'rejected': return { label: 'REJECTED', cls: 'bg-cyber-red/15 text-cyber-red border-cyber-red/30' };
    default: return { label: 'PENDING', cls: 'bg-gray-500/15 text-gray-400 border-gray-500/30' };
  }
};

export const DecisionDrawer: React.FC<DecisionDrawerProps> = ({ open, onClose, item }) => {
  return (
    <AnimatePresence>
      {open && item && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm">
          <div className="absolute inset-0" onClick={onClose} />
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "tween", duration: 0.3 }}
            className="w-full max-w-md bg-[#0b0f19] border-l border-white/10 h-full p-6 relative overflow-y-auto z-10"
          >
            <div className="flex justify-between items-start border-b border-white/10 pb-4 mb-4">
              <div>
                <h3 className="font-display text-sm font-bold text-cyber-cyan uppercase tracking-wider">
                  {item.kind === 'candidate' ? 'Candidate Audit Log' : 'Publication Record'}
                </h3>
                <p className="text-[8px] text-gray-500 font-mono uppercase tracking-widest mt-0.5">
                  Persisted data — nothing synthesized
                </p>
              </div>
              <button
                onClick={onClose}
                className="p-1 rounded bg-white/5 text-gray-400 hover:text-white transition-colors cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Simulation label for demo/seed content */}
            {item.isDemo && (
              <div className="mb-4 flex items-center gap-1.5 p-2 rounded border border-yellow-500/25 bg-yellow-500/5 text-yellow-400 text-[9px] font-mono uppercase tracking-widest">
                <Sparkles className="w-3 h-3 flex-shrink-0" />
                Simulation preview — demo/seed content, not a pipeline publication
              </div>
            )}

            <div className="space-y-4">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  {item.decision && (
                    <span className={cn("px-1.5 py-0.5 rounded text-[8px] font-display uppercase tracking-widest font-bold border", decisionBadge(item.decision).cls)}>
                      {decisionBadge(item.decision).label}
                    </span>
                  )}
                  {item.generationStatus && item.generationStatus !== 'none' && (
                    <span className={cn(
                      "px-1.5 py-0.5 rounded text-[8px] font-mono uppercase tracking-widest border",
                      item.generationStatus === 'generated' ? "bg-cyber-cyan/10 text-cyber-cyan border-cyber-cyan/25" : "bg-cyber-red/10 text-cyber-red border-cyber-red/25"
                    )}>
                      GEN {item.generationStatus.toUpperCase()}
                    </span>
                  )}
                </div>
                <h2 className="font-display text-sm font-bold text-white uppercase tracking-wide leading-relaxed mt-2">
                  {item.title}
                </h2>
                <div className="font-mono text-[9px] text-gray-500 mt-1 space-y-0.5">
                  {item.sourceName && (
                    <div>Source: <span className="text-cyber-cyan">{item.sourceName}</span>{item.sourceType ? ` (${item.sourceType})` : ''}</div>
                  )}
                  {item.createdAt && <div>Published: {fmtTime(item.createdAt)}</div>}
                  {item.publishedAt && <div>Published (source): {fmtTime(item.publishedAt)}</div>}
                </div>
              </div>

              {/* Score breakdown */}
              {item.totalScore != null && (
                <div className="border-t border-white/10 pt-3">
                  <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest mb-2 font-bold flex items-center gap-1">
                    <Cpu className="w-3.5 h-3.5 text-cyber-cyan" />
                    Editorial Score Breakdown · {item.totalScore}/100
                  </div>
                  <div className="space-y-1.5">
                    {(item.componentScores ?? []).map(score => (
                      <div key={score.label} className="flex items-center gap-2 font-mono text-[9px]">
                        <span className="text-gray-400 w-36 uppercase tracking-wider text-[8px]">{score.label}</span>
                        <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                          <div
                            className={cn("h-full rounded-full", score.value >= 15 ? "bg-cyber-cyan" : score.value >= 8 ? "bg-yellow-400" : "bg-cyber-red")}
                            style={{ width: `${score.value}%` }}
                          />
                        </div>
                        <span className="text-white w-8 text-right">{score.value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Editorial explanation */}
              {item.explanation && (
                <div className="border-t border-white/10 pt-3">
                  <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest mb-1 font-bold flex items-center gap-1">
                    <ShieldAlert className="w-3.5 h-3.5 text-cyber-cyan" />
                    Editorial Explanation
                  </div>
                  <p className="text-[10px] text-gray-200 leading-relaxed pl-3 border-l border-white/10">{item.explanation}</p>
                </div>
              )}

              {/* Quality gate checks */}
              {item.quality && item.quality.checks.length > 0 && (
                <div className="border-t border-white/10 pt-3">
                  <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest mb-2 font-bold flex items-center gap-1">
                    <Ban className="w-3.5 h-3.5 text-cyber-cyan" />
                    Pre-Publication Quality Gate · {Math.round(item.quality.score * 100)}% passed
                  </div>
                  <div className="space-y-1.5">
                    {item.quality.checks.map(check => (
                      <div key={check.id} className={cn("flex items-start gap-2 p-2 rounded border", check.passed ? "bg-cyber-emerald/5 border-cyber-emerald/15" : "bg-cyber-red/5 border-cyber-red/20")}>
                        {check.passed
                          ? <CheckCircle2 className="w-3 h-3 text-cyber-emerald mt-0.5 flex-shrink-0" />
                          : <XCircle className="w-3 h-3 text-cyber-red mt-0.5 flex-shrink-0" />}
                        <div className="min-w-0">
                          <span className={cn("font-display uppercase tracking-wider text-[8px] font-semibold block", check.passed ? "text-cyber-emerald" : "text-cyber-red")}>
                            {check.label}
                          </span>
                          <span className="text-[9px] text-gray-400 block mt-0.5">{check.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Generation failure */}
              {item.generationFailure && (
                <div className="p-2.5 rounded bg-cyber-red/5 border border-cyber-red/20 text-[9px] text-cyber-red font-mono leading-relaxed">
                  Generation failure: {item.generationFailure}
                </div>
              )}

              {/* Post content */}
              {item.body && (
                <div className="border-t border-white/10 pt-3">
                  <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest mb-1 font-bold flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5 text-cyber-cyan" />
                    Technical Summary
                  </div>
                  <p className="text-[10px] text-gray-300 leading-relaxed pl-3 border-l border-white/10 whitespace-pre-line">{item.body}</p>
                </div>
              )}

              {item.opinion && (
                <div className="border-t border-white/10 pt-3">
                  <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest mb-1 font-bold flex items-center gap-1">
                    <Award className="w-3.5 h-3.5 text-cyber-purple" />
                    Editorial Opinion
                  </div>
                  <p className="text-[10px] text-gray-300 leading-relaxed pl-3 border-l border-white/10 italic">{item.opinion}</p>
                </div>
              )}

              {item.rationale && (
                <div className="border-t border-white/10 pt-3">
                  <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest mb-1 font-bold flex items-center gap-1">
                    <Cpu className="w-3.5 h-3.5 text-cyber-cyan" />
                    Why Selected &amp; Rationale
                  </div>
                  <p className="text-[10px] text-gray-300 leading-relaxed pl-3 border-l border-white/10">{item.rationale}</p>
                </div>
              )}

              {/* Cited sources */}
              {item.citedUrls && item.citedUrls.length > 0 && (
                <div className="border-t border-white/10 pt-3">
                  <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest mb-1.5 font-bold">Cited Sources (schema-validated)</div>
                  <div className="space-y-1">
                    {item.citedUrls.map((url, i) => (
                      <a key={`u-${i}-${url}`} href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 p-1.5 rounded bg-black/40 border border-white/5 hover:border-cyber-cyan/30 text-[9px] text-cyber-cyan font-mono truncate transition-colors">
                        <ExternalLink className="w-3 h-3 flex-shrink-0" />
                        <span className="truncate">{url}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Related posts (durable post_links) */}
              {item.links && item.links.length > 0 && (
                <div className="border-t border-white/10 pt-3">
                  <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest mb-1.5 font-bold flex items-center gap-1">
                    <Link2 className="w-3.5 h-3.5 text-cyber-purple" />
                    Related Prior Posts
                  </div>
                  <div className="space-y-1.5">
                    {item.links.map(link => (
                      <div key={link.relatedPostId} className="p-2 rounded bg-black/40 border border-white/5">
                        <div className="text-[9.5px] text-white font-medium">{link.relatedTitle}</div>
                        <div className="flex items-center gap-2 mt-1 font-mono text-[8px] text-gray-500">
                          <span className={cn(
                            "px-1 py-0.5 rounded uppercase tracking-widest border",
                            link.relationType === 'follow_up' ? "bg-cyber-cyan/10 text-cyber-cyan border-cyber-cyan/25" : "bg-cyber-purple/10 text-cyber-purple border-cyber-purple/25"
                          )}>{link.relationType}</span>
                          {link.similarity != null && <span>sim {link.similarity}</span>}
                        </div>
                        {link.reason && <div className="text-[8.5px] text-gray-400 mt-1 leading-normal">{link.reason}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Related-post references from generated output */}
              {item.relatedPosts && item.relatedPosts.length > 0 && (
                <div className="border-t border-white/10 pt-3">
                  <div className="text-[8px] font-mono text-gray-500 uppercase tracking-widest mb-1.5 font-bold">Referenced Story Follow-ups</div>
                  <div className="flex flex-wrap gap-1.5">
                    {item.relatedPosts.map((ref, i) => (
                      <span key={`r-${i}-${ref}`} className="px-1.5 py-0.5 rounded bg-white/5 text-gray-400 text-[8px] font-mono">{ref}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Confidence */}
              {item.confidence != null && (
                <div className="border-t border-white/10 pt-3 flex justify-between items-center font-mono text-[9px] text-gray-400">
                  <span className="uppercase tracking-widest text-[8px]">Model Confidence</span>
                  <span className="text-cyber-cyan font-bold">{item.confidence}%</span>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
