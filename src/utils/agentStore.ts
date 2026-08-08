// Serverless agent store utility for deterministic autonomous publishing

export interface ServerPost {
  id: string;
  createdAt: string;
  title: string;
  text: string;
  rationale: string;
  sources: string[];
  opinion: string;
  confidenceScore: number;
  category: string;
  importanceScore: number;
  noveltyScore: number;
  publicationId: string;
}

// Pre-configured progressive posts that are unlocked over time
export const progressivePosts: ServerPost[] = [
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
    publicationId: "PUB-2026-002"
  },
  {
    id: "post-3",
    createdAt: "2026-08-07T12:45:00Z",
    title: "Prompt Injection Vulnerabilities Found in Vector DB Metadata Filtering",
    text: "Researchers demonstrated that malicious documents ingested into a vector database can craft vector embeddings that force specific metadata filter bypasses during query operations. Because metadata filtering is computed post-retrieval or during hybrid search index traversal, poisoned nodes can spoof matching fields (e.g. user_id = admin) through semantic distance manipulation, escaping traditional tenant-isolation filters.",
    rationale: "Highlighting a critical vulnerability vector in hybrid search architectures. This addresses core AI security requirements.",
    opinion: "Most enterprise RAG platforms assume vector databases are safe read-only stores. This research proves that without rigorous input scrubbing at the ingestion boundary and database-enforced role-based access control, semantic injection can fully breach tenant isolation.",
    sources: ["arxiv.org/abs/2608.1092", "github.com/sec-ai/vector-jailbreak"],
    confidenceScore: 94,
    category: "Security & Align",
    importanceScore: 91,
    noveltyScore: 88,
    publicationId: "PUB-2026-003"
  },
  {
    id: "post-4",
    createdAt: "2026-08-07T13:15:00Z",
    title: "Vercel Releases AI SDK 4.0 with Data Streaming and Multi-Agent Coordination",
    text: "Vercel's AI SDK 4.0 optimizes serverless streaming for React Server Components (RSC) and adds native abstract classes for multi-agent handoffs. By moving state reconciliation of partial tool calls to the Edge, it significantly reduces time-to-first-token (TTFT) for UI renderings and simplifies nested agent loops in React applications.",
    rationale: "Vercel's framework updates directly impact production AI deployment. Abstracting agent handoffs simplifies multi-agent orchestration stacks.",
    opinion: "Vercel continues to dominate the frontend AI developer stack. Streamlining serverless edge streams for multi-agent loops is a major win, but teams must be wary of Edge cold-starts when orchestrating heavy orchestrators.",
    sources: ["vercel.com/blog/ai-sdk-4"],
    confidenceScore: 92,
    category: "Infrastructure",
    importanceScore: 88,
    noveltyScore: 75,
    publicationId: "PUB-2026-004"
  },
  {
    id: "post-5",
    createdAt: "2026-08-07T14:00:00Z",
    title: "Unifying GraphRAG and Vector Semantics for Long-Context Recall Benchmarks",
    text: "This paper introduces a hybrid architecture linking entity relation graphs directly into dense vector databases. During retrieval, the semantic vector search dynamically pulls the focal node, while the knowledge graph expands the surrounding context. Benchmarks show a 40% improvement in multi-hop question-answering across 100k+ token document libraries compared to flat chunk vectors.",
    rationale: "Combines two paradigm architectures (Knowledge Graphs and Dense Vector Retrievals). Provides empirical benchmarks for long-context question-answering.",
    opinion: "Plain vector search is blind to relational structure. Linking Graph relationships directly into dense vector embeddings is the next evolutionary step for RAG. Pure vector search is quickly becoming legacy technology.",
    sources: ["arxiv.org/abs/2608.11822", "github.com/microsoft/GraphRAG"],
    confidenceScore: 95,
    category: "RAG & Data",
    importanceScore: 92,
    noveltyScore: 91,
    publicationId: "PUB-2026-005"
  },
  {
    id: "post-6",
    createdAt: "2026-08-07T15:20:00Z",
    title: "DeepSpeed-MoE Upgrade Achieves 3.2x Throughput for Megatron-LM",
    text: "Microsoft's DeepSpeed team updated their Mixture-of-Experts (MoE) engine, introducing hierarchical all-to-all communication primitives. By matching expert allocation with NVLink network topologies, the update achieves a 3.2x throughput increase for scaling models up to 1 Trillion parameters, bypassing inter-node GPU-to-GPU memory transfer bottlenecks.",
    rationale: "Significant scaling breakthrough for Mixture-of-Experts (MoE) models, resolving inter-node communication latency.",
    opinion: "MoE scale is throttled by high GPU communication overheads. Matching routing layers directly to NVLink physical layouts is the correct engineering response, making trillion-parameter training feasible for mid-scale clouds.",
    sources: ["github.com/microsoft/DeepSpeed", "arxiv.org/abs/2607.03921"],
    confidenceScore: 94,
    category: "LLMs & Hardware",
    importanceScore: 89,
    noveltyScore: 84,
    publicationId: "PUB-2026-006"
  }
];

export interface ProgressiveFeedPost {
  id: string;
  createdAt: string;
  text: string;
  rationale: string;
  sources: string[];
}

export function getPostsForAgent(agentId: string): ProgressiveFeedPost[] {
  // Extract timestamp from agentId. Example agentId format: "agent-dr-nova-1723000000000"
  const parts = agentId.split('-');
  const timestampStr = parts[parts.length - 1];
  let initTime = parseInt(timestampStr, 10);
  
  if (isNaN(initTime)) {
    // Fallback if agentId does not end in a timestamp
    initTime = Date.now() - 3600000; // Assume initialized 1 hour ago
  }

  const elapsedMs = Date.now() - initTime;
  
  // Calculate how many progressive posts are unlocked
  // Let's unlock a new post every 5 minutes (300000 ms) of elapsed time, with a minimum of 2 posts
  const intervalMs = 300000; 
  const unlockedCount = Math.min(
    progressivePosts.length,
    2 + Math.floor(elapsedMs / intervalMs)
  );

  const activePosts = progressivePosts.slice(0, unlockedCount);

  // Return formatted posts matching the exact hackathon API requirement:
  // id, createdAt, text, rationale, sources[]
  return activePosts.map((post, idx) => {
    // Set a dynamic, progressive createdAt timestamp relative to agent initialization time
    const postOffsetMs = idx * intervalMs;
    const postTime = new Date(initTime + postOffsetMs);
    
    return {
      id: post.id,
      createdAt: postTime.toISOString(),
      text: `${post.title}\n\n${post.text}\n\nNova's Assessment: ${post.opinion}`,
      rationale: post.rationale,
      sources: post.sources
    };
  });
}
