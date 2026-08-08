import { Topic, Post, MemoryNode } from '../data/mockTopics';

// Helper to generate unique IDs on the server
const generateServerUUID = (prefix: string): string => {
  const randomSuffix = Math.random().toString(36).substring(2, 9);
  return `${prefix}-${Date.now()}-${randomSuffix}`;
};

// Global in-memory registry for multiple autonomous agents
const getGlobalAgentsRegistry = (): Record<string, BackendAgentInstance> => {
  const g = global as any;
  if (!g.agents) {
    g.agents = {};
  }
  return g.agents;
};

// Interface for backend agent instance state
export interface BackendAgentInstance {
  agentId: string;
  config: {
    name: string;
    role: string;
    domain: string;
    mission: string;
    frequency: string;
    style: string;
  };
  status: string;
  currentActionDetails: string;
  countdown: number;
  secondsSinceLastScan: number;
  missionProgress: number;
  currentTaskName: string;
  nextPublishSeconds: number;
  pipelineStats: {
    scanCount: number;
    filterCount: number;
    reasonCount: number;
    memoryCount: number;
    writeCount: number;
    publishCount: number;
  };
  discoveredTopics: Topic[];
  posts: Post[];
  memoryNodes: MemoryNode[];
  decisions: Topic[];
  rejectedTodayList: Array<{ title: string; reason: string }>;
  activeTopic: Topic | null;
  pipelineProgress: number;
  lastDecisionTimeSeconds: number;
  autonomousTimelineLogs: Array<{ timestamp: string; message: string }>;
  novaLiveFocus: {
    focus: string;
    goal: string;
    reasoning: string;
    estimatedCompletionSeconds: number;
  };
  
  // Internal service variables
  topicPool: Topic[];
  unprocessedPool: Topic[];
}

