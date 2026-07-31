// Client-side projection for the Deep Plan card — turns the planner's subtasks
// (capability + tier + model) into a per-plan usage/savings preview WITHOUT any
// model call. Mirrors vmx-engine's token-estimate + plan-usage weighting.

import { LOCAL_MODELS, capabilityQuality, type TaskCapability } from "./local-models";

type Tier = "trivial" | "standard" | "hard";

// How much of a subscription one token on this model consumes, relative to a mid
// model (1.0). Premium/frontier models (Fable 5, Sol 5.6) drain far more than
// efficient ones (Sonnet), even at equal token counts — so we weight usage, not
// raw tokens. Tunable estimates.
// Research-backed effective per-task weights (Sonnet/Terra = 1.0). Frontier
// "thinking" tiers (Sol, Fable) drain ~8–10× the standard model per task once
// their reasoning-token inflation is baked in; Opus ~3.5×; light models ≪ 1.
export const PLAN_USAGE_WEIGHT: Record<string, number> = {
  "claude-haiku": 0.33, "claude-sonnet": 1.0, "claude-sonnet-4-6": 0.9,
  "claude-opus": 3.5, "claude-opus-4-7": 3.3, "claude-opus-4-6": 3.2, "claude-opus-3": 4.5, "claude-fable": 8.0,
  "gpt-5.4-mini": 0.4, "gpt-5.6-luna": 0.1, "gpt-5.4": 2.5, "gpt-5.6-terra": 1.0, "gpt-5.5": 8.0, "gpt-5.6-sol": 10.0,
};
export const planUsageWeight = (id?: string): number => (id && PLAN_USAGE_WEIGHT[id]) || 1;

const TIER_BASE: Record<Tier, number> = { trivial: 2400, standard: 10500, hard: 31000 };
const CAP_SCALE: Partial<Record<TaskCapability, number>> = {
  frontend_design: 1.2, new_code: 1.1, architecture: 1.2, long_horizon: 1.4, debugging: 1.05,
  code_review: 1.0, research_search: 1.2, data_analysis: 1.05, documents: 1.05, media_generation: 0.4,
  vision: 1.0, fast_high_volume: 0.65, organization: 0.7, conversation: 0.65, creative_ideation: 0.9,
};
export function estimateTaskTokens(capability: TaskCapability | undefined, tier: string): number {
  const base = TIER_BASE[(tier as Tier)] ?? TIER_BASE.standard;
  return Math.round(base * (capability ? CAP_SCALE[capability] ?? 1 : 1));
}

export interface PlanProjection {
  tokens: number;
  byPlan: Record<string, { tasks: number; tokens: number; usage: number; provider: string }>;
  claudeUsage: number;
  codexUsage: number;
  usageSkew: number; // weighted share on the heavier plan (0.5 even … 1 all one)
  savingsRate: number; // vs. running everything on the heaviest model used
  modelsUsed: number;
}

// The frontier ALTERNATIVE for a capability: the single highest-quality model
// for it (the one you'd otherwise reach for), and its subscription weight. This
// is the honest baseline — "what this would have cost on the top model" — so a
// coherent build routed to a cheap model still shows its true savings, not 0%.
function frontierWeight(capability: TaskCapability | undefined): number {
  const cap = capability ?? "new_code";
  let bestId = "", bestQ = -1;
  for (const id of Object.keys(LOCAL_MODELS)) {
    const q = capabilityQuality(id, cap);
    if (q > bestQ) { bestQ = q; bestId = id; }
  }
  return planUsageWeight(bestId) || 1;
}

export function projectPlan(subtasks: { capability?: TaskCapability; tier: string; modelId?: string }[]): PlanProjection {
  const byPlan: PlanProjection["byPlan"] = {};
  let tokens = 0, routedUsage = 0, baseline = 0;
  const models = new Set<string>();
  const perEngine: Record<string, number> = { claude: 0, codex: 0 };
  for (const s of subtasks) {
    const m = s.modelId ? LOCAL_MODELS[s.modelId] : undefined;
    const tok = estimateTaskTokens(s.capability, s.tier);
    const w = planUsageWeight(s.modelId);
    const usage = tok * w;
    tokens += tok;
    routedUsage += usage;
    // Baseline = this same work on the frontier model for its capability.
    baseline += tok * Math.max(w, frontierWeight(s.capability));
    if (s.modelId) models.add(s.modelId);
    const plan = m?.plan ?? "Unknown";
    const provider = m?.engine ?? "";
    const b = (byPlan[plan] ??= { tasks: 0, tokens: 0, usage: 0, provider });
    b.tasks += 1; b.tokens += tok; b.usage += Math.round(usage);
    if (provider) perEngine[provider] = (perEngine[provider] ?? 0) + usage;
  }
  const totalUsage = perEngine.claude + perEngine.codex || 1;
  return {
    tokens,
    byPlan,
    claudeUsage: Math.round(perEngine.claude),
    codexUsage: Math.round(perEngine.codex),
    usageSkew: Math.max(perEngine.claude, perEngine.codex) / totalUsage,
    savingsRate: baseline > 0 ? Math.max(0, 1 - routedUsage / baseline) : 0,
    modelsUsed: models.size,
  };
}
