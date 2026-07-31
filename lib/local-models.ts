// LOCAL mode: Hyzr Chat drives the official CLIs already logged into your subscriptions:
//   - `claude` -> your Claude Max plan
//   - `codex`  -> your ChatGPT Pro plan
//
// The ChatGPT model ids below are the REAL Codex slugs (from ~/.codex/models_cache.json):
// gpt-5.6-sol / terra / luna, gpt-5.5, gpt-5.4, gpt-5.4-mini.

export type Engine = "claude" | "codex";
export type Tier = "trivial" | "standard" | "hard";
export type Effort = "low" | "medium" | "high" | "xhigh" | "max" | "ultra";
export type TaskCapability =
  | "frontend_design" | "new_code" | "debugging" | "code_review" | "architecture"
  | "long_horizon" | "research_search" | "computer_use" | "vision" | "media_generation"
  | "data_analysis" | "documents" | "organization" | "conversation" | "creative_ideation"
  | "cybersecurity" | "science" | "fast_high_volume";

export const CAPABILITY_LABELS: Record<TaskCapability, string> = {
  frontend_design: "Frontend & visual design", new_code: "Implementation", debugging: "Debugging",
  code_review: "Code review", architecture: "Architecture", long_horizon: "Long-running work",
  research_search: "Research & web search", computer_use: "Computer use", vision: "Image understanding",
  media_generation: "Image & video generation", data_analysis: "Data analysis", documents: "Documents & presentations",
  organization: "Planning & organization", conversation: "Conversation & tone", creative_ideation: "Ideas & creative writing",
  cybersecurity: "Cybersecurity", science: "Science & health", fast_high_volume: "Fast, high-volume work",
};

export interface CapabilityProfile {
  strengths: TaskCapability[];
  bestFor: string;
  caution?: string;
}

export interface LocalModel {
  id: string; // UI / override key
  label: string;
  engine: Engine;
  model: string; // exact id passed to the CLI
  tier: Tier;
  plan: string;
  blurb: string;
}

export const LOCAL_MODELS: Record<string, LocalModel> = {
  // ---- ChatGPT (Codex) — real slugs ----
  "gpt-5.6-sol": {
    id: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    engine: "codex",
    model: "gpt-5.6-sol",
    tier: "hard",
    plan: "ChatGPT Pro",
    blurb: "Frontier coding, polished frontend design, terminal work, search and computer use.",
  },
  "gpt-5.6-terra": {
    id: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    engine: "codex",
    model: "gpt-5.6-terra",
    tier: "standard",
    plan: "ChatGPT Pro",
    blurb: "Balanced implementation and frontend quality for everyday production work.",
  },
  "gpt-5.6-luna": {
    id: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    engine: "codex",
    model: "gpt-5.6-luna",
    tier: "trivial",
    plan: "ChatGPT Pro",
    blurb: "Fast, efficient coding, transformations and high-volume work.",
  },
  "gpt-5.5": {
    id: "gpt-5.5",
    label: "GPT-5.5",
    engine: "codex",
    model: "gpt-5.5",
    tier: "hard",
    plan: "ChatGPT Pro",
    blurb: "Complex coding, professional research and analytical deliverables.",
  },
  "gpt-5.4": {
    id: "gpt-5.4",
    label: "GPT-5.4",
    engine: "codex",
    model: "gpt-5.4",
    tier: "standard",
    plan: "ChatGPT Pro",
    blurb: "General coding, tools, documents and professional knowledge work.",
  },
  "gpt-5.4-mini": {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 Mini",
    engine: "codex",
    model: "gpt-5.4-mini",
    tier: "trivial",
    plan: "ChatGPT Pro",
    blurb: "Fast intent classification, routing, summarization and scoped transformations.",
  },

  // ---- Claude (Claude Max) ----
  "claude-opus": {
    id: "claude-opus",
    label: "Claude Opus 4.8",
    engine: "claude",
    model: "claude-opus-4-8",
    tier: "hard",
    plan: "Claude Max",
    blurb: "Long-context architecture, careful review and nuanced human-facing work.",
  },
  "claude-fable": {
    id: "claude-fable",
    label: "Claude Fable 5",
    engine: "claude",
    model: "claude-fable-5",
    tier: "hard",
    plan: "Claude Max",
    blurb: "Brownfield debugging, code review, ambiguity, vision and long autonomous work.",
  },
  "claude-sonnet": {
    id: "claude-sonnet",
    label: "Claude Sonnet 5",
    engine: "claude",
    model: "claude-sonnet-5",
    tier: "standard",
    plan: "Claude Max",
    blurb: "Efficient sustained coding, debugging, automation and computer use.",
  },
  "claude-haiku": {
    id: "claude-haiku",
    label: "Claude Haiku 4.5",
    engine: "claude",
    model: "claude-haiku-4-5-20251001",
    tier: "trivial",
    plan: "Claude Max",
    blurb: "Fast classification, short answers, mechanical edits and high-volume tasks.",
  },
  "claude-opus-4-7": {
    id: "claude-opus-4-7", label: "Claude Opus 4.7", engine: "claude", model: "claude-opus-4-7",
    tier: "hard", plan: "Claude Max", blurb: "Previous-generation Opus for compatibility and comparison.",
  },
  "claude-opus-4-6": {
    id: "claude-opus-4-6", label: "Claude Opus 4.6", engine: "claude", model: "claude-opus-4-6",
    tier: "hard", plan: "Claude Max", blurb: "Earlier Opus model for established workflows.",
  },
  "claude-opus-3": {
    id: "claude-opus-3", label: "Claude Opus 3", engine: "claude", model: "claude-3-opus",
    tier: "hard", plan: "Claude Max", blurb: "Legacy Opus model when older behavior is required.",
  },
  "claude-sonnet-4-6": {
    id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", engine: "claude", model: "claude-sonnet-4-6",
    tier: "standard", plan: "Claude Max", blurb: "Previous Sonnet generation for compatibility.",
  },
};