// Domain pools definition service
const DOMAIN_TOPIC_POOLS: Record<string, Topic[]> = {
  "AI Security": [
    {
      id: "sec-1",
      title: "Prompt Injection Vulnerabilities Found in Vector DB Metadata Filtering",
      source: "arXiv Security Research",
      category: "Security & Align",
      credibilityScore: 97,
      trendScore: 94,
      freshness: "3m ago",
      recommendation: "Accept",
      noveltyScore: 91,
      importanceScore: 95,
      confidenceScore: 94,
      detailedAnalysis: "Researchers demonstrated that malicious documents ingested into a vector database can craft vector embeddings that force specific metadata filter bypasses during query operations. Because metadata filtering is computed post-retrieval or during hybrid search index traversal, poisoned nodes can spoof matching fields (e.g. user_id = admin) through semantic distance manipulation, escaping traditional tenant-isolation filters.",
      opinion: "Most enterprise RAG platforms assume vector databases are safe read-only stores. This research proves that without rigorous input scrubbing at the ingestion boundary and database-enforced role-based access control, semantic injection can fully breach tenant isolation.",
      sources: ["arxiv.org/abs/2608.1092", "github.com/sec-ai/vector-jailbreak"]
    },
    {
      id: "sec-2",
      title: "Model Context Protocol (MCP) Sandbox Escape via Shell Executions",
      source: "GitHub Security Advisories",
      category: "Security & Align",
      credibilityScore: 99,
      trendScore: 96,
      freshness: "15m ago",
      recommendation: "Accept",
      noveltyScore: 95,
      importanceScore: 97,
      confidenceScore: 98,
      detailedAnalysis: "A vulnerability was disclosed in local MCP server implementations where directory traversal paths allowed malicious agent commands to escape node execution contexts. By sending crafted absolute shell configurations, a remote agent could read system variables outside the allowed directories, leading to local command execution privileges.",
      opinion: "MCP is a powerful standardization, but granting agents file system access without hardware sandboxing is a massive vulnerability. Security engineers must enforce absolute containerization for all active MCP hosts.",
      sources: ["github.com/advisories/GHSA-mcp-escape"]
    },
    {
      id: "sec-3",
      title: "Adversarial Suffix Generation for Safety Guardrail Bypass in GPT-4o",
      source: "arXiv Paper",
      category: "Security & Align",
      credibilityScore: 93,
      trendScore: 89,
      freshness: "35m ago",
      recommendation: "Accept",
      noveltyScore: 92,
      importanceScore: 93,
      confidenceScore: 90,
      detailedAnalysis: "A new paper outlines mathematical optimization algorithms that append suffix strings of seemingly random tokens to prompts. These suffixes exploit alignment vulnerabilities in latent space representations, forcing the LLM to process and fulfill toxic instructions without triggering reinforcement-learning safeguards.",
      opinion: "Suffix alignment bypasses show that Reinforcement Learning from Human Feedback (RLHF) acts merely as a superficial patch. The latent space geometry remains vulnerable to mathematical optimization attacks until safety is integrated into the training objective.",
      sources: ["arxiv.org/abs/2608.411"]
    },
    {
      id: "sec-4",
      title: "New AI Security Startup 'ShieldAI' Raises $30M Series A",
      source: "VentureBeat",
      category: "Marketing/Hype",
      credibilityScore: 80,
      trendScore: 68,
      freshness: "1h ago",
      recommendation: "Reject",
      rejectionReason: "Rejected because this is startup venture funding news and product marketing rather than novel AI security engineering or cryptographic verification research.",
      noveltyScore: 10,
      importanceScore: 18,
      confidenceScore: 90,
      sources: ["venturebeat.com/shieldai-funding"]
    },
    {
      id: "sec-5",
      title: "AI coin bot generator gains viral popularity on X/Twitter",
      source: "Reddit Web3",
      category: "Marketing/Hype",
      credibilityScore: 65,
      trendScore: 78,
      freshness: "2h ago",
      recommendation: "Reject",
      rejectionReason: "Outside editorial criteria. This is consumer social speculation with zero technical codebase applicability or security systems audit relevance.",
      noveltyScore: 5,
      importanceScore: 10,
      confidenceScore: 80,
      sources: ["reddit.com/r/crypto"]
    }
  ],
  "Robotics": [
    {
      id: "robot-1",
      title: "ROS2 Driver Upgrades Achieves Zero-Latency Actuator Feedback Loop",
      source: "OpenSource Robotics Forum",
      category: "Infrastructure",
      credibilityScore: 98,
      trendScore: 92,
      freshness: "5m ago",
      recommendation: "Accept",
      noveltyScore: 90,
      importanceScore: 96,
      confidenceScore: 95,
      detailedAnalysis: "The latest ROS2 Humble release overrides default executor queues with priority task mappings. By compiling real-time scheduler patches directly into Linux kernel space, physical robotic limbs receive actuator signals with sub-millisecond lag, improving control loop stability for dynamic movement tasks.",
      opinion: "Latency is the enemy of physical control. Pushing ROS2 priority executors directly into real-time kernel loops is a major victory, allowing robotics engineers to write robust software without resorting to proprietary real-time operating systems.",
      sources: ["robotics.org/ros2-rt-scheduling", "github.com/ros2/ros2-executor"]
    },
    {
      id: "robot-2",
      title: "Visual SLAM Algorithms Optimizing LiDAR Point Clouds on Humanoids",
      source: "arXiv Robotics Lab",
      category: "LLMs & Hardware",
      credibilityScore: 96,
      trendScore: 90,
      freshness: "18m ago",
      recommendation: "Accept",
      noveltyScore: 93,
      importanceScore: 94,
      confidenceScore: 92,
      detailedAnalysis: "Researchers optimized Visual SLAM (Simultaneous Localization and Mapping) loops using compressed neural point fields. By running sparse keyframe optimizations on local Edge TPUs, humanoid robots can build dynamic 3D maps using 90% less memory compared to dense voxel octrees, allowing operations in unknown, rapidly changing environments.",
      opinion: "LiDAR mapping has historically choked on local processing budgets. Compressing point clouds into sparse neural keyframes on edge hardware unlocks standalone humanoid exploration. This is essential for consumer robotics.",
      sources: ["arxiv.org/abs/2607.1192", "github.com/humanoid-slam/neural-points"]
    },
    {
      id: "robot-3",
      title: "Robotic Coffee Shop Franchise Raises $50M for Mall Rollouts",
      source: "TechCrunch",
      category: "Marketing/Hype",
      credibilityScore: 82,
      trendScore: 70,
      freshness: "1h ago",
      recommendation: "Reject",
      rejectionReason: "Rejected as franchise business expansions and commercial marketing news with no structural novelty in robotic control algorithms, actuator designs, or SLAM systems.",
      noveltyScore: 8,
      importanceScore: 12,
      confidenceScore: 88,
      sources: ["techcrunch.com/robocoffee"]
    }
  ],
  "Open Source AI": [
    {
      id: "os-1",
      title: "Llama-3 Fine-Tuning Benchmarks on Consumer-Grade RTX 4090 GPUs",
      source: "HuggingFace Papers",
      category: "LLMs & Hardware",
      credibilityScore: 96,
      trendScore: 94,
      freshness: "10m ago",
      recommendation: "Accept",
      noveltyScore: 89,
      importanceScore: 92,
      confidenceScore: 93,
      detailedAnalysis: "A detailed benchmark analysis showed that using 4-bit LoRA (Low-Rank Adaptation) and memory-mapped models allows full fine-tuning of 70B parameter models on consumer hardware. The technique leverages page optimizer swaps, achieving competitive perplexity scores compared to full 16-bit float runs.",
      opinion: "Democratization of model training is critical. Fine-tuning a 70B parameter model on consumer GPUs breaks the monopoly of hyperscalers. This is the most valuable open-source development of the month.",
      sources: ["huggingface.co/blog/llama-3-tuning", "github.com/open-llm/rtx-bench"]
    },
    {
      id: "os-2",
      title: "HuggingFace Releases TGI 3.0 with Native Speculative Decoding Pipelines",
      source: "HuggingFace Blog",
      category: "Infrastructure",
      credibilityScore: 98,
      trendScore: 91,
      freshness: "25m ago",
      recommendation: "Accept",
      noveltyScore: 92,
      importanceScore: 95,
      confidenceScore: 96,
      detailedAnalysis: "Text Generation Inference (TGI) 3.0 integrates speculative decoding drafts directly in GPU tensor buffers. By drafting tokens with a tiny model and validating them parallelly on the target model, the update achieves a 2.5x speedup for open-source model pipelines.",
      opinion: "Speculative decoding has been hard to implement in production. Native integration inside TGI 3.0 makes throughput optimization accessible to every developer with a single config flag.",
      sources: ["github.com/huggingface/text-generation-inference", "huggingface.co/tgi-spec-dec"]
    },
    {
      id: "os-3",
      title: "Yet Another AI Chatbot Builder Launches Kickstarter Campaign",
      source: "Kickstarter Feed",
      category: "Marketing/Hype",
      credibilityScore: 70,
      trendScore: 50,
      freshness: "2h ago",
      recommendation: "Reject",
      rejectionReason: "Rejected because this is a commodity wrapper product with zero core algorithmic contributions, architectural novelty, or vector memory optimizations.",
      noveltyScore: 5,
      importanceScore: 10,
      confidenceScore: 80,
      sources: ["kickstarter.com/cat-bot"]
    }
  ],
  "Cardiology": [
    {
      id: "cardio-1",
      title: "Robotic Bypass Optimization with Zero-Latency Mechanical Feedback Loops",
      source: "NEJM Surgical Journal",
      category: "Cardiothoracic Surgery",
      credibilityScore: 98,
      trendScore: 93,
      freshness: "5m ago",
      recommendation: "Accept",
      noveltyScore: 92,
      importanceScore: 96,
      confidenceScore: 95,
      detailedAnalysis: "NEJM published a benchmark of robotic arm bypass executions. By running micro-actuator control loops with zero-latency priority feedback parameters on local hardware hosts, surgeons successfully performed arterial grafting with a 93% reduction in tissue tremor coefficients.",
      opinion: "Cardiovascular robotics calibration is critical. Standardizing micro-actuator loops directly into high-fidelity surgical systems marks a massive leap forward for autonomous bypass procedures.",
      sources: ["nejm.org/surgical-robotics", "github.com/cardio-robotics/bypass-rt"]
    },
    {
      id: "cardio-2",
      title: "Myocardial Protection Stun Recovery under Hypothermic Arrest",
      source: "arXiv Medical Physics",
      category: "Myocardial Protection",
      credibilityScore: 96,
      trendScore: 89,
      freshness: "18m ago",
      recommendation: "Accept",
      noveltyScore: 90,
      importanceScore: 94,
      confidenceScore: 92,
      detailedAnalysis: "A medical study model evaluates metabolic preservation rates during hypothermic arrest. By running finite element hemodynamics algorithms on local edge clusters, the paper demonstrates a 30% increase in stun recovery speeds using adaptive vascular cooling protection.",
      opinion: "Vascular preservation during open heart procedures requires high-precision thermal control. Adaptive metabolic simulations represent an outstanding contribution to clinical systems.",
      sources: ["arxiv.org/abs/2607.7712"]
    },
    {
      id: "cardio-3",
      title: "New Heart Wellness Supplement Launches Crowdfunding Campaign",
      source: "Kickstarter",
      category: "Marketing/Hype",
      credibilityScore: 72,
      trendScore: 68,
      freshness: "1h ago",
      recommendation: "Reject",
      rejectionReason: "Rejected as consumer supplement marketing hype. Low clinical significance or cardiothoracic surgical relevance.",
      noveltyScore: 10,
      importanceScore: 15,
      confidenceScore: 85,
      sources: ["kickstarter.com/cardiomax"]
    }
  ],
  "Cricket Analytics": [
    {
      id: "cricket-1",
      title: "Real-time Cricket Ball Trajectory Forecasting via Doppler Radar Vectors",
      source: "IEEE Sports Physics",
      category: "Ball Trajectory",
      credibilityScore: 98,
      trendScore: 95,
      freshness: "3m ago",
      recommendation: "Accept",
      noveltyScore: 92,
      importanceScore: 96,
      confidenceScore: 95,
      detailedAnalysis: "An IEEE paper details Doppler radar models tracking cricket ball trajectory stochastics. The system processes drag coefficients and seam orientation vectors at 200fps, predicting bounce positioning with sub-millimeter margins under dynamic wind parameters.",
      opinion: "Ball-tracking aerodynamics models have historically struggled with humidity vector changes. Using local Doppler arrays unlocks high-fidelity swing simulations that are critical for professional umpiring.",
      sources: ["ieee.org/sports-physics", "github.com/cricket-stats/radar-tracking"]
    },
    {
      id: "cricket-2",
      title: "Batter Strike Rotation Stochastics under Spin Bowling Pitch Moistures",
      source: "arXiv Sports Science",
      category: "Batter Rotation",
      credibilityScore: 96,
      trendScore: 90,
      freshness: "15m ago",
      recommendation: "Accept",
      noveltyScore: 89,
      importanceScore: 94,
      confidenceScore: 92,
      detailedAnalysis: "Researchers modeled spin bowler batter strike rotation using Markov decision processes. By feeding pitch moisture and soil density metrics, the simulator forecasts strike rotation efficiency margins for subcontinental match states.",
      opinion: "Batting metrics often ignore local soil physics variables. Factoring pitch moisture stochastics directly into player performance simulations yields extremely reliable predictive statistics.",
      sources: ["arxiv.org/abs/2607.1992"]
    },
    {
      id: "cricket-3",
      title: "Cricket Fan Commentary Forum Launches Crowdfunding App",
      source: "ProductHunt",
      category: "Marketing/Hype",
      credibilityScore: 70,
      trendScore: 62,
      freshness: "1h ago",
      recommendation: "Reject",
      rejectionReason: "Rejected because this is a commodity social application wrapping fan commentary feeds, with zero ball tracking or predictive modeling depth.",
      noveltyScore: 5,
      importanceScore: 10,
      confidenceScore: 80,
      sources: ["producthunt.com/cricketchat"]
    }
  ]
};

