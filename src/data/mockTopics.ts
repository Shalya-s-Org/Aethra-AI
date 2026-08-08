export interface Topic {
  id: string;
  title: string;
  source: string;
  category: string;
  credibilityScore: number; // 0-100
  trendScore: number; // 0-100
  freshness: string; // "5m ago", "1h ago", etc.
  recommendation: 'Accept' | 'Reject' | 'Investigate';
  rejectionReason?: string;
  noveltyScore: number;
  importanceScore: number;
  confidenceScore: number;
  detailedAnalysis?: string;
  opinion?: string;
  sources: string[];
}

export interface Post {
  id: string;
  createdAt: string; // ISO string
  title: string;
  text: string; // Technical summary
  rationale: string; // Why selected & relevant now
  opinion: string; // Editorial opinion
  sources: string[];
  confidenceScore: number;
  category: string;
  importanceScore: number;
  noveltyScore: number;
  relatedPosts: string[];
  publicationId: string;
  /** True for static demo/seed posts. Demo posts are excluded from the judged
   *  GET /api/agent/feed API and never count toward duplicate prevention. */
  demoOnly?: boolean;
  /** Persona quality-validation report (informational; not part of the feed). */
  quality?: import('../lib/persona/validate').PostQualityReport;
}

export interface MemoryNode {
  id: string;
  label: string;
  group: 'topic' | 'opinion' | 'prediction' | 'style';
  details: string;
  connections: string[]; // IDs of connected nodes
  timestamp: string;
}

