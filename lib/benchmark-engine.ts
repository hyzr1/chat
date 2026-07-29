import { promises as fs } from "fs";
import os from "os";
import path from "path";
import {
  claimBenchmarkJob,
  finishBenchmarkJob,
  getBenchmarkJob,
  heartbeatBenchmarkJob,
  recoverExpiredBenchmarkJobs,
  saveBenchmarkResult,
  updateBenchmarkProgress,
  type BenchmarkJob,
} from "./durable-jobs";
import { classifyCapability, classifyComplexity, inferProviderPreference, selectRoutedModel } from "./local-router";
import { LOCAL_MODELS } from "./local-models";
import { runLocal, workspaceFor } from "./local-runner";
import { verifyWorkspace } from "./verifier";
import { tryNativeExecution } from "./native-executor";
import { STATE_DIRECTORY, WORKSPACE_DIRECTORY } from "./product-paths";
import { productEnv } from "./product";
import { executionLimits } from "./execution-budget";

export type BenchmarkCase = {
  id: string;
  prompt: string;
  expectedCapability: string;
  expectedTier: string;
  assertion?: { file: string; source: string; flags?: string };
};

export type BenchmarkCaseResult = {
  id: string;
  trial: number;
  mode: "hyzr" | "premium";
  capability: string;
  tier: string;
  modelId: string;
  routingCorrect: boolean;
  executed: boolean;
  accepted?: boolean;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs?: number;
  error?: string;
  assertionPassed?: boolean;
  measuredCost?: number | null;
  checks?: Array<{ id: string; status: string }>;
  responseChars?: number;
};

export type BenchmarkReport = {
  id: string;
  createdAt: string;
  live: boolean;
  premiumModelId: string;
  dataset: string;
  trials: number;
  tokenCeiling: number;
  summary?: Record<string, unknown>;
  results: BenchmarkCaseResult[];
};

export const DEFAULT_BENCHMARK_TOKEN_CEILING = 120_000;

export function benchmarkTokenCeiling() {
  const configured = Number(productEnv("HYZR_CHAT_BENCHMARK_TOKEN_CEILING", "VMX_BENCHMARK_TOKEN_CEILING"));
  return Number.isFinite(configured) && configured >= 10_000
    ? Math.floor(configured)
    : DEFAULT_BENCHMARK_TOKEN_CEILING;
}

export const BENCHMARK_DATASET_NAME = "hyzr-chat-foundation-v1";
export const BENCHMARK_DATASET: BenchmarkCase[] = [
  { id: "hello-html", prompt: "Create a bare hello world index.html with no styling and no JavaScript.", expectedCapability: "new_code", expectedTier: "trivial", assertion: { file: "index.html", source: "hello world", flags: "i" } },
  { id: "server-restart", prompt: "Restart the existing dev server and verify that its port responds.", expectedCapability: "computer_use", expectedTier: "trivial" },
  { id: "weather-app", prompt: "Build a responsive weather app with API loading, empty, error and success states.", expectedCapability: "frontend_design", expectedTier: "standard", assertion: { file: "index.html", source: "weather", flags: "i" } },
  { id: "bug-review", prompt: "Debug an intermittent race condition in a large existing codebase, add regression tests, and explain the root cause.", expectedCapability: "debugging", expectedTier: "hard" },
  { id: "architecture", prompt: "Design a production-grade distributed job system with leases, idempotency, retries, audit events and disaster recovery.", expectedCapability: "architecture", expectedTier: "hard" },
  { id: "claude-preference", prompt: "Use Claude only to implement a normal settings page with accessible controls.", expectedCapability: "frontend_design", expectedTier: "standard" },
  { id: "image-specialist", prompt: "Generate a beautiful original background image for a landing page.", expectedCapability: "media_generation", expectedTier: "standard" },
  { id: "bulk-rename", prompt: "Quickly rename a misspelled variable across the project and update its references.", expectedCapability: "fast_high_volume", expectedTier: "trivial" },
];