// Capability evidence is deliberately separate from price/difficulty. The planner
// sees these workload-specific profiles and chooses by fit first, then effort.
export const MODEL_CAPABILITIES: Record<string, CapabilityProfile> = {
  "gpt-5.6-sol": { strengths: ["frontend_design", "new_code", "architecture", "research_search", "computer_use", "data_analysis", "documents", "cybersecurity", "science", "media_generation"], bestFor: "Polished frontend work, new implementations, terminal workflows, deep search, computer use, professional deliverables, cyber and science." },
  "gpt-5.6-terra": { strengths: ["frontend_design", "new_code", "research_search", "computer_use", "documents", "organization", "fast_high_volume"], bestFor: "High-quality everyday implementation and design with strong speed and cost efficiency." },
  "gpt-5.6-luna": { strengths: ["new_code", "organization", "research_search", "fast_high_volume"], bestFor: "Fast, high-volume implementation, transformations, classification and routine project work." },
  "gpt-5.5": { strengths: ["new_code", "architecture", "research_search", "data_analysis", "documents"], bestFor: "Complex coding and professional research where established GPT-5.5 behavior is useful." },
  "gpt-5.4": { strengths: ["new_code", "research_search", "computer_use", "data_analysis", "documents", "organization"], bestFor: "General professional work, tools, documents and dependable everyday coding." },
  "gpt-5.4-mini": { strengths: ["organization", "fast_high_volume"], bestFor: "Fast intent classification, routing, summarization and tightly scoped mechanical work." },
  "claude-fable": { strengths: ["debugging", "code_review", "architecture", "long_horizon", "vision", "documents", "organization", "conversation", "creative_ideation", "new_code"], bestFor: "Hard brownfield debugging, code review, ambiguous multi-part work, dense screenshots, long autonomous runs and nuanced writing.", caution: "Use GPT-5.6 for offensive security or life-science tasks where Fable classifiers may refuse." },
  "claude-opus": { strengths: ["architecture", "long_horizon", "vision", "conversation", "creative_ideation", "code_review", "documents"], bestFor: "Deep architecture, long-context reasoning, careful review and rich human-facing writing." },
  "claude-sonnet": { strengths: ["new_code", "debugging", "code_review", "long_horizon", "research_search", "computer_use", "organization"], bestFor: "Efficient multi-step software engineering, brownfield bugs, automation and sustained tool use." },
  "claude-haiku": { strengths: ["fast_high_volume", "organization", "conversation"], bestFor: "Fast classification, short answers, mechanical edits and latency-sensitive work." },
  "claude-opus-4-7": { strengths: ["architecture", "long_horizon", "code_review", "creative_ideation"], bestFor: "Autonomous coding and creative reasoning with previous-generation Opus behavior." },
  "claude-opus-4-6": { strengths: ["architecture", "debugging", "code_review", "long_horizon"], bestFor: "Agentic coding, multidisciplinary reasoning and established long-running workflows." },
  "claude-opus-3": { strengths: ["conversation", "creative_ideation", "documents"], bestFor: "Legacy writing and compatibility-sensitive conversations." },
  "claude-sonnet-4-6": { strengths: ["new_code", "debugging", "computer_use", "long_horizon", "vision"], bestFor: "Coding, computer use, long-context reasoning and design on the prior Sonnet generation." },
};

