import { classifyCapability, classifyComplexity, inferProviderPreference, selectRoutedModel, selectRoutedModelWithTrace } from "../lib/local-router";
import { buildPrompt } from "../lib/local-runner";
import { rankModelsFromSamples, type RoutingFeedbackSample } from "../lib/routing-feedback";

process.env.HYZR_CHAT_DISABLE_ADAPTIVE_ROUTING = "1";

const cases = [
  ["Make me a super basic hello world with no styling", "gpt-5.6-luna"],
  ["Restart the existing dev server and verify the port", "gpt-5.4-mini"],
  ["Make a quick animation timing change", "gpt-5.4-mini"],
  ["Build a normal weather web app with an API", "gpt-5.6-terra"],
  ["Design a production-grade distributed architecture end-to-end", "gpt-5.6-sol"],
  ["Debug an ambiguous race condition across the entire large codebase", "claude-fable"],
  ["Use Claude to redesign this website UI", "claude-opus"],
  ["Use Claude for a hello world with no styling", "claude-haiku"],
  ["Use ChatGPT to debug this production-grade distributed race condition", "gpt-5.6-sol"],
] as const;

let failures = 0;
for (const [prompt, expected] of cases) {
  const { capability } = classifyCapability(prompt);
  const complexity = classifyComplexity(prompt);
  const provider = inferProviderPreference(prompt);
  const actual = selectRoutedModel(capability, complexity, undefined, undefined, provider);
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} | ${complexity.padEnd(8)} | ${capability.padEnd(18)} | ${actual.padEnd(16)} | ${prompt}`);
}

const mixed = "User: Make it beautiful. Use Claude for everything besides image generation";
const mixedProvider = inferProviderPreference(mixed);
const codeModel = selectRoutedModel("frontend_design", "standard", undefined, undefined, mixedProvider);
const imageModel = selectRoutedModel("media_generation", "standard", undefined, undefined, mixedProvider);
const mixedOk = codeModel === "claude-opus" && imageModel === "gpt-5.6-terra";
console.log(`${mixedOk ? "PASS" : "FAIL"} | mixed provider constraint | code=${codeModel}, image=${imageModel}`);
if (!mixedOk) failures++;

const huge = Array.from({ length: 80 }, (_, index) => ({ role: index % 2 ? "assistant" as const : "user" as const, content: "x".repeat(8000) }));
const contextLength = buildPrompt(huge).length;
const contextOk = contextLength < 32000;
console.log(`${contextOk ? "PASS" : "FAIL"} | context budget | ${contextLength} chars`);
if (!contextOk) failures++;

const feedback: RoutingFeedbackSample[] = [
  ...Array.from({ length: 4 }, (_, index) => ({ runId: `terra-${index}`, capability: "frontend_design" as const, tier: "standard" as const, modelId: "gpt-5.6-terra", verdict: "needs_work" as const, tokens: 9000, humanEdits: 100, recordedAt: index })),
  ...Array.from({ length: 4 }, (_, index) => ({ runId: `sonnet-${index}`, capability: "frontend_design" as const, tier: "standard" as const, modelId: "claude-sonnet", verdict: "accepted" as const, tokens: 7000, humanEdits: 0, recordedAt: index })),
];
const learned = rankModelsFromSamples(["gpt-5.6-terra", "claude-sonnet"], "frontend_design", "standard", feedback);
const learnedOk = learned.adapted && learned.modelId === "claude-sonnet";
console.log(`${learnedOk ? "PASS" : "FAIL"} | adaptive routing requires evidence and promotes the stronger accepted model`);
if (!learnedOk) failures++;
const sparse = rankModelsFromSamples(["gpt-5.6-terra", "claude-sonnet"], "frontend_design", "standard", feedback.slice(0, 2));
const sparseOk = !sparse.adapted && sparse.modelId === "gpt-5.6-terra";
console.log(`${sparseOk ? "PASS" : "FAIL"} | sparse feedback cannot override the default route`);
if (!sparseOk) failures++;

delete process.env.HYZR_CHAT_DISABLE_ADAPTIVE_ROUTING;
const traced = selectRoutedModelWithTrace("frontend_design", "standard", undefined, undefined, "auto", feedback);
const traceOk = traced.modelId === "claude-sonnet" && traced.trace.adapted && traced.trace.defaultModelId === "gpt-5.6-terra" && traced.trace.sampleCount === 8;
console.log(`${traceOk ? "PASS" : "FAIL"} | decision trace explains an adaptive override without hiding the default`);
if (!traceOk) failures++;
const constrained = selectRoutedModelWithTrace("frontend_design", "standard", undefined, undefined, "claude", feedback);
const constraintOk = constrained.modelId === "claude-opus" && constrained.trace.source === "provider" && /Claude/.test(constrained.trace.reason);
console.log(`${constraintOk ? "PASS" : "FAIL"} | decision trace preserves explicit provider constraints`);
if (!constraintOk) failures++;

if (failures) process.exit(1);
