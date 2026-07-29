// The planner: the CHEAPEST ChatGPT model (GPT-5.4 Mini) reads the user's
// request, works out what they're actually asking for, and decides how to
// split / route it. Its complexity verdict then drives which model executes.

import { collectLocal } from "./local-runner";
import { CAPABILITY_LABELS, LOCAL_MODELS, capabilityProfile, type TaskCapability } from "./local-models";
import { classifyCapability, classifyComplexity, inferProviderPreference, selectRoutedModel, selectRoutedModelWithTrace, type RoutingDecisionTrace, type RoutingRules } from "./local-router";
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

const PLANNER_ENGINE = "codex" as const;
const PLANNER_MODEL = "gpt-5.4-mini";

const SYSTEM = `You are the routing planner for a multi-model coding assistant.
Analyze the user's request and respond with ONLY a JSON object (no markdown, no code fences, no prose) of exactly this shape:
{"intent":"<one sentence: what the user wants>","complexity":"trivial|standard|hard","strategy":"<one sentence explaining the capability-based route>","executorModelId":"<best model for the whole request>","subtasks":[{"title":"<short imperative>","tier":"trivial|standard|hard","capability":"<capability id>","modelId":"<best model for this part>","rationale":"<specific reason this model fits this workload>"}]}
Valid capability ids: frontend_design, new_code, debugging, code_review, architecture, long_horizon, research_search, computer_use, vision, media_generation, data_analysis, documents, organization, conversation, creative_ideation, cybersecurity, science, fast_high_volume.
Cost discipline is mandatory. Restarting a server, checking a port, renaming, formatting, Hello World, bare boilerplate, running one command, or verifying an existing build is TRIVIAL and must be one task on Luna, Mini, or Haiku at low effort. Everyday implementation is STANDARD: use Terra for balanced ChatGPT work or Opus for substantial Claude work; reserve Sonnet/Haiku for narrower or repetitive Claude tasks. Genuinely difficult architecture, ambiguous brownfield debugging, security-critical work, or long autonomous builds are HARD and use Sol or Fable. Explicit provider instructions are hard constraints: if the user says Claude, all non-media tasks must use Claude; if they say ChatGPT/OpenAI, use it. Claude can analyze images but cannot natively generate image or video output, so media creation always routes through ChatGPT/OpenAI. Split only when parts require genuinely different capabilities or modalities: trivial=1 task, standard=1-2 tasks (up to 3 only when media is a separate deliverable), hard=2-4 tasks. Do not create a separate task for boilerplate. Choose only from AVAILABLE MODELS. Output JSON only.`;

function extractJson(text: string): any {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no json in planner output");
  return JSON.parse(raw.slice(start, end + 1));
}