type BenchmarkWorkerHandle = { running: boolean; generation: object; wake?: () => void };
const runtime = globalThis as typeof globalThis & {
  __hyzrBenchmarkWorker?: BenchmarkWorkerHandle;
  __hyzrBenchmarkAbort?: Map<string, AbortController>;
};
const moduleGeneration = {};
const workerId = `benchmark:${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;
runtime.__hyzrBenchmarkAbort ??= new Map();

function pricing() {
  try { return JSON.parse(productEnv("HYZR_CHAT_MODEL_PRICING_JSON", "VMX_MODEL_PRICING_JSON") || "{}") as Record<string, { input: number; output: number }>; }
  catch { return {}; }
}

function measuredCost(modelId: string, inputTokens: number, outputTokens: number) {
  const price = pricing()[modelId];
  return price ? inputTokens / 1_000_000 * price.input + outputTokens / 1_000_000 * price.output : null;
}

async function runCase(test: BenchmarkCase, mode: "hyzr" | "premium", trial: number, job: BenchmarkJob<BenchmarkReport>, signal: AbortSignal): Promise<BenchmarkCaseResult> {
  const capability = classifyCapability(test.prompt).capability;
  const tier = classifyComplexity(test.prompt);
  const provider = inferProviderPreference(test.prompt);
  const modelId = mode === "premium" ? job.premiumModelId : selectRoutedModel(capability, tier, undefined, undefined, provider);
  const routingCorrect = capability === test.expectedCapability && tier === test.expectedTier;
  if (job.mode === "dry") return { id: test.id, trial, mode, capability, tier, modelId, routingCorrect, executed: false };
  const model = LOCAL_MODELS[modelId];
  if (!model) throw new Error(`Unknown benchmark model ${modelId}`);
  const workspaceId = `benchmark-${job.id}-${test.id}-${mode}`;
  const workspace = workspaceFor(workspaceId);
  const safeRoot = path.resolve(WORKSPACE_DIRECTORY);
  if (!path.resolve(workspace).startsWith(`${safeRoot}${path.sep}`)) throw new Error("Unsafe benchmark workspace path.");
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
        assertionPassed = new RegExp(test.assertion.source, test.assertion.flags).test(content);
      }
      return {
        id: test.id, trial, mode, capability, tier, modelId: "hyzr-native", routingCorrect, executed: true,
        accepted: native.success && verification.passed && assertionPassed,
        inputTokens: 0, outputTokens: 0, totalTokens: 0, latencyMs: Date.now() - started,
        assertionPassed, measuredCost: 0,
        checks: verification.checks.map((check) => ({ id: check.id, status: check.status })),
        responseChars: native.summary?.length || 0,
        ...(!native.success ? { error: native.summary } : {}),
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
    signal,
    maxAttempts: 1,
    maxDurationMs: limits.maxDurationMs,
    maxActivityEvents: limits.maxActivityEvents,
  })) {
    if (chunk.type === "text") response += chunk.text || "";
    if (chunk.type === "usage") { inputTokens += chunk.inputTokens || 0; outputTokens += chunk.outputTokens || 0; }
    if (chunk.type === "error") error = chunk.message || "Model failed";
  }
  if (signal.aborted) throw new Error("Benchmark cancelled");
  const verification = await verifyWorkspace(workspaceId);
  let assertionPassed = !test.assertion;
  if (test.assertion) {
    const content = await fs.readFile(path.join(workspace, test.assertion.file), "utf8").catch(() => "");
    assertionPassed = new RegExp(test.assertion.source, test.assertion.flags).test(content);
  }
  return {
    id: test.id,
    trial,
    mode,
    capability,
    tier,
    modelId,
    routingCorrect,
    executed: true,
    accepted: !error && verification.passed && assertionPassed,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    latencyMs: Date.now() - started,
    error,
    assertionPassed,
    measuredCost: measuredCost(modelId, inputTokens, outputTokens),
    checks: verification.checks.map((check) => ({ id: check.id, status: check.status })),
    responseChars: response.length,
  };
}

function median(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function wilsonInterval(accepted: number, total: number) {
  if (!total) return null;
  const z = 1.96;
  const p = accepted / total;
  const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const margin = z * Math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator;
  return { low: Math.max(0, center - margin), high: Math.min(1, center + margin) };
}

export function summarizeBenchmark(report: BenchmarkReport) {
  if (!report.live) return {
    note: "Routing-only dry run. No success-rate, token, or cost claim is produced until a live paired benchmark executes both arms.",
    routingAccuracy: report.results.filter((result) => result.mode === "hyzr" && result.routingCorrect).length / (BENCHMARK_DATASET.length * report.trials),
  };
  return Object.fromEntries((["hyzr", "premium"] as const).map((mode) => {
    const group = report.results.filter((result) => result.mode === mode && result.executed);
    const accepted = group.filter((result) => result.accepted);
    const tokens = accepted.reduce((total, result) => total + (result.totalTokens || 0), 0);
    const priced = accepted.filter((result) => result.measuredCost != null);
    return [mode, {
      runs: group.length,
      accepted: accepted.length,
      successRate: group.length ? accepted.length / group.length : null,
      successRateInterval: wilsonInterval(accepted.length, group.length),
      tokensPerAcceptedTask: accepted.length ? tokens / accepted.length : null,
      costPerAcceptedTask: accepted.length && priced.length === accepted.length ? priced.reduce((total, result) => total + (result.measuredCost || 0), 0) / accepted.length : null,
      medianLatencyMs: median(group.map((result) => result.latencyMs || 0)),
    }];
  }));
}

export async function executeBenchmarkJob(job: BenchmarkJob<BenchmarkReport>) {
  const controller = new AbortController();
  runtime.__hyzrBenchmarkAbort!.set(job.id, controller);
  const heartbeat = setInterval(() => heartbeatBenchmarkJob(job.id, workerId), 15_000);
  heartbeat.unref?.();
  const existing = job.result?.results ? job.result : undefined;
  const report: BenchmarkReport = existing ?? {
    id: job.id,
    createdAt: new Date(job.createdAt).toISOString(),
    live: job.mode === "live",
    premiumModelId: job.premiumModelId,
    dataset: job.dataset,
    trials: Number(job.result?.trials) || 1,
    tokenCeiling: Number(job.result?.tokenCeiling) || benchmarkTokenCeiling(),
    results: [],
  };
  report.trials = Math.max(1, Number(report.trials) || 1);
  report.tokenCeiling = Math.max(10_000, Number(report.tokenCeiling) || benchmarkTokenCeiling());
  try {
    const totalRuns = BENCHMARK_DATASET.length * 2 * report.trials;
    for (let index = report.results.length; index < totalRuns; index++) {
      const persisted = getBenchmarkJob(job.id);
      if (persisted?.status === "cancelled" || controller.signal.aborted) throw new Error("Benchmark cancelled");
      const trial = Math.floor(index / (BENCHMARK_DATASET.length * 2)) + 1;
      const test = BENCHMARK_DATASET[Math.floor((index % (BENCHMARK_DATASET.length * 2)) / 2)];
      const mode = index % 2 === 0 ? "hyzr" : "premium";
      report.results.push(await runCase(test, mode, trial, job, controller.signal));
      report.summary = summarizeBenchmark(report);
      updateBenchmarkProgress(job.id, report.results.length, report);
      const usedTokens = report.results.reduce((total, result) => total + (result.totalTokens || 0), 0);
      if (report.live && usedTokens >= report.tokenCeiling) {
        throw new Error(`Evaluation token ceiling reached (${usedTokens.toLocaleString()} / ${report.tokenCeiling.toLocaleString()} tokens). Partial evidence was saved; raise HYZR_CHAT_BENCHMARK_TOKEN_CEILING only after reviewing it.`);
      }
    }
    report.summary = summarizeBenchmark(report);
    saveBenchmarkResult(report.id, job.mode, report.dataset, report);
    const directory = path.join(STATE_DIRECTORY, "benchmarks");
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, `${report.id}.json`), JSON.stringify(report, null, 2));
    finishBenchmarkJob(job.id, "completed", report);
  } catch (error: any) {
    const cancelled = getBenchmarkJob(job.id)?.status === "cancelled" || controller.signal.aborted || /cancelled/i.test(String(error?.message));
    finishBenchmarkJob(job.id, cancelled ? "cancelled" : "failed", report, cancelled ? "Stopped by the user." : String(error?.message || error));
  } finally {
    clearInterval(heartbeat);
    runtime.__hyzrBenchmarkAbort!.delete(job.id);
  }
}

async function waitForWork(milliseconds: number, worker: BenchmarkWorkerHandle) {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
    worker.wake = () => { clearTimeout(timer); resolve(); };
  });
}

async function loop(worker: BenchmarkWorkerHandle) {
  recoverExpiredBenchmarkJobs();
  while (worker.running && runtime.__hyzrBenchmarkWorker === worker) {
    const job = claimBenchmarkJob(workerId);
    if (!job) { await waitForWork(1200, worker); continue; }
    await executeBenchmarkJob(job as BenchmarkJob<BenchmarkReport>);
  }
}

export function ensureBenchmarkWorker() {
  if (runtime.__hyzrBenchmarkWorker?.running && runtime.__hyzrBenchmarkWorker.generation === moduleGeneration) {
    runtime.__hyzrBenchmarkWorker.wake?.();
    return;
  }
  const previous = runtime.__hyzrBenchmarkWorker;
  if (previous) {
    previous.running = false;
    previous.wake?.();
  }
  const worker: BenchmarkWorkerHandle = { running: true, generation: moduleGeneration };
  runtime.__hyzrBenchmarkWorker = worker;
  void loop(worker).catch((error) => {
    console.error("Hyzr Chat benchmark worker stopped unexpectedly", error);
    if (runtime.__hyzrBenchmarkWorker === worker) worker.running = false;
  });
}

export function wakeBenchmarkWorker() {
  ensureBenchmarkWorker();
  runtime.__hyzrBenchmarkWorker?.wake?.();
}

export function abortBenchmarkJob(id: string) {
  runtime.__hyzrBenchmarkAbort?.get(id)?.abort(new Error("Benchmark cancelled"));
}
