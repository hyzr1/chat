import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { LOCAL_MODELS, type TaskCapability, type Tier } from "./local-models";
import { rankModelsFromSamples, type RoutingFeedbackSample } from "./routing-feedback";
import { STATE_DIRECTORY } from "./product-paths";

const directory = STATE_DIRECTORY;
const feedbackFile = path.join(directory, "routing-feedback.json");

export function readRoutingFeedbackSamples(): RoutingFeedbackSample[] {
  try {
    const parsed = JSON.parse(readFileSync(feedbackFile, "utf8"));
    return Array.isArray(parsed.samples) ? parsed.samples.slice(-2000) : [];
  } catch { return []; }
}

function writeSamples(samples: RoutingFeedbackSample[]) {
  try {
    mkdirSync(directory, { recursive: true });
    const temporary = `${feedbackFile}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({ version: 1, updatedAt: Date.now(), samples: samples.slice(-2000) }, null, 2), "utf8");
    renameSync(temporary, feedbackFile);
  } catch {}
}

export function recordRoutingOutcome(runId: string, events: Array<Record<string, unknown>>, outcome: { verdict: RoutingFeedbackSample["verdict"]; humanEdits?: number; recordedAt: number }) {
  const usage = events.filter((event) => event.type === "usage");
  const totalTokens = usage.reduce((total, event) => total + (Number(event.totalTokens) || Number(event.inputTokens) + Number(event.outputTokens) || 0), 0);
  const decisions = events
    .filter((event) => event.type === "task_start" || event.type === "route")
    .map((event) => ({ modelId: String(event.modelId || ""), capability: String(event.capability || "new_code") as TaskCapability, tier: String(event.tier || "standard") as Tier }))
    .filter((decision) => LOCAL_MODELS[decision.modelId]);
  const unique = Array.from(new Map(decisions.map((decision) => [`${decision.capability}:${decision.tier}:${decision.modelId}`, decision])).values());
  const existing = readRoutingFeedbackSamples().filter((sample) => sample.runId !== runId);
  const apportionedTokens = unique.length ? Math.round(totalTokens / unique.length) : totalTokens;
  const additions = unique.map((decision) => ({
    runId, ...decision, verdict: outcome.verdict, tokens: apportionedTokens,
    humanEdits: Math.max(0, Number(outcome.humanEdits) || 0), recordedAt: outcome.recordedAt,
  }));
  writeSamples([...existing, ...additions]);
}

export function routingFeedbackSummary() {
  const samples = readRoutingFeedbackSamples();
  const groups = new Map<string, RoutingFeedbackSample[]>();
  for (const sample of samples) {
    const key = `${sample.capability}:${sample.tier}`;
    groups.set(key, [...(groups.get(key) || []), sample]);
  }
  let adaptiveRoutes = 0;
  const capabilities = Array.from(groups.entries()).map(([key, group]) => {
    const [capability, tier] = key.split(":") as [TaskCapability, Tier];
    const candidates = Array.from(new Set(group.map((sample) => sample.modelId)));
    const ranking = rankModelsFromSamples(candidates, capability, tier, samples);
    if (ranking.adapted) adaptiveRoutes++;
    return { capability, tier, samples: group.length, winner: ranking.modelId, adapted: ranking.adapted, models: ranking.performance };
  }).sort((a, b) => b.samples - a.samples);
  return { ratedDecisions: samples.length, adaptiveRoutes, capabilities };
}

export function routingFeedbackFileExists() { return existsSync(feedbackFile); }

export function resetRoutingFeedback() {
  try { unlinkSync(feedbackFile); } catch {}
  return routingFeedbackSummary();
}
