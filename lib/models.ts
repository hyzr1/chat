// Central model registry. Prices are USD per 1M tokens and are ESTIMATES —
// treat them as configurable defaults, not billing truth. Update freely.

export type Provider = "anthropic" | "openai";
export type Capability = "text" | "code" | "image";
export type Tier = "trivial" | "standard" | "hard" | "image";

export interface ModelSpec {
  id: string; // API model id
  label: string; // shown in UI
  provider: Provider;
  tier: Tier; // the difficulty bucket this model owns by default
  priceIn: number; // $ per 1M input tokens
  priceOut: number; // $ per 1M output tokens
  capabilities: Capability[];
  blurb: string; // what it's best at (shown in the router explanation)
}

export const MODELS: Record<string, ModelSpec> = {
  "claude-haiku-4-5-20251001": {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    provider: "anthropic",
    tier: "trivial",
    priceIn: 1,
    priceOut: 5,
    capabilities: ["text", "code"],
    blurb: "Fast + cheap. Great for small edits, renames, Q&A, boilerplate.",
  },
  "gpt-4o-mini": {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    provider: "openai",
    tier: "trivial",
    priceIn: 0.15,
    priceOut: 0.6,
    capabilities: ["text", "code"],
    blurb: "Cheapest general model. Good for trivial, high-volume subtasks.",
  },
  "claude-sonnet-5": {
    id: "claude-sonnet-5",
    label: "Claude Sonnet 5",
    provider: "anthropic",
    tier: "standard",
    priceIn: 3,
    priceOut: 15,
    capabilities: ["text", "code"],
    blurb: "The everyday workhorse for coding — strong, coherent, well-priced.",
  },
  "gpt-4o": {
    id: "gpt-4o",
    label: "GPT-4o",
    provider: "openai",
    tier: "standard",
    priceIn: 2.5,
    priceOut: 10,
    capabilities: ["text", "code"],
    blurb: "Solid all-rounder, strong general reasoning and tool use.",
  },
  "claude-opus-4-8": {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    provider: "anthropic",
    tier: "hard",
    priceIn: 15,
    priceOut: 75,
    capabilities: ["text", "code"],
    blurb: "Top-tier reasoning. Architecture, gnarly debugging, hard algorithms.",
  },
  "gpt-image-1": {
    id: "gpt-image-1",
    label: "GPT Image 1",
    provider: "openai",
    tier: "image",
    priceIn: 0,
    priceOut: 0,
    capabilities: ["image"],
    blurb: "Image generation — the thing Claude can't do.",
  },
};

// The "baseline" model we compare cost against: what you'd pay if you always
// reached for the strongest text model. Savings = baseline - routed.
export const BASELINE_MODEL_ID = "claude-opus-4-8";

export function modelsForProviders(available: Provider[]): ModelSpec[] {
  return Object.values(MODELS).filter((m) => available.includes(m.provider));
}

// Rough cost of a turn given token counts.
export function estimateCost(modelId: string, inTok: number, outTok: number): number {
  const m = MODELS[modelId];
  if (!m) return 0;
  return (inTok / 1e6) * m.priceIn + (outTok / 1e6) * m.priceOut;
}