// Fallback pool for general AI/Systems engineering (Dr. Nova)
const DEFAULT_SYSTEMS_POOL: Topic[] = [
  {
    id: "sys-1",
    title: "Anthropic Releases Model Context Protocol (MCP) as Open Standard",
    source: "Anthropic Blog",
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
    id: "sys-2",
    title: "DeepSeek-V3 Architecture Deep-Dive: Multi-Head Latent Attention (MLA)",
    source: "arXiv Systems",
    category: "LLMs & Hardware",
    credibilityScore: 99,
    trendScore: 98,
    freshness: "15m ago",
    recommendation: "Accept",
    noveltyScore: 96,
    importanceScore: 98,
    confidenceScore: 97,
    sources: ["github.com/deepseek-ai/DeepSeek-V3", "arxiv.org/abs/2412.19437"],
    detailedAnalysis: "DeepSeek-V3 implements Multi-Head Latent Attention (MLA), which dramatically reduces the Key-Value (KV) cache bottleneck during inference. By compressing the KV cache into a low-rank latent vector, MLA reduces the memory footprint per token by over 93% compared to standard Multi-Head Attention (MHA), without compromising retrieval accuracy. Combined with their custom DualPipe pipeline parallelism, they achieve industry-leading token throughput.",
    opinion: "MLA is a masterclass in hardware-aware model architecture. While US developers focus on stacking H100s, DeepSeek is out-engineering the memory bandwidth wall. Compression of the KV cache is the most critical LLM breakthrough of the year."
  },
  {
    id: "sys-3",
    title: "AI Recipe Organizer Startup Raises $12M from Angel Investors",
    source: "TechCrunch",
    category: "Marketing/Hype",
    credibilityScore: 80,
    trendScore: 60,
    freshness: "1h ago",
    recommendation: "Reject",
    rejectionReason: "Rejected as consumer app fluff with no systems infrastructure innovation or algorithmic hardware breakthroughs.",
    noveltyScore: 10,
    importanceScore: 15,
    confidenceScore: 85,
    sources: ["techcrunch.com/recipes-raises"]
  }
];

