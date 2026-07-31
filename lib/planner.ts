// The planner: DETERMINISTIC, zero-planner-token decomposition + quality-first
// routing. It splits the request with `decompose` (coherence-first — a coupled
// app is one build; only independent deliverables like image generation split
// off), then routes each part to the model that clears its quality bar at the
// lowest subscription usage. No planner-model call — faster, cheaper, and the
// same plan every time. Mirrors vmx-engine's buildPlan.

import { CAPABILITY_LABELS, LOCAL_MODELS, type TaskCapability } from "./local-models";
import { decompose } from "./decompose";
import {
  classifyComplexity, classifyQualityDemand, detectSkills, inferProviderPreference,
  selectRoutedModelWithTrace, type CostOptions, type RoutingDecisionTrace, type RoutingRules,
} from "./local-router";
import type { RoutingFeedbackSample } from "./routing-feedback";

export type PlanTier = "trivial" | "standard" | "hard";

export interface Subtask {
  title: string;
  tier: PlanTier;
  capability: TaskCapability;
  modelId: string;
  rationale: string;
  routingTrace?: RoutingDecisionTrace;
}
export interface Plan {
  intent: string;
  complexity: PlanTier;
  strategy: string;
  executorModelId: string;
  subtasks: Subtask[];
}

const tierRank = (t: PlanTier): number => (t === "hard" ? 2 : t === "standard" ? 1 : 0);

export async function analyze(userPrompt: string, allowedModelIds?: string[], signal?: AbortSignal, routingRules?: RoutingRules, adaptiveSamples: RoutingFeedbackSample[] = []): Promise<Plan> {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Planning cancelled", "AbortError");
  const allAllowed = (allowedModelIds?.length ? allowedModelIds : Object.keys(LOCAL_MODELS)).filter((id) => LOCAL_MODELS[id]);
  const providerPreference = inferProviderPreference(userPrompt);
  const demand = classifyQualityDemand(userPrompt);
  const promptSkills = detectSkills(userPrompt);

  const raw = decompose(userPrompt);

  const subtasks: Subtask[] = raw.map((task) => {
    const detected = detectSkills(task.title).length ? detectSkills(task.title) : promptSkills;
    // Media skills belong only to the media subtask (a build's title is the whole
    // prompt, so "generate an image" would otherwise zero out Claude for the build).
    const skills = task.capability === "media_generation" ? detected : detected.filter((s) => s !== "image_gen" && s !== "video_gen");
    const cost: CostOptions = { demand, skills };
    const routed = selectRoutedModelWithTrace(task.capability, task.tier, allAllowed, routingRules, providerPreference, adaptiveSamples, cost);
    return {
      title: task.title,
      tier: task.tier,
      capability: task.capability,
      modelId: routed.modelId,
      rationale: `${CAPABILITY_LABELS[task.capability]} · ${task.tier}. ${routed.trace.reason}`,
      routingTrace: routed.trace,
    };
  });

  const complexity = subtasks.reduce<PlanTier>((mx, s) => (tierRank(s.tier) > tierRank(mx) ? s.tier : mx), "trivial");
  const rawTitle = userPrompt.replace(/\s+/g, " ").replace(/^\[Space:[^\]]+\]\s*/i, "").trim();
  const intent = rawTitle.length > 120 ? `${rawTitle.slice(0, 117)}…` : rawTitle || "Complete the requested work";

  // Deterministic strategy sentence — what the plan actually does.
  const models = Array.from(new Set(subtasks.map((s) => LOCAL_MODELS[s.modelId]?.label).filter(Boolean)));
  const strategy = subtasks.length <= 1
    ? `A single coherent build on ${models[0] ?? "the best-matched model"}, routed by capability at the lowest subscription usage.`
    : `${subtasks.length} parts, each on its strong-suit model (${models.join(", ")}); coupled work stays coherent, independent assets split off.`;

  return {
    intent,
    complexity,
    strategy,
    executorModelId: subtasks[0]?.modelId ?? allAllowed[0],
    subtasks: subtasks.length ? subtasks : [{
      title: intent, tier: classifyComplexity(userPrompt), capability: "new_code",
      modelId: allAllowed[0], rationale: "Best available model for the requested work.",
    }],
  };
}