export function capabilityProfile(id: string): CapabilityProfile {
  return MODEL_CAPABILITIES[id] ?? { strengths: ["new_code"], bestFor: "General-purpose work." };
}

// ── Subscription usage weight ────────────────────────────────────────────────
// How much of a plan's quota one token on this model consumes, relative to a mid
// model (1.0). Premium/frontier models (Fable, Sol) drain far more than cheap
// ones (Sonnet, Luna) even at equal token counts. Quality-aware routing uses
// this — not raw token count — to break ties toward the least subscription drain.
export const PLAN_USAGE_WEIGHT: Record<string, number> = {
  "claude-haiku": 0.33, "claude-sonnet": 1.0, "claude-sonnet-4-6": 0.9,
  "claude-opus": 3.5, "claude-opus-4-7": 3.3, "claude-opus-4-6": 3.2, "claude-opus-3": 4.5, "claude-fable": 12.0,
  "gpt-5.4-mini": 0.4, "gpt-5.6-luna": 0.1, "gpt-5.4": 2.5, "gpt-5.6-terra": 1.0, "gpt-5.5": 7.0, "gpt-5.6-sol": 8.0,
};
export function planUsageWeight(id: string): number { return PLAN_USAGE_WEIGHT[id] ?? 1; }

// Output-weighted API price weight (coding output tokens dominate). Lower =
// cheaper. Used only as a final tiebreak in routing. Unknown sorts last.
export const LOCAL_MODEL_PRICING: Record<string, { in: number; out: number }> = {
  "claude-haiku": { in: 1, out: 5 }, "claude-sonnet": { in: 3, out: 15 }, "claude-opus": { in: 5, out: 25 },
  "claude-fable": { in: 10, out: 50 }, "claude-opus-4-7": { in: 5, out: 25 }, "claude-opus-4-6": { in: 5, out: 25 },
  "claude-opus-3": { in: 15, out: 75 }, "claude-sonnet-4-6": { in: 3, out: 15 },
  "gpt-5.6-sol": { in: 5, out: 20 }, "gpt-5.5": { in: 5, out: 20 }, "gpt-5.6-terra": { in: 2, out: 8 },
  "gpt-5.4": { in: 1.5, out: 6 }, "gpt-5.6-luna": { in: 0.5, out: 2 }, "gpt-5.4-mini": { in: 0.2, out: 0.8 },
};
export function modelCostWeight(id: string): number {
  const p = LOCAL_MODEL_PRICING[id];
  return p ? p.in * 0.25 + p.out * 0.75 : Number.POSITIVE_INFINITY;
}

// ── Capability × model QUALITY matrix ───────────────────────────────────────
// Scores HOW GOOD each model is at each capability, 0–10 (not just can-it). The
// router routes to the model that clears a per-subtask quality bar at the lowest
// plan usage — premium models kept where they earn their cost (design, hard
// algorithms, debugging), never wasted on commodity work (plain CRUD, edits).
export const MODEL_BASE_QUALITY: Record<string, number> = {
  "claude-fable": 9.6, "claude-opus": 9.2, "claude-opus-4-7": 8.9, "claude-opus-4-6": 8.7,
  "claude-sonnet": 8.5, "claude-sonnet-4-6": 8.2, "claude-opus-3": 7.8, "claude-haiku": 7.0,
  "gpt-5.6-sol": 9.6, "gpt-5.5": 9.0, "gpt-5.6-terra": 8.6, "gpt-5.4": 8.0,
  "gpt-5.6-luna": 7.4, "gpt-5.4-mini": 6.6,
};

