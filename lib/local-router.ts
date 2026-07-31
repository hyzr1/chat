// Quality-first deterministic router. Identifies the workload (capability +
// fine-grained skills + how much quality the user is demanding + true
// difficulty) and routes to the model that clears that subtask's quality bar at
// the LOWEST subscription usage. Quality is the gate; usage is only the tiebreak
// among genuine equals. Mirrors vmx-engine/src/local-router.ts.

import { CAPABILITY_LABELS, LOCAL_MODELS, LOCAL_TIER_DEFAULT, capabilityQuality, skillQuality, modelCostWeight, planUsageWeight, type LocalModel, type Skill, type TaskCapability, type Tier } from "./local-models";
import { rankModelsFromSamples, type RoutingFeedbackSample } from "./routing-feedback";
import { productEnv } from "./product";

export type CostBias = "cheap" | "balanced" | "quality";
export interface CostOptions { ceilingId?: string; bias?: CostBias; demand?: number; skills?: Skill[]; planLoad?: Record<"claude" | "codex", number> }

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
  source: "default" | "adaptive" | "custom" | "provider" | "fallback" | "cost";
  adapted: boolean;
  sampleCount: number;
  reason: string;
  candidates: Array<{ modelId: string; attempts: number; successRate: number | null; averageTokens: number | null; score: number | null }>;
}

// The core pool the deterministic router ranks over (legacy/duplicate models are
// still routable by explicit override, just not part of the default ordering).
const CORE_MODELS = [
  "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.4", "gpt-5.4-mini",
  "claude-fable", "claude-opus", "claude-sonnet", "claude-haiku",
];

// Per-capability preference order, GENERATED from the quality matrix: best model
// at that capability first, ties broken by lower subscription usage. One source
// of truth for the routing-rules defaults, the planner catalog and this router.
export const DEFAULT_CAPABILITY_ORDER: Record<TaskCapability, string[]> = Object.fromEntries(
  (Object.keys(CAPABILITY_LABELS) as TaskCapability[]).map((capability) => {
    const ranked = CORE_MODELS
      .filter((id) => capabilityQuality(id, capability) > 0)
      .sort((a, b) => capabilityQuality(b, capability) - capabilityQuality(a, capability) || planUsageWeight(a) - planUsageWeight(b));
    return [capability, ranked];
  }),
) as Record<TaskCapability, string[]>;

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