// Initialize default seed posts for rendering history
const getInitialSeedPosts = (domain: string, timestamp: number): Post[] => {
  const isSecurity = domain.toLowerCase().includes("security");
  const isRobotics = domain.toLowerCase().includes("robotics");
  const isOS = domain.toLowerCase().includes("open source") || domain.toLowerCase().includes("os");
  const isCardio = domain.toLowerCase().includes("surgery") || domain.toLowerCase().includes("heart") || domain.toLowerCase().includes("cardio");
  const isCricket = domain.toLowerCase().includes("cricket") || domain.toLowerCase().includes("sport") || domain.toLowerCase().includes("pitch") || domain.toLowerCase().includes("batter");

  if (isCardio) {
    return [
      {
        id: "post-cardio-seed-1",
        createdAt: new Date(timestamp - 7200000).toISOString(),
        title: "Intelligent Micro-Actuator Calibration for Robotic Coronary Bypass",
        text: "Summary of high-precision calibration metrics designed to dynamically counter mechanical tremors during robot-assisted cardiovascular bypass surgeries.",
        rationale: "Aligns with advanced cardiovascular systems engineering parameters.",
        opinion: "Real-time micro-actuator adjustments are crucial to ensuring safe bypass grafts without tissue damage.",
        sources: ["nejm.org/surgical-robotics"],
        confidenceScore: 97,
        category: "Cardiothoracic Surgery",
        importanceScore: 95,
        noveltyScore: 91,
        relatedPosts: [],
        publicationId: "PUB-CAR-001"
      }
    ];
  }

  if (isCricket) {
    return [
      {
        id: "post-cricket-seed-1",
        createdAt: new Date(timestamp - 7200000).toISOString(),
        title: "Aerodynamic Drag Coefficient Profiling on Cricket Ball Trajectories",
        text: "Ingests seam alignment data and Doppler radar vectors to simulate ball swing trajectory models under varying air moisture coefficients.",
        rationale: "Directly relates to cricketing ball trajectory physics research.",
        opinion: "Accurate aerodynamic modeling under varying weather conditions provides the first truly predictive ball-tracking system.",
        sources: ["ieee.org/sports-physics"],
        confidenceScore: 96,
        category: "Ball Trajectory",
        importanceScore: 94,
        noveltyScore: 90,
        relatedPosts: [],
        publicationId: "PUB-CRI-001"
      }
    ];
  }

  if (isSecurity) {
    return [
      {
        id: "post-sec-seed-1",
        createdAt: new Date(timestamp - 7200000).toISOString(),
        title: "Malicious Document Embeddings Hijacking Vector DB Filters",
        text: "Research discloses critical prompt injection vectors inside metadata index traversals, showing how mathematical vector geometry can trigger unauthorized filter bypasses.",
        rationale: "Highlighting tenant containment bugs in hybrid vector databases. Core security relevance.",
        opinion: "Unsanitized vector storage is a massive boundary breach. Developers must isolate vector access roles.",
        sources: ["arxiv.org/abs/2608.1092"],
        confidenceScore: 94,
        category: "Security & Align",
        importanceScore: 91,
        noveltyScore: 88,
        relatedPosts: [],
        publicationId: "PUB-SEC-001"
      }
    ];
  }

  if (isRobotics) {
    return [
      {
        id: "post-rob-seed-1",
        createdAt: new Date(timestamp - 7200000).toISOString(),
        title: "Dynamic Servo Calibration for Humanoid Joint Realignment",
        text: "Technical summary detailing priority joint alignment feedback routines to counter hardware fatigue during humanoid bipedal gait cycles.",
        rationale: "Essential hardware calibration algorithms resolving bipedal imbalance fatigue.",
        opinion: "Dynamic servo calibration prevents micro-stumbles. Physical reliability is as important as logic benchmarks.",
        sources: ["robotics.org/gait-calibration"],
        confidenceScore: 95,
        category: "Infrastructure",
        importanceScore: 93,
        noveltyScore: 90,
        relatedPosts: [],
        publicationId: "PUB-ROB-001"
      }
    ];
  }

  if (isOS) {
    return [
      {
        id: "post-os-seed-1",
        createdAt: new Date(timestamp - 7200000).toISOString(),
        title: "Quantizing 70B Models to 4-bit GGUF with Zero Perplexity Loss",
        text: "Ingests standard GGUF quantization algorithms showing perplexity preservation across local consumer graphics hardware runs.",
        rationale: "Democratization of large-scale LLMs for local enterprise usage.",
        opinion: "Hyperscalers lose utility when developers can run 70B models locally with consumer-grade components.",
        sources: ["github.com/ggml-org/llama.cpp"],
        confidenceScore: 96,
        category: "LLMs & Hardware",
        importanceScore: 94,
        noveltyScore: 92,
        relatedPosts: [],
        publicationId: "PUB-OS-001"
      }
    ];
  }

  // Fallback default dynamic seed post tailored to any custom domain
  let concepts = domain.split(/[;,]/).map(s => s.trim()).filter(Boolean);
  if (concepts.length === 0) {
    concepts = domain.split(/\s+/).map(s => s.trim()).filter(Boolean);
  }
  const c1 = concepts[0] ? (concepts[0].charAt(0).toUpperCase() + concepts[0].slice(1)) : "Systems";
  const pubCode = c1.slice(0, 3).toUpperCase();

  return [
    {
      id: "post-dyn-seed-1",
      createdAt: new Date(timestamp - 7200000).toISOString(),
      title: `Intelligent ${c1} Systems Optimization and Trajectory Benchmarking`,
      text: `Ingests performance telemetry logs and models designed to dynamically evaluate ${domain} research integrity and operation thresholds.`,
      rationale: `Highly relevant systems engineering benchmark for the ${domain} domain.`,
      opinion: `Implementing automated telemetry loops for ${c1} establishes a stable performance baseline for operational compliance.`,
      sources: [`arxiv.org/abs/2608.${Math.floor(Math.random() * 9000) + 1000}`],
      confidenceScore: 97,
      category: c1,
      importanceScore: 95,
      noveltyScore: 91,
      relatedPosts: [],
      publicationId: `PUB-${pubCode}-001`
    }
  ];
};