export const CAPABILITY_QUALITY_ADJUST: Partial<Record<TaskCapability, Record<string, number>>> = {
  frontend_design: { "claude-fable": 0.4, "claude-opus": 0.3, "claude-sonnet": 0.2, "gpt-5.6-sol": -0.2, "gpt-5.6-terra": -0.1, "gpt-5.6-luna": -0.5, "claude-haiku": -0.6, "gpt-5.4-mini": -1.8 },
  architecture: { "gpt-5.6-sol": 0.4, "claude-opus": 0.4, "claude-fable": 0.3, "gpt-5.5": 0.3, "claude-sonnet": -0.2, "gpt-5.6-luna": -0.8, "claude-haiku": -1.4, "gpt-5.4-mini": -1.8 },
  debugging: { "claude-fable": 0.4, "claude-sonnet": 0.3, "gpt-5.6-sol": 0.2, "claude-haiku": 0.0, "gpt-5.4-mini": -1.2 },
  code_review: { "claude-fable": 0.4, "claude-opus": 0.3, "claude-sonnet": 0.2, "gpt-5.6-sol": 0.1, "gpt-5.4-mini": -1.0 },
  long_horizon: { "claude-fable": 0.4, "gpt-5.6-sol": 0.3, "claude-opus": 0.3, "claude-sonnet": 0.2, "gpt-5.6-luna": -0.5, "gpt-5.4-mini": -2.0 },
  science: { "gpt-5.6-sol": 0.5, "gpt-5.5": 0.4, "gpt-5.4": 0.2, "claude-fable": 0.2, "gpt-5.6-luna": -0.6, "gpt-5.4-mini": -1.5, "claude-haiku": -1.0 },
  data_analysis: { "gpt-5.6-sol": 0.4, "gpt-5.5": 0.4, "gpt-5.4": 0.3, "gpt-5.6-luna": 0.1, "claude-haiku": -0.8, "gpt-5.4-mini": -1.2 },
  cybersecurity: { "gpt-5.6-sol": 0.4, "gpt-5.6-terra": 0.3, "gpt-5.5": 0.3, "claude-fable": -0.3, "claude-opus": -0.3, "claude-sonnet": -0.3, "claude-haiku": -0.5 },
  vision: { "claude-fable": 0.3, "claude-opus": 0.3, "claude-sonnet": 0.2, "gpt-5.6-sol": 0.2, "gpt-5.4-mini": -1.0 },
  creative_ideation: { "claude-fable": 0.4, "claude-opus": 0.4, "claude-opus-3": 0.3, "claude-sonnet": 0.2, "claude-haiku": 0.1, "gpt-5.4-mini": -1.0 },
  conversation: { "claude-fable": 0.4, "claude-opus": 0.4, "claude-sonnet": 0.2, "claude-haiku": 0.2, "gpt-5.4-mini": -0.6 },
  new_code: { "gpt-5.6-terra": 0.6, "gpt-5.6-luna": 0.8, "claude-sonnet": 0.6, "gpt-5.4": 0.5, "gpt-5.6-sol": -0.2, "claude-fable": -0.3, "claude-opus": -0.2, "gpt-5.4-mini": -0.4 },
  fast_high_volume: { "gpt-5.6-luna": 1.0, "gpt-5.4-mini": 0.9, "claude-haiku": 0.9, "gpt-5.6-terra": 0.3, "gpt-5.6-sol": -0.6, "claude-fable": -0.8, "claude-opus": -0.7 },
  organization: { "gpt-5.4-mini": 0.6, "gpt-5.6-luna": 0.5, "gpt-5.6-terra": 0.4, "claude-haiku": 0.4, "gpt-5.6-sol": -0.4, "claude-fable": -0.4 },
  documents: { "gpt-5.6-terra": 0.3, "gpt-5.6-luna": 0.3, "gpt-5.6-sol": 0.2, "claude-fable": 0.2, "gpt-5.4-mini": -0.8 },
  research_search: { "gpt-5.6-sol": 0.3, "gpt-5.6-terra": 0.3, "gpt-5.6-luna": 0.3, "gpt-5.5": 0.2, "gpt-5.4-mini": -0.6 },
  computer_use: { "gpt-5.6-sol": 0.3, "claude-sonnet": 0.3, "gpt-5.6-terra": 0.2, "gpt-5.4-mini": 0.1, "claude-fable": -0.2 },
  media_generation: { "gpt-5.6-luna": 0.8, "gpt-5.6-terra": 0.8, "gpt-5.6-sol": 0.6, "gpt-5.5": 0.4, "gpt-5.4": 0.2, "gpt-5.4-mini": -1.5 },
};