const QUALITY_CUES = /\b(high[- ]?(?:end|quality|fidelity|res(?:olution)?)|hi[- ]?fi|premium|polished|beautiful|stunning|gorgeous|world[- ]?class|production[- ]?grade|professional(?:[- ]?grade)?|pixel[- ]?perfect|top[- ]?(?:tier|quality|notch)|triple[- ]?a|aaa|first[- ]?rate|best (?:possible|in class)|exactly (?:like|the same)|impress|portfolio|award|really (?:important|matters)|mission[- ]?critical|critical|complex|complicated|tricky|intricate|subtle|hard(?:est)? (?:bug|problem)|can'?t (?:figure|solve|crack)|stuck on|thorough(?:ly)?|robust|enterprise|sophisticated|elegant|meticulous|no expense)\b/i;
const SIMPLE_CUES = /\b(basic|simple|quick|minimal|rough|prototype|proto|mvp|throwaway|placeholder|draft|boilerplate|scaffold|bare[- ]?bones|barebones|just a|nothing fancy|doesn'?t (?:need|have) to be (?:fancy|pretty|perfect|good)|no need for|dead simple|trivial|small tweak|one[- ]?liner|light[- ]?weight|cheap(?:est)?|low[- ]?cost|budget|efficient|save (?:usage|tokens|money|credits|cost)|don'?t (?:waste|burn)|(?:light|small|cheap|fast|efficient|tiny) model)\b/i;
// The user's own framing raises or lowers the quality bar (< 1 tightens → keep
// the specialist; > 1 loosens → a cheap model is the right call).
export function classifyQualityDemand(prompt: string): number {
  const text = prompt.toLowerCase();
  let demand = 1;
  const qualityHits = (text.match(new RegExp(QUALITY_CUES, "gi")) ?? []).length;
  const simpleHits = (text.match(new RegExp(SIMPLE_CUES, "gi")) ?? []).length;
  if (qualityHits) demand *= qualityHits >= 2 ? 0.5 : 0.65;
  if (simpleHits) demand *= simpleHits >= 2 ? 1.7 : 1.45;
  return Math.max(0.45, Math.min(1.9, demand));
}

const cheapestOf = (ids: string[]): string | undefined =>
  ids.length ? ids.reduce((a, b) => (modelCostWeight(b) < modelCostWeight(a) ? b : a)) : undefined;

// How far below the best available quality we accept a cheaper model — narrow by
// default (quality first), widening only for genuinely-easy work (trivial) or
// when the user asked for something basic (demand > 1).
function qualityTolerance(tier: Tier, bias: CostBias): number {
  const byTier: Record<Tier, number> = { hard: 0.25, standard: 0.7, trivial: 3.5 };
  const byBias: Record<CostBias, number> = { quality: 0.75, balanced: 1.0, cheap: 1.4 };
  return byTier[tier] * byBias[bias];
}

// Pick the model that clears this exact subtask's (skill-refined) quality bar at
// the lowest subscription usage. Quality is the gate; usage is only the tiebreak.
function qualityAwareSelect(pool: string[], capability: TaskCapability, tier: Tier, bias: CostBias, skills?: Skill[], demand = 1, planLoad?: Record<"claude" | "codex", number>): string {
  if (!pool.length) return LOCAL_TIER_DEFAULT[tier];
  const scored = pool.map((id) => ({ id, q: skillQuality(id, capability, skills), w: planUsageWeight(id), c: modelCostWeight(id) }));
  const qmax = Math.max(...scored.map((s) => s.q));
  const tol = qualityTolerance(tier, bias) * demand;
  const eligible = scored.filter((s) => s.q >= qmax - tol);
  // Session balance, quality-neutral. Among equal-weight models whose quality is
  // indistinguishable (within NOISE_EPS — matrix scores are estimates), prefer
  // the less-loaded plan so neither subscription drains first. A real quality gap
  // (> eps) always wins; savings and quality are never traded for balance.
  const NOISE_EPS = 0.15;
  const loadOf = (id: string) => planLoad ? (planLoad[LOCAL_MODELS[id].engine] ?? 0) : 0;
  eligible.sort((a, b) =>
    a.w - b.w
    || (Math.abs(a.q - b.q) > NOISE_EPS ? b.q - a.q : 0)
    || loadOf(a.id) - loadOf(b.id)
    || b.q - a.q
    || a.c - b.c,
  );
  return eligible[0]?.id ?? pool[0];
}

// Previous-generation / compatibility models: routable by manual override, never
// auto-selected (a current-gen model always dominates; they must not win a
// usage-weight tiebreak).
const LEGACY_MODELS = new Set(["claude-opus-4-7", "claude-opus-4-6", "claude-opus-3", "claude-sonnet-4-6"]);

function baselineSelection(capability: TaskCapability, complexity: Tier, enabledModelIds?: string[], routingRules?: RoutingRules, providerPreference: ProviderPreference = "auto", cost?: CostOptions) {
  const enabledRaw = (enabledModelIds?.length ? enabledModelIds : Object.keys(LOCAL_MODELS)).filter((id) => LOCAL_MODELS[id]);
  const enabledCurrent = enabledRaw.filter((id) => !LEGACY_MODELS.has(id));
  const enabled = enabledCurrent.length ? enabledCurrent : enabledRaw;
  const constrainedProvider: ProviderPreference = capability === "media_generation" ? "codex" : providerPreference;
  let providerEnabled = constrainedProvider === "auto" ? enabled : enabled.filter((id) => LOCAL_MODELS[id].engine === constrainedProvider);
  if (!providerEnabled.length) providerEnabled = enabled;

  const ceilingWeight = cost?.ceilingId ? modelCostWeight(cost.ceilingId) : Number.POSITIVE_INFINITY;
  const capped = providerEnabled.filter((id) => modelCostWeight(id) <= ceilingWeight);
  const pool = capped.length ? capped : [cheapestOf(providerEnabled)!];

  const rule = routingRules?.[capability] ?? DEFAULT_ROUTING_RULES[capability];
  const configured = routingRules?.[capability];
  const defaults = DEFAULT_ROUTING_RULES[capability];
  const customPriority = Boolean(configured && JSON.stringify(configured) !== JSON.stringify(defaults));
  const ordered = [...(rule.primary ?? []), ...(rule.fallbacks ?? [])].filter((id) => pool.includes(id));
  const bias: CostBias = cost?.bias ?? "quality";

  if (customPriority) {
    return { modelId: ordered[0] ?? cheapestOf(pool)!, ordered, constrainedProvider, customPriority, source: "custom" as const };
  }

  const modelId = qualityAwareSelect(pool, capability, complexity, bias, cost?.skills, cost?.demand, cost?.planLoad);
  const source: "provider" | "cost" | "default" = constrainedProvider !== "auto" ? "provider" : bias === "quality" ? "default" : "cost";
  return { modelId, ordered, constrainedProvider, customPriority, source };
}

export function selectRoutedModelWithTrace(capability: TaskCapability, complexity: Tier, enabledModelIds?: string[], routingRules?: RoutingRules, providerPreference: ProviderPreference = "auto", adaptiveSamples: RoutingFeedbackSample[] = [], cost?: CostOptions) {
  const baseline = baselineSelection(capability, complexity, enabledModelIds, routingRules, providerPreference, cost);
  let modelId = baseline.modelId;
  let source: RoutingDecisionTrace["source"] = baseline.source;
  let adapted = false;
  let sampleCount = 0;
  let candidates: RoutingDecisionTrace["candidates"] = baseline.ordered.map((candidate) => ({ modelId: candidate, attempts: 0, successRate: null, averageTokens: null, score: null }));
  if (cost?.bias !== "cheap" && adaptiveSamples.length && !baseline.customPriority && baseline.constrainedProvider === "auto" && productEnv("HYZR_CHAT_DISABLE_ADAPTIVE_ROUTING", "VMX_DISABLE_ADAPTIVE_ROUTING") !== "1") {
    // Feedback is grouped by workload tier, not by a model's catalog tier. A
    // standard task may legitimately default to a frontier model, so filtering
    // candidates by LOCAL_MODELS[id].tier made the actual incumbent invisible
    // to the learner and prevented evidence-backed overrides. Keep the selected
    // baseline first, then compare it with every configured candidate that has
    // results for the same kind of work.
    const candidateIds = [baseline.modelId, ...baseline.ordered.filter((id) => id !== baseline.modelId)];
    if (candidateIds.length >= 2) {
      const learned = rankModelsFromSamples(candidateIds, capability, complexity, adaptiveSamples);
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
      : source === "cost"
        ? `Quality-matched at the lowest subscription usage for this ${capability} workload.`
        : baseline.customPriority
        ? `Selected from the user's explicit ${capability} priority order; adaptive overrides are disabled for customized routes.`
        : baseline.constrainedProvider !== "auto"
          ? `Honored the ${baseline.constrainedProvider === "codex" ? "ChatGPT" : "Claude"} provider constraint, then matched quality at the lowest usage.`
          : sampleCount
            ? `Kept ${baseline.modelId}; ${sampleCount} comparable outcomes did not justify an evidence-backed override.`
            : `Best quality for this ${capability} workload at the lowest subscription usage.`,
    candidates,
  };
  return { modelId, trace };
}

export function selectRoutedModel(capability: TaskCapability, complexity: Tier, enabledModelIds?: string[], routingRules?: RoutingRules, providerPreference: ProviderPreference = "auto", adaptiveSamples: RoutingFeedbackSample[] = [], cost?: CostOptions): string {
  return selectRoutedModelWithTrace(capability, complexity, enabledModelIds, routingRules, providerPreference, adaptiveSamples, cost).modelId;
}

export function classifyComplexity(prompt: string): Tier {
  const text = prompt.toLowerCase();
  // Small mechanical edits and single actions are trivial REGARDLESS of category
  // — changing a button's padding is "frontend" but trivial; running one shell
  // command is "computer use" but trivial. They should never pull a frontier model.
  // Operational / DevOps tasks are mechanical — the cheapest model does them
  // perfectly, so they are ALWAYS trivial regardless of other wording.
  if (/\b(restart|start|stop|reopen|host|serve|serving|launch|boot|run|running|preview|open|deploy|kill|expose|spin ?up|bring up|fire up)\b.{0,44}\b(server|dev server|process|port|localhost|preview|site|app|page|it|this|the (?:server|site|app|page))\b/.test(text)) return "trivial";
  if (/\b(install|reinstall|add|update|upgrade|bump)\b.{0,28}\b(dependenc(?:y|ies)|deps|packages?|node_modules|npm|yarn|pnpm|requirements)\b|\b(run|execute)\b.{0,24}\b(command|script|it|this|npm|yarn|pnpm|build|tests?|lint|migration|the build)\b/.test(text)) return "trivial";
  if (/\b(restart|start|stop|reopen)\b.{0,40}\b(server|dev server|process)\b|\b(check|verify)\b.{0,45}\b(running|server|port|status)\b|\b(rename|typo|format|quick fact|one[- ]line|single command|hello[ ,_-]*world|basic boilerplate|bare html|no styling)\b|\b(simple|basic|small|quick)\b.{0,32}\b(css animation|animation tweak|transition|timing change)\b|\b(adjust|change|fix|tweak|update|set|increase|decrease|bump)\b.{0,30}\b(animation timing|duration|delay|easing|padding|margin|color|colour|font[- ]?size|spacing|width|height|border|border[- ]?radius|background|opacity|z[- ]?index)\b|\b(add|insert|remove)\b.{0,20}\b(console\.log|comment|import|log statement)\b|\b(move|rename|delete|copy)\b.{0,20}\b(the |a |this )?(file|folder|function|variable)\b/.test(text)) return "trivial";
  if (/\b(architecture|large codebase|entire project|end[- ]to[- ]end|complex migration|security audit|race condition|distributed|production[- ]grade|autonomous|multi[- ]step)\b/.test(text)) return "hard";
  return "standard";
}

const SKILL_TESTS: [Skill, RegExp][] = [
  ["cpp", /\bc\+\+|\bcpp\b|std::|cmake|\bg\+\+\b|\bheader file/i],
  ["rust", /\brust\b|\bcargo\b|borrow checker|\btokio\b|\bwasm\b/i],
  ["go", /\bgo(?:lang)?\b|goroutine|\bgin\b/i],
  ["csharp", /\bc#|\.net\b|asp\.net|\bunity\b|\bxaml\b/i],
  ["java", /\bjava\b|spring boot|\bjvm\b|\bkotlin\b|\bmaven\b|\bgradle\b/i],
  ["python", /\bpython\b|\bdjango\b|\bflask\b|\bfastapi\b|\bnumpy\b|\bpandas\b|\bpytorch\b|\.py\b/i],
  ["typescript", /\btypescript\b|\bjavascript\b|\bjs\b|\bts\b|\.[jt]sx?\b|type[- ]safe|generics|\breact\b|\bvue\b|\bsvelte\b|\bnext\.?js\b|\bnode\b/i],
  ["sql", /\bsql\b|postgres|mysql|sqlite|\bquery\b|database schema|\bjoin\b|\borm\b|prisma/i],
  ["graphics", /\bwebgl\b|three\.js|\bcanvas\b|\bshader\b|\bglsl\b|opengl\b|\b3d\b|game (?:engine|loop)|\bpixi\b/i],
  ["animation", /\banimat|\btransition\b|keyframe|\bgsap\b|framer[- ]?motion|\bmotion\b|\btween\b|\bparallax\b/i],
  ["css", /\bcss\b|tailwind|flexbox|\bgrid\b|styling|\bpadding\b|\bmargin\b|responsive|\blayout\b|\bstylesheet\b/i],
  ["api_backend", /\bapi\b|\brest\b|graphql|\bendpoint\b|\bbackend\b|server route|microservice|\bwebhook\b|\bmiddleware\b/i],
  ["cli", /command[- ]?line|\bcli\b|\bterminal\b|powershell|\bbash\b|\bshell\b|run (?:a |the )?(?:command|script)|\bnpm\b|\bmakefile\b/i],
  ["video_gen", /\bvideo\b.{0,20}\b(gen|generat|create|make)|animation clip|motion graphic/i],
  ["image_gen", /\b(image|logo|icon|illustration|artwork|picture|photo|banner|sprite)s?\b.{0,24}\b(gen|generat|create|make|design|produce)|\b(generate|create|make|produce)\b.{0,24}\b(image|logo|icon|illustration|artwork)/i],
  ["regex", /\bregex|regular expression|\bpattern match/i],
  ["data_ml", /machine learning|\bml model|neural|training data|\bdataset\b|regression|classifier|\bembedding|\bllm\b/i],
  ["systems_perf", /\bperformance\b|optimize|\blatency\b|\bmemory\b|concurrency|threading|low[- ]level|systems programming|\bthroughput\b/i],
  ["testing_debug", /unit test|integration test|test suite|\bdebug|fix (?:the |a )?bug|failing test|edge case|\bstack trace\b/i],
];
export function detectSkills(prompt: string): Skill[] {
  const text = prompt.toLowerCase();
  return SKILL_TESTS.filter(([, re]) => re.test(text)).map(([s]) => s).slice(0, 4);
}

export function classifyCapability(prompt: string): { capability: TaskCapability; signals: string[] } {
  const text = prompt.toLowerCase();
  const tests: [TaskCapability, RegExp][] = [
    // Editing an animation in application code is frontend work. Keep this
    // ahead of media generation so phrases such as "animation timing change"
    // do not get mistaken for a request to generate a video or image asset.
    ["frontend_design", /\b(animation|transition|keyframe|gsap|framer[- ]?motion)\b.{0,48}\b(change|tweak|timing|duration|delay|easing|code|css|component)\b|\b(change|tweak|adjust|fix|update)\b.{0,48}\b(animation|transition|keyframe|timing|duration|easing)\b/],
    ["media_generation", /\b(generate|create|make|produce|edit|render|design|draw|animate)\b.{0,72}\b(images?|photos?|illustrations?|videos?|animations?|logos?|icons?|artworks?|graphics?|banners?|sprites?|avatars?|backgrounds?|wallpapers?)\b|\b(images?|videos?|logos?|icons?)\s*(?:generation|gen)\b|\b(icon set|hero image|cover art|splash (?:screen|image))\b/],
    ["architecture", /\b(architecture|system design|data model|scalab|distributed|microservice|technical design)\b/],
    ["debugging", /\b(debug|bug|broken|crash|root cause|race condition|doesn['’]?t work|fix this)\b|\b(fix|resolve|investigate)\b.{0,32}\berror\b/],
    ["code_review", /\b(code review|review this|security audit|find issues|check for bugs)\b/],
    ["frontend_design", /\b(frontend|web ?site|web ?app|ui|ux|css|responsive|landing page|settings page|interface|design system|animation|webgl|gsap|game|gameplay|arcade|clone of|exactly like)\b/],
    ["cybersecurity", /\b(cyber|vulnerability|exploit|penetration|threat model|malware|security)\b/],
    ["science", /\b(science|biology|chemistry|medical|health|genomic|physics|research paper)\b/],
    ["research_search", /\b(research|search the web|browse|sources|citations|latest|compare products)\b/],
    ["computer_use", /\b(browser automation|computer use|playwright|click|desktop|spreadsheet app|terminal|powershell|shell command|dev server|restart server|port check)\b/],
    ["vision", /\b(screenshot|analyze this image|read this image|visual inspection|diagram)\b/],
    ["data_analysis", /\b(data analysis|statistical analysis|statistics|regression|forecast|predictive model|financial model|analyze the data|correlation|hypothesis test)\b/],
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

export function routeLocal(prompt: string, override?: string, enabledModelIds?: string[], routingRules?: RoutingRules, adaptiveSamples: RoutingFeedbackSample[] = [], cost?: CostOptions): LocalRouteDecision {
  if (override && override !== "auto" && LOCAL_MODELS[override]) {
    const model = LOCAL_MODELS[override];
    return { model, tier: model.tier, capability: classifyCapability(prompt).capability, reason: `You selected ${model.label} manually.`, signals: ["Manual override"] };
  }
  const { capability, signals } = classifyCapability(prompt);
  const complexity = classifyComplexity(prompt);
  const providerPreference = inferProviderPreference(prompt);
  const enabledIds = (enabledModelIds?.length ? enabledModelIds : Object.keys(LOCAL_MODELS)).filter((id) => LOCAL_MODELS[id]);
  const enrichedCost: CostOptions = { ...cost, demand: cost?.demand ?? classifyQualityDemand(prompt), skills: cost?.skills ?? detectSkills(prompt) };
  const routed = selectRoutedModelWithTrace(capability, complexity, enabledIds, routingRules, providerPreference, adaptiveSamples, enrichedCost);
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
