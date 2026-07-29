import { promises as fs } from "fs";
import path from "path";
import { classifyCapability, classifyComplexity, inferProviderPreference, selectRoutedModel } from "../lib/local-router";
import { LOCAL_MODELS } from "../lib/local-models";
import { runLocal, workspaceFor } from "../lib/local-runner";
import { verifyWorkspace } from "../lib/verifier";
import { saveBenchmarkResult } from "../lib/durable-jobs";
import { BENCHMARK_DATASET, BENCHMARK_DATASET_NAME, benchmarkTokenCeiling } from "../lib/benchmark-engine";
import { tryNativeExecution } from "../lib/native-executor";
import { executionLimits } from "../lib/execution-budget";
import { productEnv } from "../lib/product";
import { STATE_DIRECTORY, WORKSPACE_DIRECTORY } from "../lib/product-paths";

type Case = { id: string; prompt: string; expectedCapability: string; expectedTier: string; assertion?: { file: string; contains: RegExp } };
const dataset: Case[] = BENCHMARK_DATASET.map((test) => ({
  ...test,
  assertion: test.assertion ? { file: test.assertion.file, contains: new RegExp(test.assertion.source, test.assertion.flags) } : undefined,
}));

const live = process.argv.includes("--live") || productEnv("HYZR_CHAT_BENCHMARK_LIVE", "VMX_BENCHMARK_LIVE") === "1";
const premiumModelId = productEnv("HYZR_CHAT_BENCHMARK_PREMIUM_MODEL", "VMX_BENCHMARK_PREMIUM_MODEL") || "gpt-5.6-sol";
const tokenCeiling = benchmarkTokenCeiling();
let pricing: Record<string, { input: number; output: number }> = {};
try { pricing = JSON.parse(productEnv("HYZR_CHAT_MODEL_PRICING_JSON", "VMX_MODEL_PRICING_JSON") || "{}"); } catch {}

function measuredCost(modelId: string, inputTokens: number, outputTokens: number) {
  const price = pricing[modelId];
  return price ? inputTokens / 1_000_000 * price.input + outputTokens / 1_000_000 * price.output : null;
}

async function runCase(test: Case, mode: "hyzr" | "premium") {
  const capability = classifyCapability(test.prompt).capability;
  const tier = classifyComplexity(test.prompt);
  const provider = inferProviderPreference(test.prompt);
  const modelId = mode === "premium" ? premiumModelId : selectRoutedModel(capability, tier, undefined, undefined, provider);
  const routingCorrect = capability === test.expectedCapability && tier === test.expectedTier;
  if (!live) return { id: test.id, mode, capability, tier, modelId, routingCorrect, executed: false };
  const model = LOCAL_MODELS[modelId];
  if (!model) throw new Error(`Unknown benchmark model ${modelId}`);
  const workspaceId = `benchmark-${Date.now()}-${test.id}-${mode}`;
  const workspace = workspaceFor(workspaceId);
  const resolvedRoot = path.resolve(workspace);
  if (!resolvedRoot.startsWith(path.resolve(WORKSPACE_DIRECTORY))) throw new Error("Unsafe benchmark workspace path.");
  await fs.rm(workspace, { recursive: true, force: true });
  await fs.mkdir(workspace, { recursive: true });
  const started = Date.now();
  if (mode === "hyzr") {
    const native = await tryNativeExecution(test.prompt, workspaceId);
    if (native.handled) {
      const verification = await verifyWorkspace(workspaceId);
      let assertionPassed = !test.assertion;
      if (test.assertion) {
        const content = await fs.readFile(path.join(workspace, test.assertion.file), "utf8").catch(() => "");
        assertionPassed = test.assertion.contains.test(content);
      }
      return {
        id: test.id, mode, capability, tier, modelId: "hyzr-native", routingCorrect, executed: true,
        accepted: native.success && verification.passed && assertionPassed,
        inputTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: Date.now() - started,
        error: native.success ? "" : native.summary, assertionPassed, measuredCost: 0,
        checks: verification.checks.map((check) => ({ id: check.id, status: check.status })),
        responseChars: native.summary?.length || 0,
      };
    }
  }
  let inputTokens = 0;
  let outputTokens = 0;
  let response = "";
  let error = "";
  const limits = executionLimits(tier);
  for await (const chunk of runLocal(model.engine, model.model, test.prompt, {
    workspaceId,
    effort: tier === "hard" ? "high" : tier === "standard" ? "medium" : "low",
    noReveal: true,
    maxAttempts: 1,
    maxDurationMs: limits.maxDurationMs,
    maxActivityEvents: limits.maxActivityEvents,
  })) {
    if (chunk.type === "text") response += chunk.text || "";
    if (chunk.type === "usage") { inputTokens += chunk.inputTokens || 0; outputTokens += chunk.outputTokens || 0; }
    if (chunk.type === "error") error = chunk.message || "Model failed";
  }
  const verification = await verifyWorkspace(workspaceId);
  let assertionPassed = !test.assertion;
  if (test.assertion) {
    const content = await fs.readFile(path.join(workspace, test.assertion.file), "utf8").catch(() => "");
    assertionPassed = test.assertion.contains.test(content);
  }
  return {
    id: test.id, mode, capability, tier, modelId, routingCorrect, executed: true,
    accepted: !error && verification.passed && assertionPassed,
    inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
    latencyMs: Date.now() - started, error, assertionPassed,
    measuredCost: measuredCost(modelId, inputTokens, outputTokens),
    checks: verification.checks.map((check) => ({ id: check.id, status: check.status })),
    responseChars: response.length,
  };
}