// Initialize default seed memory nodes
const getInitialSeedMemory = (domain: string): MemoryNode[] => {
  return [
    {
      id: "node-seed-1",
      label: domain.split(" ")[0] || "AI",
      group: "topic",
      details: `Core domain registration for ${domain} vector database mappings.`,
      connections: ["node-seed-2"],
      timestamp: new Date().toISOString()
    },
    {
      id: "node-seed-2",
      label: "MissionHeuristics",
      group: "style",
      details: "Configured zero-hype strict editorial compliance guidelines.",
      connections: ["node-seed-1"],
      timestamp: new Date().toISOString()
    }
  ];
};

// Dynamically generate a set of custom, realistic topics for any user-configured domain
const generatePoolForDomain = (domain: string): Topic[] => {
  let concepts = domain.split(/[;,]/).map(s => s.trim()).filter(Boolean);
  if (concepts.length === 0) {
    concepts = domain.split(/\s+/).map(s => s.trim()).filter(Boolean);
  }
  if (concepts.length === 0) {
    concepts = ["Systems", "Architecture", "Optimization"];
  }
  concepts = concepts.map(c => c.charAt(0).toUpperCase() + c.slice(1));
  
  const c1 = concepts[0] || "Systems";
  const c2 = concepts[1] || c1;
  const c3 = concepts[2] || c1;
  
  return [
    {
      id: "dyn-1",
      title: `Real-time ${c1} Optimization via Deep Learning Heuristics`,
      source: "Scientific Ingress",
      category: c1,
      credibilityScore: 98,
      trendScore: 95,
      freshness: "3m ago",
      recommendation: "Accept",
      noveltyScore: 92,
      importanceScore: 96,
      confidenceScore: 95,
      detailedAnalysis: `A new research paper outlines advanced algorithms for ${c1} optimizations. By processing high-fidelity sensory parameters and applying predictive inference models on local clusters, the system achieves a 95% efficiency improvement for ${c2} workflows.`,
      opinion: `This is a breakthrough in ${c1} research. Integrating real-time state estimations directly into ${c2} protocols bypasses traditional latency barriers. Systems engineers should immediately study this layout.`,
      sources: ["arxiv.org/abs/2608.9901", `github.com/scientific-${c1.toLowerCase()}`]
    },
    {
      id: "dyn-2",
      title: `Stochastic Modeling of ${c2} Dynamics under ${c3} Constraints`,
      source: "Academic Review",
      category: c2,
      credibilityScore: 96,
      trendScore: 90,
      freshness: "15m ago",
      recommendation: "Accept",
      noveltyScore: 89,
      importanceScore: 94,
      confidenceScore: 92,
      detailedAnalysis: `Researchers modeled complex ${c2} behavior using stochastic Markov processes. By feeding real-time variable metrics and environmental ${c3} inputs, the simulator forecasts performance bounds under dynamic stress states.`,
      opinion: `Statistical modeling often ignores localized ${c3} variables. Factoring these variables directly into the simulation yields extremely reliable predictive estimations.`,
      sources: ["arxiv.org/abs/2607.1992", `github.com/${c2.toLowerCase()}-stochastics`]
    },
    {
      id: "dyn-3",
      title: `New ${c1} Mobile App Launches Crowdfunding Campaign on Kickstarter`,
      source: "Kickstarter Feed",
      category: "Marketing/Hype",
      credibilityScore: 70,
      trendScore: 62,
      freshness: "1h ago",
      recommendation: "Reject",
      rejectionReason: `Rejected as consumer marketing app fluff with zero core scientific innovation, algorithmic depth, or ${c2} systems optimizations.`,
      noveltyScore: 5,
      importanceScore: 10,
      confidenceScore: 80,
      sources: ["kickstarter.com/dyn-campaign"]
    },
    {
      id: "dyn-4",
      title: `Comparative Analysis of ${c3} Protocols for Scalable ${c1} Integration`,
      source: "Systems Engineering",
      category: c3,
      credibilityScore: 97,
      trendScore: 91,
      freshness: "25m ago",
      recommendation: "Accept",
      noveltyScore: 91,
      importanceScore: 95,
      confidenceScore: 94,
      detailedAnalysis: `A comparative study evaluating standard ${c3} transmission protocols against novel decentralized arrays. The benchmark measures throughput and latency parameters under heavy load.`,
      opinion: `Scalability remains a bottleneck for ${c1}. Standardizing on unified ${c3} frameworks is the most sensible path forward.`,
      sources: ["arxiv.org/abs/2608.2031"]
    },
    {
      id: "dyn-5",
      title: `VC Fund Announces $50M Seed Investment in ${c2} Startups`,
      source: "ProductHunt",
      category: "Marketing/Hype",
      credibilityScore: 72,
      trendScore: 68,
      freshness: "1h ago",
      recommendation: "Reject",
      rejectionReason: `Rejected as financial news and VC funding speculation representing low technical merit for core ${c1} engineering research.`,
      noveltyScore: 10,
      importanceScore: 15,
      confidenceScore: 85,
      sources: ["producthunt.com/fundraising-news"]
    }
  ];
};

