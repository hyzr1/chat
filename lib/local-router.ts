// Fast deterministic fallback used when the model planner is disabled. Unlike
// the old difficulty ladder, this identifies the workload and ranks models by
// task-specific strengths. The model planner remains the richer default.

import { CAPABILITY_LABELS, LOCAL_MODELS, LOCAL_TIER_DEFAULT, capabilityProfile, type LocalModel, type TaskCapability, type Tier } from "./local-models";
import { rankModelsFromSamples, type RoutingFeedbackSample } from "./routing-feedback";
import { productEnv } from "./product";

export interface LocalRouteDecision {
  model: LocalModel;
  tier: Tier;
  capability: TaskCapability;
  reason: string;
  signals: string[];
  routingTrace?: RoutingDecisionTrace;
}

export interface RoutingRule { primary: string[]; fallbacks: string[]; }
export type RoutingRules = Partial<Record<TaskCapability, RoutingRule>>;
export type ProviderPreference = "auto" | "claude" | "codex";
export interface RoutingDecisionTrace {
  selectedModelId: string;
  defaultModelId: string;
  capability: TaskCapability;
  tier: Tier;
  providerPreference: ProviderPreference;
  source: "default" | "adaptive" | "custom" | "provider" | "fallback";
  adapted: boolean;
  sampleCount: number;
  reason: string;
  candidates: Array<{ modelId: string; attempts: number; successRate: number | null; averageTokens: number | null; score: number | null }>;
}
export const DEFAULT_CAPABILITY_ORDER: Record<TaskCapability, string[]> = {
  frontend_design: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "claude-sonnet", "claude-fable"],
  new_code: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "claude-sonnet", "claude-fable"],
  debugging: ["claude-haiku", "claude-sonnet", "claude-fable", "gpt-5.6-terra", "gpt-5.6-sol"],
  code_review: ["claude-haiku", "claude-sonnet", "claude-fable", "gpt-5.6-terra", "claude-opus"],
  architecture: ["gpt-5.4-mini", "gpt-5.6-terra", "claude-fable", "gpt-5.6-sol", "claude-opus"],
  long_horizon: ["claude-haiku", "claude-sonnet", "claude-fable", "gpt-5.6-sol", "claude-opus"],
  research_search: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "claude-sonnet", "claude-fable"],
  computer_use: ["gpt-5.4-mini", "claude-sonnet", "gpt-5.6-sol", "gpt-5.6-terra", "claude-sonnet-4-6"],
  vision: ["claude-haiku", "claude-sonnet", "claude-fable", "gpt-5.6-sol", "claude-opus"],
  media_generation: ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5", "gpt-5.4"],
  data_analysis: ["gpt-5.6-luna", "gpt-5.4", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.5"],
  documents: ["gpt-5.6-luna", "gpt-5.6-terra", "claude-fable", "gpt-5.6-sol", "claude-opus"],
  organization: ["gpt-5.4-mini", "gpt-5.6-terra", "claude-fable", "gpt-5.6-luna", "claude-sonnet"],
  conversation: ["claude-haiku", "claude-sonnet", "claude-fable", "gpt-5.6-terra", "claude-opus"],
  creative_ideation: ["claude-haiku", "claude-sonnet", "claude-fable", "gpt-5.6-terra", "claude-opus"],
  cybersecurity: ["gpt-5.4-mini", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5", "claude-opus"],
  science: ["gpt-5.4-mini", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.5", "claude-opus"],
  fast_high_volume: ["gpt-5.4-mini", "gpt-5.6-luna", "gpt-5.6-terra", "claude-haiku"],
};
export const DEFAULT_ROUTING_RULES: Record<TaskCapability, RoutingRule> = Object.fromEntries(
  Object.entries(DEFAULT_CAPABILITY_ORDER).map(([capability, models]) => [capability, { primary: models.slice(0, 3), fallbacks: models.slice(3) }]),
) as Record<TaskCapability, RoutingRule>;

export function inferProviderPreference(prompt: string): ProviderPreference {
  const userTurns = [...prompt.matchAll(/(?:^|\n)User:\s*([\s\S]*?)(?=\n\n(?:User|Assistant):|$)/gi)].map((match) => match[1]);
  const candidates = userTurns.length ? userTurns : [prompt];
  for (let index = candidates.length - 1; index >= 0; index--) {
    const text = candidates[index].toLowerCase();
    if (/\b(?:only|use|prefer|stick (?:with|to))\s+(?:anthropic|claude)\b|\bclaude\s+(?:only|for everything)\b/.test(text)) return "claude";
    if (/\b(?:only|use|prefer|stick (?:with|to))\s+(?:openai|chatgpt|gpt)\b|\b(?:chatgpt|openai)\s+(?:only|for everything)\b/.test(text)) return "codex";
  }
  return "auto";
}

const ROLE_DEFAULTS: Record<ProviderPreference, Record<Tier, string>> = {
  claude: { trivial: "claude-haiku", standard: "claude-opus", hard: "claude-fable" },
  codex: { trivial: "gpt-5.6-luna", standard: "gpt-5.6-terra", hard: "gpt-5.6-sol" },
  auto: { trivial: "gpt-5.4-mini", standard: "gpt-5.6-terra", hard: "gpt-5.6-sol" },
};

function baselineSelection(capability: TaskCapability, complexity: Tier, enabledModelIds?: string[], routingRules?: RoutingRules, providerPreference: ProviderPreference = "auto") {
  const enabled = (enabledModelIds?.length ? enabledModelIds : Object.keys(LOCAL_MODELS)).filter((id) => LOCAL_MODELS[id]);
  const constrainedProvider: ProviderPreference = capability === "media_generation" ? "codex" : providerPreference;
  const providerEnabled = constrainedProvider === "auto" ? enabled : enabled.filter((id) => LOCAL_MODELS[id].engine === constrainedProvider);
  const rule = routingRules?.[capability] ?? DEFAULT_ROUTING_RULES[capability];
  const ordered = [...(rule.primary ?? []), ...(rule.fallbacks ?? [])].filter((id) => providerEnabled.includes(id));
  const configured = routingRules?.[capability];
  const defaults = DEFAULT_ROUTING_RULES[capability];
  const customPriority = Boolean(configured && JSON.stringify(configured) !== JSON.stringify(defaults));
  const roleDefault = ROLE_DEFAULTS[constrainedProvider][complexity];
  if (constrainedProvider !== "auto" && providerEnabled.includes(roleDefault)) return { modelId: roleDefault, ordered, constrainedProvider, customPriority, source: "provider" as const };
  if (constrainedProvider === "auto") {
    const preferred = complexity === "hard"
      ? (["debugging", "code_review", "long_horizon", "vision", "creative_ideation"].includes(capability) ? "claude-fable" : "gpt-5.6-sol")
      : complexity === "standard"
        ? (["creative_ideation", "conversation", "documents", "code_review", "vision"].includes(capability) ? "claude-opus" : "gpt-5.6-terra")
        : (["conversation", "organization"].includes(capability) ? "claude-haiku" : capability === "new_code" ? "gpt-5.6-luna" : "gpt-5.4-mini");
    if (providerEnabled.includes(preferred)) return { modelId: preferred, ordered, constrainedProvider, customPriority, source: customPriority ? "custom" as const : "default" as const };
  }
  const tierPreference: Tier[] = complexity === "trivial" ? ["trivial", "standard", "hard"] : complexity === "hard" ? ["hard", "standard", "trivial"] : ["standard", "trivial", "hard"];
  for (const tier of tierPreference) {
    const match = ordered.find((id) => LOCAL_MODELS[id]?.tier === tier);
    if (match) return { modelId: match, ordered, constrainedProvider, customPriority, source: customPriority ? "custom" as const : "fallback" as const };
  }
  return { modelId: providerEnabled.find((id) => capabilityProfile(id).strengths.includes(capability)) ?? providerEnabled[0] ?? enabled[0] ?? LOCAL_TIER_DEFAULT[complexity], ordered, constrainedProvider, customPriority, source: "fallback" as const };
}

export function selectRoutedModelWithTrace(capability: TaskCapability, complexity: Tier, enabledModelIds?: string[], routingRules?: RoutingRules, providerPreference: ProviderPreference = "auto", adaptiveSamples: RoutingFeedbackSample[] = []) {
  const baseline = baselineSelection(capability, complexity, enabledModelIds, routingRules, providerPreference);
  let modelId = baseline.modelId;
  let source: RoutingDecisionTrace["source"] = baseline.source;
  let adapted = false;
  let sampleCount = 0;
  let candidates: RoutingDecisionTrace["candidates"] = baseline.ordered.map((candidate) => ({ modelId: candidate, attempts: 0, successRate: null, averageTokens: null, score: null }));
  if (adaptiveSamples.length && !baseline.customPriority && productEnv("HYZR_CHAT_DISABLE_ADAPTIVE_ROUTING", "VMX_DISABLE_ADAPTIVE_ROUTING") !== "1") {
    const sameTier = baseline.ordered.filter((id) => LOCAL_MODELS[id]?.tier === complexity);
    if (sameTier.length >= 2) {
      const learned = rankModelsFromSamples(sameTier, capability, complexity, adaptiveSamples);
      sampleCount = learned.matchingSamples;
      candidates = learned.performance.map((candidate) => ({ modelId: candidate.modelId, attempts: candidate.attempts, successRate: candidate.attempts ? candidate.successRate : null, averageTokens: candidate.averageTokens, score: candidate.attempts ? candidate.score : null }));
      if (learned.adapted) { modelId = learned.modelId; source = "adaptive"; adapted = true; }
    }
  }
  const trace: RoutingDecisionTrace = {
    selectedModelId: modelId,
    defaultModelId: baseline.modelId,
    capability,
    tier: complexity,
    providerPreference: baseline.constrainedProvider,
    source,
    adapted,
    sampleCount,
    reason: adapted
      ? `${modelId} replaced ${baseline.modelId} after ${sampleCount} comparable rated outcomes cleared the confidence threshold.`
      : baseline.customPriority
        ? `Selected from the user's explicit ${capability} priority order; adaptive overrides are disabled for customized routes.`
        : baseline.constrainedProvider !== "auto"
          ? `Honored the ${baseline.constrainedProvider === "codex" ? "ChatGPT" : "Claude"} provider constraint before cost and quality ranking.`
          : sampleCount
            ? `Kept ${baseline.modelId}; ${sampleCount} comparable outcomes did not justify an evidence-backed override.`
            : `Selected the capability and complexity default; outcome evidence is not yet sufficient to adapt this route.`,
    candidates,
  };
  return { modelId, trace };
}

export function selectRoutedModel(capability: TaskCapability, complexity: Tier, enabledModelIds?: string[], routingRules?: RoutingRules, providerPreference: ProviderPreference = "auto", adaptiveSamples: RoutingFeedbackSample[] = []): string {
  return selectRoutedModelWithTrace(capability, complexity, enabledModelIds, routingRules, providerPreference, adaptiveSamples).modelId;
}

export function classifyComplexity(prompt: string): Tier {
  const text = prompt.toLowerCase();
  if (/\b(restart|start|stop|reopen)\b.{0,40}\b(server|dev server|process)\b|\b(check|verify)\b.{0,45}\b(running|server|port|status)\b|\b(rename|typo|format|quick fact|one[- ]line|single command|hello[ ,_-]*world|basic boilerplate|bare html|no styling)\b|\b(simple|basic|small|quick)\b.{0,32}\b(css animation|animation tweak|transition|timing change)\b|\b(adjust|change|fix)\b.{0,30}\b(animation timing|duration|delay|easing)\b/.test(text)) return "trivial";
  if (/\b(architecture|large codebase|entire project|end[- ]to[- ]end|complex migration|security audit|race condition|distributed|production[- ]grade|autonomous|multi[- ]step)\b/.test(text)) return "hard";
  return "standard";
}

export function classifyCapability(prompt: string): { capability: TaskCapability; signals: string[] } {
  const text = prompt.toLowerCase();
  const tests: [TaskCapability, RegExp][] = [
    ["media_generation", /\b(generate|create|edit|animate)\b.{0,64}\b(image|photo|illustration|video|animation|logo|artwork|background)\b|\b(image|video)\s*(?:generation|gen)\b/],
    ["architecture", /\b(architecture|system design|data model|scalab|distributed|microservice|technical design)\b/],
    ["debugging", /\b(debug|bug|broken|crash|root cause|race condition|doesn['’]?t work|fix this)\b|\b(fix|resolve|investigate)\b.{0,32}\berror\b/],
    ["code_review", /\b(code review|review this|security audit|find issues|check for bugs)\b/],
    ["frontend_design", /\b(frontend|web ?site|web ?app|ui|ux|css|responsive|landing page|settings page|interface|design system|animation|webgl|gsap)\b/],
    ["cybersecurity", /\b(cyber|vulnerability|exploit|penetration|threat model|malware|security)\b/],
    ["science", /\b(science|biology|chemistry|medical|health|genomic|physics|research paper)\b/],
    ["research_search", /\b(research|search the web|browse|sources|citations|latest|compare products)\b/],
    ["computer_use", /\b(browser automation|computer use|playwright|click|desktop|spreadsheet app|terminal|powershell|shell command|dev server|restart server|port check)\b/],
    ["vision", /\b(screenshot|analyze this image|read this image|visual inspection|diagram)\b/],
    ["data_analysis", /\b(data analysis|dataset|statistics|spreadsheet|csv|forecast|financial model)\b/],
    ["documents", /\b(presentation|slide deck|document|report|pdf|proposal|memo)\b/],
    ["creative_ideation", /\b(brainstorm|ideas|creative|story|naming|concepts|copywriting)\b/],
    ["organization", /\b(organize|plan|schedule|roadmap|prioritize|to-?do|workflow)\b/],
    ["long_horizon", /\b(large codebase|entire project|end[- ]to[- ]end|keep going|autonomous|multi[- ]step)\b/],
    ["conversation", /\b(chat|conversation|friendly|empathetic|tone|rewrite|explain)\b/],
    ["fast_high_volume", /\b(rename|typo|format|classify|extract|many files|bulk|quick)\b/],
  ];
  for (const [capability, pattern] of tests) if (pattern.test(text)) return { capability, signals: [CAPABILITY_LABELS[capability]] };
  return { capability: "new_code", signals: ["General implementation"] };
}

export function routeLocal(prompt: string, override?: string, enabledModelIds?: string[], routingRules?: RoutingRules, adaptiveSamples: RoutingFeedbackSample[] = []): LocalRouteDecision {
  if (override && override !== "auto" && LOCAL_MODELS[override]) {
    const model = LOCAL_MODELS[override];
    return { model, tier: model.tier, capability: classifyCapability(prompt).capability, reason: `You selected ${model.label} manually.`, signals: ["Manual override"] };
  }
  const { capability, signals } = classifyCapability(prompt);
  const complexity = classifyComplexity(prompt);
  const providerPreference = inferProviderPreference(prompt);
  const enabledIds = (enabledModelIds?.length ? enabledModelIds : Object.keys(LOCAL_MODELS)).filter((id) => LOCAL_MODELS[id]);
  const routed = selectRoutedModelWithTrace(capability, complexity, enabledIds, routingRules, providerPreference, adaptiveSamples);
  const modelId = routed.modelId;
  const model = LOCAL_MODELS[modelId];
  return {
    model,
    tier: complexity,
    capability,
    reason: `${CAPABILITY_LABELS[capability]} · ${complexity} workload → ${model.label}.`,
    signals,
    routingTrace: routed.trace,
  };
}