export async function analyze(userPrompt: string, allowedModelIds?: string[], signal?: AbortSignal, routingRules?: RoutingRules, adaptiveSamples: RoutingFeedbackSample[] = []): Promise<Plan> {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Planning cancelled", "AbortError");
  const allAllowed = (allowedModelIds?.length ? allowedModelIds : Object.keys(LOCAL_MODELS))
    .filter((id) => LOCAL_MODELS[id]);
  const deterministicComplexity = classifyComplexity(userPrompt);
  const { capability: deterministicCapability } = classifyCapability(userPrompt);
  const providerPreference = inferProviderPreference(userPrompt);
  const words = userPrompt.trim().split(/\s+/).length;
  const needsSplit = /\b(?:and|plus|also|then)\b/i.test(userPrompt) && /\b(?:image|video|security|api|database|deploy|research|test|review)\b/i.test(userPrompt);
  if (deterministicComplexity === "trivial" || (deterministicComplexity === "standard" && words < 55 && !needsSplit)) {
    const routed = selectRoutedModelWithTrace(deterministicCapability, deterministicComplexity, allAllowed, routingRules, providerPreference, adaptiveSamples);
    const modelId = routed.modelId;
    const rawTitle = userPrompt.replace(/\s+/g, " ").replace(/^\[Space:[^\]]+\]\s*/i, "").trim();
    const title = rawTitle.length > 72 ? `${rawTitle.slice(0, 69)}…` : rawTitle;
    return {
      intent: title || "Complete the requested work",
      complexity: deterministicComplexity,
      strategy: `A deterministic ${deterministicCapability} route avoids a separate planner-model call for this scoped request.`,
      executorModelId: modelId,
      subtasks: [{ title: title || "Complete the request", tier: deterministicComplexity, capability: deterministicCapability, modelId, rationale: `No planning-model tokens were spent. ${routed.trace.reason}`, routingTrace: routed.trace }],
    };
  }
  const modernAllowed = allAllowed.filter((id) => !/[0-9]-(?:7|6)$|opus-3/.test(id));
  const capabilityCandidates = modernAllowed.filter((id) => capabilityProfile(id).strengths.includes(deterministicCapability));
  const tierCandidates = (["trivial", "standard", "hard"] as const).flatMap((tier) => modernAllowed.filter((id) => LOCAL_MODELS[id].tier === tier).slice(0, 2));
  const allowed = Array.from(new Set([...capabilityCandidates, ...tierCandidates])).slice(0, 8);
  const catalog = allowed.map((id) => {
    const m = LOCAL_MODELS[id];
    const profile = capabilityProfile(id);
    return `- ${m.id}: ${m.label} (${m.plan}). Best for: ${profile.bestFor} Capability tags: ${profile.strengths.map((cap) => CAPABILITY_LABELS[cap]).join(", ")}.${profile.caution ? ` Caution: ${profile.caution}` : ""}`;
  }).join("\n");
  const userPolicy = routingRules ? Object.entries(routingRules).filter(([capability]) => capability === deterministicCapability || (needsSplit && capability === "media_generation")).map(([capability, rule]) => {
    const enabled = [...(rule?.primary ?? []), ...(rule?.fallbacks ?? [])].filter((id) => allowed.includes(id));
    return enabled.length ? `- ${capability}: ${enabled.join(" > ")}` : "";
  }).filter(Boolean).join("\n") : "";
  const prompt = `${SYSTEM}\n\nAVAILABLE MODELS:\n${catalog}${userPolicy ? `\n\nUSER ROUTING PRIORITIES (left to right; obey these when a listed model is available and suitable):\n${userPolicy}` : ""}\n\nUSER REQUEST:\n${userPrompt}`;
  let j: any;
  try {
    const out = await collectLocal(PLANNER_ENGINE, PLANNER_MODEL, prompt, "low", signal);
    j = extractJson(out);
  } catch (error) {
    if (signal?.aborted) throw error;
    const routed = selectRoutedModelWithTrace(deterministicCapability, deterministicComplexity, allAllowed, routingRules, providerPreference, adaptiveSamples);
    const title = userPrompt.replace(/\s+/g, " ").replace(/^\[Space:[^\]]+\]\s*/i, "").trim().slice(0, 120) || "Complete the requested work";
    return {
      intent: title,
      complexity: deterministicComplexity,
      strategy: "The low-cost planner was unavailable, so Hyzr Chat used its deterministic capability route instead of blocking execution.",
      executorModelId: routed.modelId,
      subtasks: [{
        title,
        tier: deterministicComplexity,
        capability: deterministicCapability,
        modelId: routed.modelId,
        rationale: `Planner fallback. ${routed.trace.reason}`,
        routingTrace: routed.trace,
      }],
    };
  }
  const norm = (t: any): PlanTier =>
    t === "trivial" || t === "hard" ? t : "standard";

  const fallbackId = allowed[0];
  const validCapability = (value: any): TaskCapability =>
    Object.prototype.hasOwnProperty.call(CAPABILITY_LABELS, String(value)) ? String(value) as TaskCapability : "new_code";
  const validModel = (id: any) => allowed.includes(String(id)) ? String(id) : fallbackId;
  const overallComplexity = norm(j.complexity);
  const hasSeparateMedia = Array.isArray(j.subtasks) && j.subtasks.some((task: any) => String(task.capability) === "media_generation");
  const taskLimit = overallComplexity === "trivial" ? 1 : overallComplexity === "standard" ? (hasSeparateMedia ? 3 : 2) : 4;
  let premiumSpecialists = 0;
  const subtasks: Subtask[] = Array.isArray(j.subtasks)
    ? j.subtasks.slice(0, taskLimit).map((s: any) => {
        const taskText = `${s.title ?? ""}\n${userPrompt}`;
        const capability = /\b(restart|start|stop|verify|check)\b.{0,45}\b(server|port|process|running)\b/i.test(taskText) ? "computer_use" : validCapability(s.capability);
        const proposedTier = norm(s.tier);
        const tier = classifyComplexity(taskText) === "trivial" ? "trivial" : proposedTier;
        let routed = selectRoutedModelWithTrace(capability, tier, allowed, routingRules, providerPreference, adaptiveSamples);
        let selected = routed.modelId;
        if (LOCAL_MODELS[selected]?.tier === "hard") {
          if (premiumSpecialists >= (overallComplexity === "hard" ? 1 : 0)) {
            const standardPool = allowed.filter((id) => LOCAL_MODELS[id]?.tier === "standard");
            if (standardPool.length) {
              routed = selectRoutedModelWithTrace(capability, "standard", standardPool, routingRules, providerPreference, adaptiveSamples);
              selected = routed.modelId;
            }
          } else {
            premiumSpecialists++;
          }
        }
        return {
          title: String(s.title ?? "").slice(0, 120) || "Task",
          tier,
          capability,
          modelId: selected ?? validModel(s.modelId),
          rationale: String(`${CAPABILITY_LABELS[capability]} · ${tier}. ${routed.trace.reason}`).slice(0, 320),
          routingTrace: routed.trace,
        };
      })
    : [];

  return {
    intent: String(j.intent ?? "").slice(0, 300) || "Handle the request.",
    complexity: overallComplexity,
    strategy: String(j.strategy ?? "").slice(0, 300),
    executorModelId: subtasks[0]?.modelId ?? validModel(j.executorModelId),
    subtasks: subtasks.length ? subtasks : [{ title: "Handle the request", tier: overallComplexity, capability: "new_code", modelId: selectRoutedModel("new_code", overallComplexity, allowed, routingRules, providerPreference, adaptiveSamples), rationale: "Best available model for the requested work and provider constraint." }],
  };
}