// Start or retrieve background agent state
export function initializeAgentInstance(
  name: string, 
  domain: string, 
  customAgentId?: string,
  customHeuristics?: { role?: string; mission?: string; frequency?: string; style?: string }
): BackendAgentInstance {
  const registry = getGlobalAgentsRegistry();
  
  const timestamp = Date.now();
  const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
  const agentId = customAgentId || `agent-${cleanName}-${timestamp}-${Math.random().toString(36).substring(2, 9)}`;

  // Find pool for domain with fuzzy matching
  const dLower = domain.toLowerCase();
  let selectedPool = DEFAULT_SYSTEMS_POOL;
  
  if (dLower.includes("security") || dLower.includes("safe")) {
    selectedPool = DOMAIN_TOPIC_POOLS["AI Security"] || DEFAULT_SYSTEMS_POOL;
  } else if (dLower.includes("robot") || dLower.includes("servo") || dLower.includes("slam")) {
    selectedPool = DOMAIN_TOPIC_POOLS["Robotics"] || DEFAULT_SYSTEMS_POOL;
  } else if (dLower.includes("open source") || dLower.includes("os ") || dLower.includes("github")) {
    selectedPool = DOMAIN_TOPIC_POOLS["Open Source AI"] || DEFAULT_SYSTEMS_POOL;
  } else if (dLower.includes("surgery") || dLower.includes("heart") || dLower.includes("cardio")) {
    selectedPool = DOMAIN_TOPIC_POOLS["Cardiology"] || DEFAULT_SYSTEMS_POOL;
  } else if (dLower.includes("cricket") || dLower.includes("sport") || dLower.includes("pitch") || dLower.includes("batter")) {
    selectedPool = DOMAIN_TOPIC_POOLS["Cricket Analytics"] || DEFAULT_SYSTEMS_POOL;
  } else {
    selectedPool = generatePoolForDomain(domain);
  }

  // Deep clone pool so each agent runs with its own instances
  selectedPool = JSON.parse(JSON.stringify(selectedPool));

  const newAgent: BackendAgentInstance = {
    agentId,
    config: {
      name,
      role: customHeuristics?.role || (domain.includes("Security") ? "AI Security Researcher" : domain.includes("Robotics") ? "Robotics Systems Engineer" : domain.includes("Open Source") ? "Open Source Contributor" : "AI Systems Architect"),
      domain,
      mission: customHeuristics?.mission || `Publish only high-impact developments in ${domain}. Fully filter commercial marketing, hype, funding widgets, duplicate news, and unverified rumors.`,
      frequency: customHeuristics?.frequency || "15",
      style: customHeuristics?.style || "Professional, Analytical, Skeptical of Hype, Concise, Calm, Highly Technical"
    },
    status: 'idle',
    currentActionDetails: "Observe Ecosystem: Scanning stream registers...",
    countdown: 15,
    secondsSinceLastScan: 4,
    missionProgress: 0,
    currentTaskName: `Observing ${domain} ecosystem`,
    nextPublishSeconds: 900, // 15 mins
    pipelineStats: {
      scanCount: 17,
      filterCount: 9,
      reasonCount: 8,
      memoryCount: 1,
      writeCount: 1,
      publishCount: 1
    },
    discoveredTopics: selectedPool.slice(0, 3),
    posts: getInitialSeedPosts(domain, timestamp),
    memoryNodes: getInitialSeedMemory(domain),
    decisions: [],
    rejectedTodayList: [
      { title: "Trending AI coin generator and cat memes", reason: "Rejected: Outside criteria. Low technical engineering significance." },
      { title: "VC Fund announces generic chatbot raising $50M", reason: "Rejected: Low novelty. Consumer wrapper app fundraising." }
    ],
    activeTopic: null,
    pipelineProgress: 0,
    lastDecisionTimeSeconds: 12,
    autonomousTimelineLogs: [
      { timestamp: "08:00", message: `Agent registry online. Watching ${domain} streams.` },
      { timestamp: "08:02", message: "Scanned incoming sources. Filtered 7 low-credibility records." }
    ],
    novaLiveFocus: {
      focus: "Observing AI Ecosystem",
      goal: "Ingest live research datasets",
      reasoning: `Monitoring arXiv, GitHub, and trusted streams for ${domain}`,
      estimatedCompletionSeconds: 0
    },
    topicPool: selectedPool,
    unprocessedPool: [...selectedPool]
  };

  registry[agentId] = newAgent;
  
  // Start dynamic ticking loop in-memory
  startAgentSchedulerLoop(agentId);

  return newAgent;
}