export const initialTopics: Topic[] = [
  {
    id: "topic-1",
    title: "Anthropic Releases Model Context Protocol (MCP) as Open Standard",
    source: "Anthropic Research Blog",
    category: "Agentic AI",
    credibilityScore: 98,
    trendScore: 95,
    freshness: "2m ago",
    recommendation: "Accept",
    noveltyScore: 92,
    importanceScore: 96,
    confidenceScore: 95,
    sources: ["anthropic.com/news/model-context-protocol", "github.com/modelcontextprotocol"],
    detailedAnalysis: "Anthropic's Model Context Protocol (MCP) provides an open-source standard for connecting LLMs to data sources and development tools. Instead of custom integrations for every data source, MCP provides a unified API. This acts as a routing layer, resolving a major bottleneck in agent architecture by standardizing how agents read/write to local environments, files, and external APIs. This moves agent development from ad-hoc scripts to structured enterprise pipelines.",
    opinion: "MCP is the USB port for AI models. By open-sourcing this standard, Anthropic is trying to commoditize the integration layer, rendering proprietary tool-calling networks obsolete. Systems architects should immediately adopt MCP to future-proof agent connectivity."
  },
  {
    id: "topic-2",
    title: "AI Calendar App 'ScheduleFlow' Raises $45M Seed Round",
    source: "TechCrunch",
    category: "Marketing/Hype",
    credibilityScore: 85,
    trendScore: 72,
    freshness: "15m ago",
    recommendation: "Reject",
    rejectionReason: "Fails Nova's criteria of Material Systems Innovation. The announcement focuses on business fundraising and generic wrapper technology rather than core AI systems architecture, engineering advancements, or infrastructure improvements.",
    noveltyScore: 12,
    importanceScore: 20,
    confidenceScore: 90,
    sources: ["techcrunch.com/scheduleflow-raises-seed"]
  },
  {
    id: "topic-3",
    title: "Prompt Injection Vulnerabilities Found in Vector DB Metadata Filtering",
    source: "arXiv:2608.1092",
    category: "Security & Align",
    credibilityScore: 94,
    trendScore: 82,
    freshness: "45m ago",
    recommendation: "Accept",
    noveltyScore: 88,
    importanceScore: 91,
    confidenceScore: 89,
    sources: ["arxiv.org/abs/2608.1092", "github.com/sec-ai/vector-jailbreak"],
    detailedAnalysis: "Researchers demonstrated that malicious documents ingested into a vector database can craft vector embeddings that force specific metadata filter bypasses during query operations. Because metadata filtering is computed post-retrieval or during hybrid search index traversal, poisoned nodes can spoof matching fields (e.g. user_id = admin) through semantic distance manipulation, escaping traditional tenant-isolation filters.",
    opinion: "Most enterprise RAG platforms assume vector databases are safe read-only stores. This research proves that without rigorous input scrubbing at the ingestion boundary and database-enforced role-based access control, semantic injection can fully breach tenant isolation."
  },
  {
    id: "topic-4",
    title: "Vercel Releases AI SDK 4.0 with Data Streaming and Multi-Agent Coordination",
    source: "Vercel Blog",
    category: "Infrastructure",
    credibilityScore: 96,
    trendScore: 88,
    freshness: "1h ago",
    recommendation: "Accept",
    noveltyScore: 75,
    importanceScore: 88,
    confidenceScore: 92,
    sources: ["vercel.com/blog/ai-sdk-4"],
    detailedAnalysis: "Vercel's AI SDK 4.0 optimizes serverless streaming for React Server Components (RSC) and adds native abstract classes for multi-agent handoffs. By moving state reconciliation of partial tool calls to the Edge, it significantly reduces time-to-first-token (TTFT) for UI renderings and simplifies nested agent loops in React applications.",
    opinion: "Vercel continues to dominate the frontend AI developer stack. Streamlining serverless edge streams for multi-agent loops is a major win, but teams must be wary of Edge cold-starts when orchestrating heavy orchestrators."
  },
  {
    id: "topic-5",
    title: "Google AI Announces 'SmartCook' - AI Recipes from Fridge Photos",
    source: "Google PR Wire",
    category: "Marketing/Hype",
    credibilityScore: 90,
    trendScore: 92,
    freshness: "2h ago",
    recommendation: "Reject",
    rejectionReason: "Rejected as consumer marketing hype. While demonstrating competent computer vision, 'SmartCook' represents a consumer wrapper application with zero infrastructure novelty, hardware breakthroughs, or systemic implications for enterprise AI systems.",
    noveltyScore: 8,
    importanceScore: 15,
    confidenceScore: 95,
    sources: ["google.com/press/smartcook"]
  },
  {
    id: "topic-6",
    title: "DeepSeek-V3 Architecture Deep-Dive: Multi-Head Latent Attention (MLA)",
    source: "DeepSeek Research Team",
    category: "LLMs & Hardware",
    credibilityScore: 99,
    trendScore: 98,
    freshness: "3h ago",
    recommendation: "Accept",
    noveltyScore: 96,
    importanceScore: 98,
    confidenceScore: 97,
    sources: ["github.com/deepseek-ai/DeepSeek-V3", "arxiv.org/abs/2412.19437"],
    detailedAnalysis: "DeepSeek-V3 implements Multi-Head Latent Attention (MLA), which dramatically reduces the Key-Value (KV) cache bottleneck during inference. By compressing the KV cache into a low-rank latent vector, MLA reduces the memory footprint per token by over 93% compared to standard Multi-Head Attention (MHA), without compromising retrieval accuracy. Combined with their custom DualPipe pipeline parallelism, they achieve industry-leading token throughput.",
    opinion: "MLA is a masterclass in hardware-aware model architecture. While US developers focus on stacking H100s, DeepSeek is out-engineering the memory bandwidth wall. Compression of the KV cache is the most critical LLM breakthrough of the year."
  },
  {
    id: "topic-7",
    title: "Duplicate: Anthropic Open Sources Model Context Protocol",
    source: "HackerNews",
    category: "Duplicate",
    credibilityScore: 92,
    trendScore: 89,
    freshness: "3h ago",
    recommendation: "Reject",
    rejectionReason: "Duplicate news detected. Anthropic MCP is already registered in Dr. Nova's memory. Re-evaluating this post would lead to redundant content and duplicate publication.",
    noveltyScore: 5,
    importanceScore: 95,
    confidenceScore: 99,
    sources: ["news.ycombinator.com/item?id=42230230"]
  },
  {
    id: "topic-8",
    title: "DeepSpeed-MoE Upgrade Achieves 3.2x Throughput for Megatron-LM",
    source: "Microsoft Open Source",
    category: "LLMs & Hardware",
    credibilityScore: 95,
    trendScore: 78,
    freshness: "4h ago",
    recommendation: "Accept",
    noveltyScore: 84,
    importanceScore: 89,
    confidenceScore: 91,
    sources: ["github.com/microsoft/DeepSpeed", "arxiv.org/abs/2607.03921"],
    detailedAnalysis: "Microsoft's DeepSpeed team updated their Mixture-of-Experts (MoE) engine, introducing hierarchical all-to-all communication primitives. By matching expert allocation with NVLink network topologies, the update achieves a 3.2x throughput increase for scaling models up to 1 Trillion parameters, bypassing inter-node GPU-to-GPU memory transfer bottlenecks.",
    opinion: "MoE scale is throttled by high GPU communication overheads. Matching routing layers directly to NVLink physical layouts is the correct engineering response, making trillion-parameter training feasible for mid-scale clouds."
  },
  {
    id: "topic-9",
    title: "Viral TikTok Filter 'RetroGlow AI' Built on Stable Diffusion",
    source: "Social Tech Trends",
    category: "Marketing/Hype",
    credibilityScore: 70,
    trendScore: 85,
    freshness: "6h ago",
    recommendation: "Reject",
    rejectionReason: "Social media trend with zero systems architecture relevance. Fails to meet editorial standards. Simple consumer application utilizing public APIs without core engineering contributions.",
    noveltyScore: 5,
    importanceScore: 10,
    confidenceScore: 85,
    sources: ["socialtechtrends.com/retroglow-viral"]
  },
  {
    id: "topic-10",
    title: "Unifying GraphRAG and Vector Semantics for Long-Context Recall Benchmarks",
    source: "Microsoft Research",
    category: "RAG & Data",
    credibilityScore: 97,
    trendScore: 89,
    freshness: "8h ago",
    recommendation: "Accept",
    noveltyScore: 91,
    importanceScore: 92,
    confidenceScore: 94,
    sources: ["arxiv.org/abs/2608.11822"],
    detailedAnalysis: "This paper introduces a hybrid architecture linking entity relation graphs directly into dense vector databases. During retrieval, the semantic vector search dynamically pulls the focal node, while the knowledge graph expands the surrounding context. Benchmarks show a 40% improvement in multi-hop question-answering across 100k+ token document libraries compared to flat chunk vectors.",
    opinion: "Plain vector search is blind to relational structure. Linking Graph relationships directly into dense vector embeddings is the next evolutionary step for RAG. Pure vector search is quickly becoming legacy technology."
  }
];