export function capabilityQuality(id: string, capability: TaskCapability): number {
  const model = LOCAL_MODELS[id];
  if (!model) return 0;
  if (capability === "media_generation" && model.engine === "claude") return 0;
  const base = MODEL_BASE_QUALITY[id] ?? 6.0;
  const adj = CAPABILITY_QUALITY_ADJUST[capability]?.[id] ?? 0;
  return Math.max(0, Math.min(10, base + adj));
}

// ── Fine-grained SKILL affinity ─────────────────────────────────────────────
// Skills detected from the prompt refine the broad capability score toward the
// model genuinely best at that specific skill (C++→Sol, CSS→Fable, CLI→Luna).
export type Skill =
  | "cpp" | "rust" | "go" | "python" | "typescript" | "csharp" | "java" | "sql"
  | "css" | "animation" | "graphics" | "api_backend" | "cli" | "image_gen"
  | "video_gen" | "regex" | "testing_debug" | "data_ml" | "systems_perf";

export const SKILL_LABELS: Record<Skill, string> = {
  cpp: "C/C++", rust: "Rust", go: "Go", python: "Python", typescript: "TypeScript/JS",
  csharp: "C#/.NET", java: "Java/JVM", sql: "SQL/databases", css: "CSS/styling",
  animation: "Animation & motion", graphics: "Graphics/WebGL/shaders", api_backend: "APIs & backend",
  cli: "Command line & scripting", image_gen: "Image generation", video_gen: "Video generation",
  regex: "Regex", testing_debug: "Testing & debugging", data_ml: "Data & ML", systems_perf: "Systems & performance",
};

