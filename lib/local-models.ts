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