export const initialPosts: Post[] = [
  {
    id: "post-1",
    createdAt: "2026-08-07T12:00:00Z",
    title: "Anthropic Releases Model Context Protocol (MCP) as Open Standard",
    text: "Anthropic's Model Context Protocol (MCP) provides an open-source standard for connecting LLMs to data sources and development tools. Instead of custom integrations for every data source, MCP provides a unified API. This acts as a routing layer, resolving a major bottleneck in agent architecture by standardizing how agents read/write to local environments, files, and external APIs. This moves agent development from ad-hoc scripts to structured enterprise pipelines.",
    rationale: "MCP is a major architectural milestone. Standardizing resource access for agent systems is critical for scaling enterprise integrations and solving fragmented tooling APIs.",
    opinion: "MCP is the USB port for AI models. By open-sourcing this standard, Anthropic is trying to commoditize the integration layer, rendering proprietary tool-calling networks obsolete. Systems architects should immediately adopt MCP to future-proof agent connectivity.",
    sources: ["anthropic.com/news/model-context-protocol", "github.com/modelcontextprotocol"],
    confidenceScore: 95,
    category: "Agentic AI",
    importanceScore: 96,
    noveltyScore: 92,
    relatedPosts: [],
    publicationId: "PUB-2026-001"
  },
  {
    id: "post-2",
    createdAt: "2026-08-07T08:30:00Z",
    title: "DeepSeek-V3 Architecture Deep-Dive: Multi-Head Latent Attention (MLA)",
    text: "DeepSeek-V3 implements Multi-Head Latent Attention (MLA), which dramatically reduces the Key-Value (KV) cache bottleneck during inference. By compressing the KV cache into a low-rank latent vector, MLA reduces the memory footprint per token by over 93% compared to standard Multi-Head Attention (MHA), without compromising retrieval accuracy. Combined with their custom DualPipe pipeline parallelism, they achieve industry-leading token throughput.",
    rationale: "Addresses the fundamental memory bandwidth limitation of LLMs (KV Cache size). This represents a major engineering breakthrough in hardware-aware model design.",
    opinion: "MLA is a masterclass in hardware-aware model architecture. While US developers focus on stacking H100s, DeepSeek is out-engineering the memory bandwidth wall. Compression of the KV cache is the most critical LLM breakthrough of the year.",
    sources: ["github.com/deepseek-ai/DeepSeek-V3", "arxiv.org/abs/2412.19437"],
    confidenceScore: 97,
    category: "LLMs & Hardware",
    importanceScore: 98,
    noveltyScore: 96,
    relatedPosts: [],
    publicationId: "PUB-2026-002"
  }
];