export const SKILL_AFFINITY: Partial<Record<Skill, Record<string, number>>> = {
  cpp: { "gpt-5.6-sol": 0.7, "gpt-5.5": 0.6, "gpt-5.6-terra": 0.3, "claude-fable": 0.2, "claude-sonnet": -0.2, "claude-haiku": -0.6, "gpt-5.4-mini": -0.8 },
  rust: { "gpt-5.6-sol": 0.6, "gpt-5.5": 0.5, "claude-fable": 0.3, "gpt-5.6-terra": 0.2, "claude-haiku": -0.5 },
  go: { "gpt-5.6-sol": 0.4, "gpt-5.6-terra": 0.3, "claude-sonnet": 0.2, "claude-fable": 0.2 },
  python: { "gpt-5.6-sol": 0.4, "claude-fable": 0.3, "gpt-5.5": 0.3, "claude-sonnet": 0.2, "gpt-5.6-terra": 0.2 },
  typescript: { "claude-fable": 0.4, "claude-sonnet": 0.4, "gpt-5.6-sol": 0.2, "gpt-5.6-terra": 0.2, "claude-opus": 0.2 },
  csharp: { "gpt-5.6-sol": 0.4, "gpt-5.5": 0.3, "gpt-5.6-terra": 0.2, "claude-fable": 0.1 },
  java: { "gpt-5.6-sol": 0.4, "gpt-5.5": 0.3, "claude-fable": 0.2, "gpt-5.6-terra": 0.2 },
  sql: { "gpt-5.6-sol": 0.3, "gpt-5.6-terra": 0.2, "gpt-5.4": 0.2, "claude-sonnet": 0.1 },
  css: { "claude-fable": 0.5, "claude-opus": 0.4, "claude-sonnet": 0.3, "gpt-5.6-sol": 0.2, "gpt-5.6-terra": 0.1, "gpt-5.6-luna": -0.2, "gpt-5.4-mini": -0.6 },
  animation: { "claude-fable": 0.4, "gpt-5.6-sol": 0.3, "claude-opus": 0.3, "gpt-5.6-terra": 0.2, "claude-sonnet": 0.2, "gpt-5.4-mini": -0.5 },
  graphics: { "gpt-5.6-sol": 0.5, "gpt-5.5": 0.4, "claude-fable": 0.3, "gpt-5.6-terra": 0.2, "claude-haiku": -0.6 },
  api_backend: { "gpt-5.6-sol": 0.3, "gpt-5.6-terra": 0.3, "gpt-5.6-luna": 0.3, "claude-sonnet": 0.2, "gpt-5.4": 0.2 },
  cli: { "gpt-5.6-luna": 0.5, "gpt-5.4-mini": 0.5, "claude-haiku": 0.4, "gpt-5.6-terra": 0.3, "gpt-5.6-sol": -0.2, "claude-fable": -0.4 },
  image_gen: { "gpt-5.6-luna": 0.7, "gpt-5.6-terra": 0.6, "gpt-5.6-sol": 0.5, "gpt-5.5": 0.4, "gpt-5.4": 0.2 },
  video_gen: { "gpt-5.6-sol": 0.5, "gpt-5.6-terra": 0.5, "gpt-5.6-luna": 0.4, "gpt-5.5": 0.3 },
  regex: { "gpt-5.6-sol": 0.3, "claude-sonnet": 0.3, "gpt-5.6-terra": 0.2, "claude-fable": 0.2 },
  testing_debug: { "claude-fable": 0.5, "claude-sonnet": 0.4, "gpt-5.6-sol": 0.2, "claude-haiku": 0.1, "gpt-5.4-mini": -0.8 },
  data_ml: { "gpt-5.6-sol": 0.5, "gpt-5.5": 0.4, "gpt-5.4": 0.3, "gpt-5.6-luna": 0.1, "gpt-5.4-mini": -0.6 },
  systems_perf: { "gpt-5.6-sol": 0.5, "gpt-5.5": 0.4, "claude-fable": 0.3, "gpt-5.6-terra": 0.2, "gpt-5.4-mini": -1.0 },
};

export function skillQuality(id: string, capability: TaskCapability, skills?: Skill[]): number {
  const model = LOCAL_MODELS[id];
  if (!model) return 0;
  if (skills?.some((s) => s === "image_gen" || s === "video_gen") && model.engine === "claude") return 0;
  const base = capabilityQuality(id, capability);
  if (!skills?.length) return base;
  const deltas = skills.map((s) => SKILL_AFFINITY[s]?.[id] ?? 0);
  const skillAdj = deltas.reduce((a, b) => a + b, 0) / deltas.length;
  return Math.max(0, Math.min(10, base + skillAdj));
}

const COMMON_EFFORTS: Effort[] = ["low", "medium", "high", "xhigh"];
export function supportedEfforts(model: LocalModel): Effort[] {
  if (model.engine === "claude") return [...COMMON_EFFORTS, "max"];
  if (["gpt-5.6-sol", "gpt-5.6-terra"].includes(model.id)) return [...COMMON_EFFORTS, "max", "ultra"];
  if (model.id === "gpt-5.6-luna") return [...COMMON_EFFORTS, "max"];
  return COMMON_EFFORTS;
}

export function normalizeEffort(model: LocalModel, requested?: string): Effort {
  const allowed = supportedEfforts(model);
  const desired = (requested || "high") as Effort;
  if (allowed.includes(desired)) return desired;
  const order: Effort[] = ["low", "medium", "high", "xhigh", "max", "ultra"];
  const target = Math.max(0, order.indexOf(desired));
  return [...allowed].reverse().find((effort) => order.indexOf(effort) <= target) ?? allowed[0];
}

// Default per tier — spread across BOTH plans so neither quota drains first.
// Trivial stays on cheap Claude (spares your ChatGPT frontier quota); everyday
// work goes to ChatGPT Terra; the hard tier gets ChatGPT Sol.
export const LOCAL_TIER_DEFAULT: Record<Tier, string> = {
  trivial: "claude-haiku",
  standard: "gpt-5.6-terra",
  hard: "gpt-5.6-sol",
};
