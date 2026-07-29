// The router: given the conversation, decide which model should handle this
// turn. This runs LOCALLY and for FREE — no extra model call — so the routing
// decision itself never costs the user tokens. It's a heuristic classifier;
// the goal is "good enough to pick the right tier", not perfection.

import { MODELS, ModelSpec, Provider, Tier, modelsForProviders } from "./models";

export interface RouteDecision {
  tier: Tier;
  model: ModelSpec;
  reason: string; // human-readable "why this model"
  signals: string[]; // the phrases/features that drove the decision
}

const IMAGE_HINTS = [
  "generate an image",
  "make an image",
  "create an image",
  "draw ",
  "a picture of",
  "an illustration of",
  "logo for",
  "render an image",
  "image of",
  "photo of",
];

const HARD_HINTS = [
  "architecture",
  "architect",
  "design a system",
  "refactor",
  "debug",
  "why doesn't",
  "why isn't",
  "race condition",
  "concurrency",
  "algorithm",
  "optimize",
  "prove",
  "complexity",
  "distributed",
  "security review",
  "root cause",
  "trade-off",
  "tradeoff",
];

const TRIVIAL_HINTS = [
  "rename",
  "typo",
  "fix the spelling",
  "what is",
  "what's the",
  "how do i spell",
  "capitalize",
  "format this",
  "add a comment",
  "one-liner",
  "quick question",
];

function has(text: string, needles: string[]): string[] {
  const hits: string[] = [];
  for (const n of needles) if (text.includes(n)) hits.push(n.trim());
  return hits;
}

// Pick the best available model that owns a given tier, preferring the
// registry's tier assignment, then falling back to nearby tiers.
function pickForTier(tier: Tier, available: Provider[]): ModelSpec | null {
  const pool = modelsForProviders(available);
  const inTier = pool.filter((m) => m.tier === tier);
  if (inTier.length) {
    // Prefer the cheaper option within a tier for trivial/standard,
    // the strongest (priciest ~ most capable) for hard.
    if (tier === "hard") return inTier.sort((a, b) => b.priceOut - a.priceOut)[0];
    return inTier.sort((a, b) => a.priceOut - b.priceOut)[0];
  }
  // Fallbacks: degrade gracefully if the ideal tier's provider isn't connected.
  const order: Tier[] = ["trivial", "standard", "hard"];
  const idx = order.indexOf(tier === "image" ? "standard" : tier);
  for (let d = 1; d < order.length; d++) {
    for (const cand of [order[idx - d], order[idx + d]]) {
      if (!cand) continue;
      const alt = pool.filter((m) => m.tier === cand);
      if (alt.length) return alt.sort((a, b) => a.priceOut - b.priceOut)[0];
    }
  }
  return pool[0] ?? null;
}

export function classifyTier(prompt: string): {
  tier: Tier;
  signals: string[];
} {
  const text = prompt.toLowerCase();
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  const hasCode = /```|\bfunction\b|=>|\bclass\b|\bdef\b|\bimport\b|;\s*$/m.test(prompt);

  const imageHits = has(text, IMAGE_HINTS);
  if (imageHits.length) return { tier: "image", signals: imageHits };

  const hardHits = has(text, HARD_HINTS);
  const trivialHits = has(text, TRIVIAL_HINTS);

  // Score: start neutral (standard), push toward hard/trivial by signals.
  let score = 0;
  score += hardHits.length * 2;
  score -= trivialHits.length * 2;
  if (words > 120) score += 2; // long, detailed asks tend to be harder
  if (words < 12 && !hasCode) score -= 1; // short one-offs skew trivial
  if (hasCode && words > 60) score += 1; // lots of code + prose = involved

  const signals = [
    ...hardHits.map((h) => `hard:"${h}"`),
    ...trivialHits.map((h) => `trivial:"${h}"`),
    words > 120 ? "long prompt" : words < 12 ? "short prompt" : "",
    hasCode ? "contains code" : "",
  ].filter(Boolean);

  let tier: Tier;
  if (score >= 3) tier = "hard";
  else if (score <= -2) tier = "trivial";
  else tier = "standard";

  return { tier, signals };
}

export function route(prompt: string, available: Provider[], override?: string): RouteDecision {
  // Manual override: user forced a specific model in the dropdown.
  if (override && override !== "auto" && MODELS[override]) {
    const model = MODELS[override];
    return {
      tier: model.tier,
      model,
      reason: `You picked ${model.label} manually.`,
      signals: ["manual override"],
    };
  }

  const { tier, signals } = classifyTier(prompt);
  const model = pickForTier(tier, available);

  if (!model) {
    throw new Error("No connected provider can handle this request. Add an API key in Settings.");
  }

  const tierReason: Record<Tier, string> = {
    trivial: "This looks lightweight, so a fast/cheap model is enough — no need to burn a premium model on it.",
    standard: "A balanced everyday task — routed to a strong, well-priced workhorse.",
    hard: "This looks genuinely hard, so it's worth the top-tier reasoning model.",
    image: "This needs image generation, which only an image model can do.",
  };

  return {
    tier,
    model,
    reason: `${tierReason[tier]} → ${model.label}. ${model.blurb}`,
    signals,
  };
}