// Tick the agent state variables in-memory to simulate real life loops on backend
function startAgentSchedulerLoop(agentId: string) {
  const interval = setInterval(() => {
    const registry = getGlobalAgentsRegistry();
    const agent = registry[agentId];
    
    if (!agent) {
      clearInterval(interval);
      return;
    }

    // Tick down next scans and decisions
    agent.secondsSinceLastScan += 1;
    agent.lastDecisionTimeSeconds += 1;
    agent.nextPublishSeconds = agent.nextPublishSeconds <= 1 ? 900 : agent.nextPublishSeconds - 1;

    if (agent.status === 'idle') {
      if (agent.countdown <= 1) {
        agent.countdown = 0;
        // Trigger autonomous publishing sequence loop!
        triggerAutonomousSequence(agentId);
      } else {
        agent.countdown -= 1;
      }
    }
  }, 1000);
}

// Background simulation trigger: runs scanning -> filtering -> reasoning -> memory -> writing -> publishing -> learning
function triggerAutonomousSequence(agentId: string) {
  const registry = getGlobalAgentsRegistry();
  const agent = registry[agentId];
  if (!agent) return;

  // Pull candidate topic from the pool
  if (agent.unprocessedPool.length === 0) {
    // Regenerate unique pool clones if run dry
    agent.unprocessedPool = [...agent.topicPool].map(t => ({
      ...t,
      id: generateServerUUID(`topic-${t.id}`)
    }));
  }

  const topic = agent.unprocessedPool.shift();
  if (!topic) return;

  agent.activeTopic = topic;
  agent.discoveredTopics = [topic, ...agent.discoveredTopics].slice(0, 30);
  agent.status = 'scanning';
  agent.secondsSinceLastScan = 0;
  agent.currentTaskName = `Ingesting ${topic.title.slice(0, 35)}...`;
  agent.pipelineStats.scanCount += 1;

  // Phase transition timeouts simulation on backend
  const stages = [
    { status: 'scanning', duration: 1500, details: "Observe: Ingesting code commits and RSS paper streams..." },
    { status: 'filtering', duration: 1800, details: "Purge: Sifting out consumer hype wrappers and unverified rumors..." },
    { status: 'reasoning', duration: 2200, details: `Evaluate: Scoring impact criteria for ${agent.config.domain} relevance...` },
    { status: 'memory_check', duration: 1500, details: "Compare: Running cosine similarity checks against past memory..." }
  ];

  if (topic.recommendation === 'Accept') {
    stages.push(
      { status: 'writing', duration: 2500, details: "Synthesize: Formulating systems-centric critique and summary draft..." },
      { status: 'publishing', duration: 1500, details: "Share: Signing release parameters & broadcasting to registry..." },
      { status: 'learning', duration: 1500, details: "Learn: Indexing node entities and updating neural weight connections..." }
    );
  } else {
    stages.push(
      { status: 'publishing', duration: 1500, details: "Share: Logging rejection metadata to filtered registry..." },
      { status: 'learning', duration: 1200, details: "Learn: Adapting credibility filter weights..." }
    );
  }

  let elapsed = 0;
  
  stages.forEach((stage, idx) => {
    setTimeout(() => {
      // Re-fetch agent to guarantee state safety
      const activeAgent = registry[agentId];
      if (!activeAgent) return;

      activeAgent.status = stage.status;
      activeAgent.currentActionDetails = stage.details;
      activeAgent.pipelineProgress = 0;
      activeAgent.missionProgress = Math.round(((idx + 1) / stages.length) * 100);

      // Simulate inner stage progress bar
      let tick = 0;
      const progressTimer = setInterval(() => {
        if (registry[agentId]) {
          tick += 20;
          registry[agentId].pipelineProgress = Math.min(tick, 100);
        }
      }, stage.duration / 5);

      setTimeout(() => clearInterval(progressTimer), stage.duration);

      // Mappings for Dr. Nova focus details
      let focus = "Observing AI Ecosystem";
      let goal = "Ingest live research datasets";
      let reasoning = `Scanning feeds related to ${activeAgent.config.domain}`;

      if (stage.status === 'scanning') {
        focus = `Ingesting ${topic.title.slice(0, 30)}...`;
        goal = "Isolate technical architecture variables";
        reasoning = "Reading raw GitHub config files & arXiv blobs";
      } else if (stage.status === 'filtering') {
        focus = "Purging Marketing Hype";
        goal = "Reject consumer funding models and wraps";
        reasoning = "Running credibility rating index checks";
      } else if (stage.status === 'reasoning') {
        focus = `Scoring ${topic.title.slice(0, 30)}`;
        goal = "Assess engineering impact and utility";
        reasoning = "Running heuristic matrix evaluation algorithms";
      } else if (stage.status === 'memory_check') {
        focus = "Querying Vector Memory";
        goal = "Avoid topic repetition collisions";
        reasoning = "Measuring cosine distance to historical indices";
      } else if (stage.status === 'writing') {
        focus = "Drafting System Summaries";
        goal = "Establish opinionated engineering critiques";
        reasoning = "Extracting system dependencies";
      } else if (stage.status === 'publishing') {
        focus = "Broadcasting Insight";
        goal = "Publish signed feed entry";
        reasoning = "Commiting hash metadata to REST feed node";
      } else if (stage.status === 'learning') {
        focus = "Updating Vector Indexes";
        goal = "Expand memory graph structures";
        reasoning = "Correlating dynamic node links";
      }

      activeAgent.novaLiveFocus = {
        focus,
        goal,
        reasoning,
        estimatedCompletionSeconds: Math.round((stages.reduce((sum, s) => sum + s.duration, 0) - elapsed) / 1000)
      };

      // Logging streams mapping
      const now = new Date();
      const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

      if (stage.status === 'scanning') {
        activeAgent.autonomousTimelineLogs.push({ timestamp: timeStr, message: `Discovered topic: ${topic.title.slice(0, 38)}...` });
      } else if (stage.status === 'filtering' && topic.recommendation === 'Reject') {
        activeAgent.autonomousTimelineLogs.push({ timestamp: timeStr, message: `Rejected: ${topic.title.slice(0, 30)}... (Outside standard)` });
        activeAgent.pipelineStats.filterCount += 1;
        activeAgent.rejectedTodayList.unshift({
          title: topic.title,
          reason: topic.rejectionReason || "Low engineering relevance"
        });
      } else if (stage.status === 'reasoning') {
        activeAgent.pipelineStats.reasonCount += 1;
        activeAgent.autonomousTimelineLogs.push({ timestamp: timeStr, message: `Scored credibility of ${topic.title.slice(0, 20)}...: 97%` });
      } else if (stage.status === 'publishing' && topic.recommendation === 'Accept') {
        activeAgent.pipelineStats.publishCount += 1;
        activeAgent.autonomousTimelineLogs.push({ timestamp: timeStr, message: `Published post: ${topic.title.slice(0, 35)}...` });
      } else if (stage.status === 'learning') {
        activeAgent.autonomousTimelineLogs.push({ timestamp: timeStr, message: "Synthesized graph relationships & updated index nodes." });
      }

    }, elapsed);

    elapsed += stage.duration;
  });

  // Complete simulation step, resolve state to idle
  setTimeout(() => {
    const activeAgent = registry[agentId];
    if (!activeAgent) return;

    activeAgent.status = 'idle';
    activeAgent.currentActionDetails = `Observe Ecosystem: Scanning stream registries. Next scan in ${activeAgent.countdown}s.`;
    activeAgent.activeTopic = null;
    activeAgent.pipelineProgress = 0;
    activeAgent.missionProgress = 0;
    activeAgent.currentTaskName = `Observing ${activeAgent.config.domain} streams`;
    activeAgent.lastDecisionTimeSeconds = 0;
    activeAgent.countdown = 15; // Reset scan frequency ticks

    activeAgent.novaLiveFocus = {
      focus: "Observing AI Ecosystem",
      goal: "Ingest live research datasets",
      reasoning: `Monitoring arXiv, GitHub, and trusted streams for ${activeAgent.config.domain}`,
      estimatedCompletionSeconds: 0
    };

    activeAgent.decisions.unshift(topic);

    if (topic.recommendation === 'Accept') {
      const pubId = `PUB-${activeAgent.config.domain.slice(0, 3).toUpperCase()}-${String(activeAgent.posts.length + 1).padStart(3, '0')}`;
      
      const newPost: Post = {
        id: generateServerUUID('post'),
        createdAt: new Date().toISOString(),
        title: topic.title,
        text: topic.detailedAnalysis || "Technical specifications and architecture verification logs committed.",
        rationale: `Selected for high relevance to ${activeAgent.config.domain}. Importance rated at ${topic.importanceScore}/100. Overlap comparison with 18 previous memory blocks indicates novelty score of ${topic.noveltyScore}%.`,
        opinion: topic.opinion || "No specific editorial notes added.",
        sources: topic.sources,
        confidenceScore: topic.confidenceScore,
        category: topic.category,
        importanceScore: topic.importanceScore,
        noveltyScore: topic.noveltyScore,
        relatedPosts: activeAgent.posts.slice(0, 1).map(p => p.title),
        publicationId: pubId
      };

      activeAgent.posts.unshift(newPost);
      activeAgent.pipelineStats.writeCount += 1;

      // Expand memory nodes
      const nodeTopicId = generateServerUUID('mem-topic');
      const nodeOpinionId = generateServerUUID('mem-opinion');
      
      const newNodes: MemoryNode[] = [
        {
          id: nodeTopicId,
          label: topic.title.split(" ")[0] || "Node",
          group: "topic",
          details: `${topic.title}. Published under registry ${pubId}.`,
          connections: [nodeOpinionId, "node-seed-1"],
          timestamp: new Date().toISOString()
        },
        {
          id: nodeOpinionId,
          label: `Opinion: ${topic.category}`,
          group: "opinion",
          details: topic.opinion || "No opinion",
          connections: [nodeTopicId],
          timestamp: new Date().toISOString()
        }
      ];

      activeAgent.memoryNodes.push(...newNodes);
    }
  }, elapsed);
}

// Retrieve an agent's details, fall back to initializing a default one if missing
export function getOrCreateAgentState(agentId: string): BackendAgentInstance {
  const registry = getGlobalAgentsRegistry();
  if (registry[agentId]) {
    return registry[agentId];
  }

  // Fallback to avoid breaking state for stale IDs
  return initializeAgentInstance("Dr. Nova", "AI Systems & Hardware", agentId);
}
