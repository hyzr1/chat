import type { TaskCapability, Tier } from "./local-models";

export interface RoutingFeedbackSample {
  runId: string;
  capability: TaskCapability;
  tier: Tier;
  modelId: string;
  verdict: "accepted" | "needs_work" | "regressed";
  tokens: number;
  humanEdits: number;
  recordedAt: number;
}

export interface LearnedModelPerformance {
  modelId: string;
  attempts: number;
  accepted: number;
  successRate: number;
  averageTokens: number | null;
  averageHumanEdits: number | null;
  score: number;
}

export function rankModelsFromSamples(candidates: string[], capability: TaskCapability, tier: Tier, samples: RoutingFeedbackSample[]) {
  const matching = samples.filter((sample) => sample.capability === capability && sample.tier === tier && candidates.includes(sample.modelId));
  const performance: LearnedModelPerformance[] = candidates.map((modelId) => {
    const modelSamples = matching.filter((sample) => sample.modelId === modelId);
    const accepted = modelSamples.filter((sample) => sample.verdict === "accepted").length;
    const attempts = modelSamples.length;
    const successRate = attempts ? accepted / attempts : 0;
    const averageTokens = attempts ? modelSamples.reduce((total, sample) => total + sample.tokens, 0) / attempts : null;
    const edited = modelSamples.filter((sample) => sample.humanEdits > 0);
    const averageHumanEdits = edited.length ? edited.reduce((total, sample) => total + sample.humanEdits, 0) / edited.length : null;
    return { modelId, attempts, accepted, successRate, averageTokens, averageHumanEdits, score: 0 };
  });
  const evidenced = performance.filter((model) => model.attempts >= 2);
  const enoughEvidence = matching.length >= 6 && evidenced.length >= 2;
  const tokenValues = evidenced.map((model) => model.averageTokens || 0).filter(Boolean);
  const maxTokens = Math.max(...tokenValues, 1);
  for (const model of performance) {
    const quality = (model.accepted + 2) / (model.attempts + 3); // conservative Bayesian prior
    const efficiency = model.averageTokens ? Math.max(0, 1 - model.averageTokens / maxTokens) : 0;
    const editPenalty = model.averageHumanEdits == null ? 0 : Math.min(.15, model.averageHumanEdits / 1000);
    model.score = quality * .88 + efficiency * .12 - editPenalty;
  }
  const ranked = enoughEvidence
    ? [...performance].sort((a, b) => (b.attempts >= 2 ? b.score : -1) - (a.attempts >= 2 ? a.score : -1) || candidates.indexOf(a.modelId) - candidates.indexOf(b.modelId))
    : performance;
  const original = performance[0];
  const winner = ranked[0];
  const shouldAdapt = enoughEvidence && winner.modelId !== original.modelId && winner.score >= original.score + .05;
  return { modelId: shouldAdapt ? winner.modelId : candidates[0], adapted: shouldAdapt, matchingSamples: matching.length, performance };
}