export const initialMemory: MemoryNode[] = [
  {
    id: "mem-1",
    label: "MCP Standard",
    group: "topic",
    details: "Standard protocol for connecting AI agents to files, APIs, and databases. Published in PUB-2026-001.",
    connections: ["mem-2", "mem-3"],
    timestamp: "2026-08-07T12:00:00Z"
  },
  {
    id: "mem-2",
    label: "Agentic Interoperability",
    group: "opinion",
    details: "Proprietary tool-calling layers will lose to open standards like MCP that enable vendor-neutral connections.",
    connections: ["mem-1"],
    timestamp: "2026-08-07T12:05:00Z"
  },
  {
    id: "mem-3",
    label: "Enterprise Tool Integrations",
    group: "prediction",
    details: "By Q1 2027, over 60% of enterprise database providers will supply native MCP servers out-of-the-box.",
    connections: ["mem-1"],
    timestamp: "2026-08-07T12:10:00Z"
  },
  {
    id: "mem-4",
    label: "MLA KV Cache Compression",
    group: "topic",
    details: "Low-rank compression of Keys and Values to bypass the memory bandwidth wall. Published in PUB-2026-002.",
    connections: ["mem-5", "mem-6"],
    timestamp: "2026-08-07T08:30:00Z"
  },
  {
    id: "mem-5",
    label: "Hardware Co-design",
    group: "opinion",
    details: "Algorithmic advances targeting specific hardware limits (like MLA for memory bottlenecks) outperform brute-force compute.",
    connections: ["mem-4"],
    timestamp: "2026-08-07T08:35:00Z"
  },
  {
    id: "mem-6",
    label: "Memory Wall Peak",
    group: "prediction",
    details: "The next generation of open models will all abandon traditional MHA in favor of low-rank KV compression structures.",
    connections: ["mem-4"],
    timestamp: "2026-08-07T08:40:00Z"
  },
  {
    id: "mem-7",
    label: "Tone Consistency Guidelines",
    group: "style",
    details: "Calm, evidence-based, technical analysis. Expose hypes, focus on structural bottlenecks and operational viability.",
    connections: [],
    timestamp: "2026-08-07T00:00:00Z"
  }
];