async function main() {
  const results = [];
  let ceilingReached = false;
  for (const test of dataset) {
    results.push(await runCase(test, "hyzr"));
    if (live && results.reduce((total, result: any) => total + (result.totalTokens || 0), 0) >= tokenCeiling) { ceilingReached = true; break; }
    results.push(await runCase(test, "premium"));
    if (live && results.reduce((total, result: any) => total + (result.totalTokens || 0), 0) >= tokenCeiling) { ceilingReached = true; break; }
  }
  const executed = results.filter((result: any) => result.executed) as any[];
  const summary = live ? Object.fromEntries(["hyzr", "premium"].map((mode) => {
    const group = executed.filter((result) => result.mode === mode);
    const accepted = group.filter((result) => result.accepted);
    const tokens = accepted.reduce((total, result) => total + result.totalTokens, 0);
    const priced = accepted.filter((result) => result.measuredCost != null);
    return [mode, {
      runs: group.length,
      accepted: accepted.length,
      successRate: group.length ? accepted.length / group.length : null,
      tokensPerAcceptedTask: accepted.length ? tokens / accepted.length : null,
      costPerAcceptedTask: accepted.length && priced.length === accepted.length ? priced.reduce((total, result) => total + result.measuredCost, 0) / accepted.length : null,
      medianLatencyMs: group.length ? group.map((result) => result.latencyMs).sort((a, b) => a - b)[Math.floor(group.length / 2)] : null,
    }];
  })) : {
    note: "Routing-only dry run. No success-rate, token, or cost claim is produced until --live executes both arms.",
    routingAccuracy: results.filter((result: any) => result.mode === "hyzr" && result.routingCorrect).length / dataset.length,
  };
  const report = { id: `benchmark-${Date.now()}`, createdAt: new Date().toISOString(), live, premiumModelId, dataset: BENCHMARK_DATASET_NAME, tokenCeiling, ceilingReached, summary, results };
  const directory = path.join(STATE_DIRECTORY, "benchmarks");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(path.join(directory, `${report.id}.json`), JSON.stringify(report, null, 2));
  saveBenchmarkResult(report.id, live ? "live" : "dry", report.dataset, report);
  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => { console.error(error); process.exit(1); });
