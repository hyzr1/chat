import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import type { DeliveryContract } from "./delivery-contract";
import { recordRoutingOutcome, routingFeedbackSummary } from "./routing-feedback-store";
import { STATE_DIRECTORY } from "./product-paths";

export type RunEvent = Record<string, unknown> & { seq: number };

export interface RunRecord {
  sessionId: string;
  workspaceId: string;
  events: RunEvent[];
  nextSeq: number;
  active: boolean;
  done: boolean;
  createdAt: number;
  updatedAt: number;
  abort: AbortController;
  contract?: DeliveryContract;
  checkpoint?: { taskIndex: number; taskTitle: string; completedAt: number };
  outcome?: RunOutcome;
  attempt: number;
  heartbeatAt: number;
  leaseExpiresAt: number;
  workerId: string;
}

export interface RunOutcome {
  verdict: "accepted" | "needs_work" | "regressed";
  humanEdits?: number;
  note?: string;
  recordedAt: number;
}

export type RunSummaryStatus = "running" | "completed" | "needs_attention" | "stopped";

export interface RunSummary {
  id: string;
  workspaceId: string;
  title: string;
  status: RunSummaryStatus;
  createdAt: number;
  updatedAt: number;
  completedTasks: number;
  totalTasks: number;
  models: string[];
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  latestActivity: string;
  estimatedCost: number | null;
  baselineCost: number | null;
  tokenBudget: number | null;
  budgetRemaining: number | null;
  budgetUtilization: number | null;
  budgetState: "healthy" | "warning" | "exhausted" | null;
  computeUnits: number;
  providerCalls: number;
  nativeOperations: number;
  skillActivations: number;
  contextCharactersAvoided: number;
  contextReductionRate: number;
  outcome?: RunOutcome;
  contract?: Pick<DeliveryContract, "id" | "objective" | "acceptanceCriteria" | "evidence" | "source" | "budget">;
}

export interface RunAnalytics {
  totalRuns: number;
  ratedRuns: number;
  acceptedRuns: number;
  successRate: number | null;
  tokensPerAcceptedTask: number | null;
  costPerAcceptedTask: number | null;
  baselineCostPerAcceptedTask: number | null;
  savingsRate: number | null;
  ratedModelDecisions: number;
  adaptiveRoutes: number;
  nativeOperations: number;
  avoidedProviderCalls: number;
}

const globalRuns = globalThis as typeof globalThis & { __hyzrChatRuns?: Map<string, RunRecord>; __hyzrChatActiveWorkspaceRuns?: Map<string, string>; __hyzrChatRunPersistTimers?: Map<string, ReturnType<typeof setTimeout>>; __hyzrChatLeaseTimers?: Map<string, ReturnType<typeof setInterval>> };
const runs: Map<string, RunRecord> = globalRuns.__hyzrChatRuns ?? (globalRuns.__hyzrChatRuns = new Map<string, RunRecord>());
const activeWorkspaceRuns = globalRuns.__hyzrChatActiveWorkspaceRuns ?? (globalRuns.__hyzrChatActiveWorkspaceRuns = new Map<string, string>());
const persistTimers = globalRuns.__hyzrChatRunPersistTimers ?? (globalRuns.__hyzrChatRunPersistTimers = new Map());
const leaseTimers = globalRuns.__hyzrChatLeaseTimers ?? (globalRuns.__hyzrChatLeaseTimers = new Map());
const runDirectory = path.join(STATE_DIRECTORY, "runs");

function runFile(id: string) {
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 100) || "invalid";
  return path.join(runDirectory, `${safe}.json`);
}

function persistRun(run: RunRecord) {
  try {
    mkdirSync(runDirectory, { recursive: true });
    const file = runFile(run.sessionId);
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, JSON.stringify({
      sessionId: run.sessionId,
      workspaceId: run.workspaceId,
      events: run.events,
      nextSeq: run.nextSeq,
      active: run.active,
      done: run.done,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
      contract: run.contract,
      checkpoint: run.checkpoint,
      outcome: run.outcome,
      attempt: run.attempt,
      heartbeatAt: run.heartbeatAt,
      leaseExpiresAt: run.leaseExpiresAt,
      workerId: run.workerId,
    }), "utf8");
    renameSync(temporary, file);
  } catch {}
}

function schedulePersist(run: RunRecord, immediate = false) {
  const previous = persistTimers.get(run.sessionId);
  if (previous) clearTimeout(previous);
  if (immediate) {
    persistTimers.delete(run.sessionId);
    persistRun(run);
    return;
  }
  const timer = setTimeout(() => {
    persistTimers.delete(run.sessionId);
    persistRun(run);
  }, 600);
  timer.unref?.();
  persistTimers.set(run.sessionId, timer);
}

function hydrateRun(id: string): RunRecord | undefined {
  try {
    const file = runFile(id);
    if (!existsSync(file)) return undefined;
    const stored = JSON.parse(readFileSync(file, "utf8"));
    if (!stored || stored.sessionId !== id || !Array.isArray(stored.events)) return undefined;
    const wasInterrupted = Boolean(stored.active && !stored.done);
    const events = stored.events.slice(-4000) as RunEvent[];
    let nextSeq = Math.max(Number(stored.nextSeq) || 1, ...events.map((event) => Number(event.seq) + 1));
    if (wasInterrupted) {
      const checkpoint = stored.checkpoint?.taskTitle ? ` from “${stored.checkpoint.taskTitle}”` : "";
      events.push({ type: "activity", label: `Hyzr Chat recovered this job after a server restart and will resume${checkpoint}.`, idempotencyKey: `restart-recovery:${Number(stored.attempt) || 1}`, runId: id, seq: nextSeq++ });
    }
    const run: RunRecord = {
      sessionId: id,
      workspaceId: String(stored.workspaceId || id),
      events,
      nextSeq,
      active: false,
      done: wasInterrupted ? false : Boolean(stored.done),
      createdAt: Number(stored.createdAt) || Number(stored.updatedAt) || Date.now(),
      updatedAt: Number(stored.updatedAt) || Date.now(),
      abort: new AbortController(),
      contract: stored.contract,
      checkpoint: stored.checkpoint,
      outcome: stored.outcome,
      attempt: Number(stored.attempt) || 1,
      heartbeatAt: Number(stored.heartbeatAt) || Number(stored.updatedAt) || Date.now(),
      leaseExpiresAt: Number(stored.leaseExpiresAt) || Number(stored.updatedAt) || Date.now(),
      workerId: String(stored.workerId || "recovered"),
    };
    runs.set(id, run);
    if (wasInterrupted) schedulePersist(run, true);
    return run;
  } catch {
    return undefined;
  }
}

function prune() {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, run] of runs) if (!run.active && run.updatedAt < cutoff) runs.delete(id);
}

export function beginRun(runId: string, workspaceId = runId) {
  prune();
  const existing = getRun(runId);
  if (existing?.active && existing.workspaceId === workspaceId) return existing;
  const previousId = activeWorkspaceRuns.get(workspaceId);
  if (previousId && previousId !== runId) cancelRun(previousId);
  runs.get(runId)?.abort.abort();
  const now = Date.now();
  const resuming = Boolean(existing && !existing.done && existing.workspaceId === workspaceId);
  const run: RunRecord = { sessionId: runId, workspaceId, events: resuming ? existing!.events : [], nextSeq: resuming ? existing!.nextSeq : 1, active: true, done: false, createdAt: resuming ? existing!.createdAt : now, updatedAt: now, abort: new AbortController(), contract: resuming ? existing!.contract : undefined, checkpoint: resuming ? existing!.checkpoint : undefined, outcome: resuming ? existing!.outcome : undefined, attempt: (existing?.attempt || 0) + 1, heartbeatAt: now, leaseExpiresAt: now + 45_000, workerId: `${os.hostname()}:${process.pid}` };
  runs.set(runId, run);
  activeWorkspaceRuns.set(workspaceId, runId);
  const previousLease = leaseTimers.get(runId);
  if (previousLease) clearInterval(previousLease);
  const lease = setInterval(() => {
    const current = runs.get(runId);
    if (!current?.active) { clearInterval(lease); leaseTimers.delete(runId); return; }
    current.heartbeatAt = Date.now();
    current.leaseExpiresAt = current.heartbeatAt + 45_000;
    schedulePersist(current);
  }, 10_000);
  lease.unref?.();
  leaseTimers.set(runId, lease);
  schedulePersist(run, true);
  return run;
}

export function appendRunEvent(sessionId: string, payload: Record<string, unknown>) {
  const run = runs.get(sessionId);
  if (!run) return { ...payload, seq: 0 } as RunEvent;
  const idempotencyKey = String(payload.idempotencyKey || (["plan", "contract", "repository_map", "context_optimization", "skill_activation", "workspace_handoff", "task_evidence", "task_start", "task_done", "verification_start", "verification_complete", "done", "needs_attention"].includes(String(payload.type)) ? `${payload.type}:${payload.taskIndex ?? payload.index ?? "run"}` : ""));
  if (idempotencyKey) {
    const existing = run.events.find((candidate) => candidate.idempotencyKey === idempotencyKey);
    if (existing) return existing;
  }
  const event = { ...payload, ...(idempotencyKey ? { idempotencyKey } : {}), runId: sessionId, seq: run.nextSeq++ } as RunEvent;
  run.events.push(event);
  if (run.events.length > 4000) run.events.splice(0, run.events.length - 4000);
  run.updatedAt = Date.now();
  run.heartbeatAt = run.updatedAt;
  run.leaseExpiresAt = run.heartbeatAt + 45_000;
  if (payload.type === "task_done") {
    run.checkpoint = {
      taskIndex: Number(payload.index) || 0,
      taskTitle: String(payload.title || "Completed task"),
      completedAt: run.updatedAt,
    };
  }
  if (payload.type === "done" || payload.type === "error" || payload.type === "needs_attention") {
    run.active = false;
    run.done = true;
  }
  schedulePersist(run, run.done);
  return event;
}

export function finishRun(sessionId: string) {
  const run = runs.get(sessionId);
  if (run) {
    run.active = false; run.done = true; run.updatedAt = Date.now();
    if (activeWorkspaceRuns.get(run.workspaceId) === sessionId) activeWorkspaceRuns.delete(run.workspaceId);
    schedulePersist(run, true);
    const lease = leaseTimers.get(sessionId);
    if (lease) clearInterval(lease);
    leaseTimers.delete(sessionId);
  }
}

export function configureRun(sessionId: string, values: { contract?: DeliveryContract }) {
  const run = getRun(sessionId);
  if (!run) return undefined;
  if (values.contract) run.contract = values.contract;
  run.updatedAt = Date.now();
  run.heartbeatAt = run.updatedAt;
  schedulePersist(run, true);
  return run;
}

export function recordRunOutcome(sessionId: string, outcome: Omit<RunOutcome, "recordedAt">) {
  const run = getRun(sessionId);
  if (!run) return undefined;
  run.outcome = { ...outcome, recordedAt: Date.now() };
  recordRoutingOutcome(sessionId, run.events, run.outcome);
  run.updatedAt = Date.now();
  schedulePersist(run, true);
  return summarizeRun(run);
}

export function getRun(sessionId: string): RunRecord | undefined { return runs.get(sessionId) ?? hydrateRun(sessionId); }

function eventText(event: RunEvent | undefined) {
  if (!event) return "Waiting to start";
  if (event.type === "task_start") return String(event.title || "Specialist started");
  if (event.type === "task_done") return String(event.title || "Specialist completed");
  if (event.type === "planner_status") return String(event.text || "Planning the work");
  if (event.type === "activity") return String(event.label || event.text || "Working");
  if (event.type === "error") return String(event.message || "Needs attention");
  if (event.type === "needs_attention") return String(event.message || "Verification needs attention");
  if (event.type === "verification_start") return "Running delivery checks";
  if (event.type === "verification_result") return String((event.check as any)?.label || "Verification result");
  if (event.type === "done") return "Delivered final result";
  return String(event.text || event.title || "Working");
}

function summarizeRun(run: RunRecord): RunSummary {
  const planEvent = run.events.find((event) => event.type === "plan") as (RunEvent & { plan?: { intent?: string; subtasks?: unknown[] } }) | undefined;
  const taskStarts = run.events.filter((event) => event.type === "task_start");
  const taskDone = run.events.filter((event) => event.type === "task_done");
  const finalEvent = [...run.events].reverse().find((event) => event.type === "done" || event.type === "error" || event.type === "needs_attention");
  const stopped = finalEvent?.type === "error" && /run stopped/i.test(String(finalEvent.message || ""));
  const status: RunSummaryStatus = run.active
    ? "running"
    : stopped
      ? "stopped"
        : finalEvent?.type === "done"
        ? "completed"
        : "needs_attention";
  const models = Array.from(new Set(run.events
    .filter((event) => event.type === "task_start" || event.type === "route")
    .map((event) => String(event.modelLabel || event.model || ""))
    .filter(Boolean)));
  const usageEvents = run.events.filter((event) => event.type === "usage");
  const nativeOperations = run.events.filter((event) => event.type === "native_execution").length;
  const contextEvent = [...run.events].reverse().find((event) => event.type === "context_optimization");
  const latestBudget = [...run.events].reverse().find((event) => event.type === "budget_update" || event.type === "budget_exceeded");
  // A route and its task_start describe the same execution. Count only task
  // starts when present so the dashboard never doubles displayed compute.
  const computeEvents = taskStarts.length ? taskStarts : run.events.filter((event) => event.type === "route");
  const computeUnits = computeEvents.reduce((total, event) => {
    if (event.provider === "hyzr" || event.modelId === "hyzr-native" || event.provider === "vmx" || event.modelId === "vmx-native") return total;
    const tier = String(event.tier || "standard");
    return total + (tier === "hard" ? 4 : tier === "trivial" ? 1 : 2);
  }, 0);
  const hasEstimatedCost = usageEvents.some((event) => Number.isFinite(Number(event.routedCost)));
  const hasBaselineCost = usageEvents.some((event) => Number.isFinite(Number(event.baselineCost)));
  const estimatedCost = hasEstimatedCost ? usageEvents.reduce((total, event) => total + (Number(event.routedCost) || 0), 0) : null;
  const baselineCost = hasBaselineCost ? usageEvents.reduce((total, event) => total + (Number(event.baselineCost) || 0), 0) : null;
  const totalTokens = usageEvents.reduce((total, event) => total + (Number(event.totalTokens) || (Number(event.inputTokens) || 0) + (Number(event.outputTokens) || 0)), 0);
  const latestMeaningful = [...run.events].reverse().find((event) => !["content", "usage"].includes(String(event.type)));
  return {
    id: run.sessionId,
    workspaceId: run.workspaceId,
    title: String(planEvent?.plan?.intent || taskStarts[0]?.title || "Untitled task"),
    status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    completedTasks: taskDone.length,
    totalTasks: Math.max(taskStarts.length, planEvent?.plan?.subtasks?.length || 0, status === "completed" ? 1 : 0),
    models,
    inputTokens: usageEvents.reduce((total, event) => total + (Number(event.inputTokens) || 0), 0),
    outputTokens: usageEvents.reduce((total, event) => total + (Number(event.outputTokens) || 0), 0),
    cacheReadTokens: usageEvents.reduce((total, event) => total + (Number(event.cacheReadTokens) || 0), 0),
    cacheCreationTokens: usageEvents.reduce((total, event) => total + (Number(event.cacheCreationTokens) || 0), 0),
    totalTokens,
    latestActivity: eventText(latestMeaningful),
    estimatedCost,
    baselineCost,
    tokenBudget: latestBudget ? Number(latestBudget.tokenBudget) : run.contract?.budget.tokenBudget ?? null,
    budgetRemaining: latestBudget ? Number(latestBudget.remainingTokens) : run.contract ? Math.max(0, run.contract.budget.tokenBudget - totalTokens) : null,
    budgetUtilization: latestBudget ? Number(latestBudget.utilization) : run.contract ? totalTokens / Math.max(1, run.contract.budget.tokenBudget) : null,
    budgetState: latestBudget && ["healthy", "warning", "exhausted"].includes(String(latestBudget.state)) ? latestBudget.state as RunSummary["budgetState"] : run.contract ? (totalTokens >= run.contract.budget.tokenBudget ? "exhausted" : totalTokens >= run.contract.budget.tokenBudget * .8 ? "warning" : "healthy") : null,
    computeUnits,
    providerCalls: usageEvents.length,
    nativeOperations,
    skillActivations: run.events.filter((event) => event.type === "skill_activation").length,
    contextCharactersAvoided: Number(contextEvent?.avoidedCharacters) || 0,
    contextReductionRate: Number(contextEvent?.reductionRate) || 0,
    outcome: run.outcome,
    contract: run.contract ? {
      id: run.contract.id,
      objective: run.contract.objective,
      acceptanceCriteria: run.contract.acceptanceCriteria,
      evidence: run.contract.evidence,
      source: run.contract.source,
      budget: run.contract.budget,
    } : undefined,
  };
}

export function listRuns(limit = 80): RunSummary[] {
  try {
    if (existsSync(runDirectory)) {
      const files = readdirSync(runDirectory)
        .filter((file) => file.endsWith(".json"))
        .map((file) => ({ file, modified: statSync(path.join(runDirectory, file)).mtimeMs }))
        .sort((a, b) => b.modified - a.modified)
        .slice(0, Math.max(limit, 100));
      for (const { file } of files) {
        const id = file.slice(0, -5);
        if (!runs.has(id)) hydrateRun(id);
      }
    }
  } catch {}
  return Array.from(runs.values())
    .map(summarizeRun)
    .sort((a, b) => (a.status === "running" ? -1 : 0) - (b.status === "running" ? -1 : 0) || b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

export function runAnalytics(limit = 500): RunAnalytics {
  const summaries = listRuns(limit).filter((run) => run.status === "completed");
  const rated = summaries.filter((run) => run.outcome);
  const accepted = rated.filter((run) => run.outcome?.verdict === "accepted");
  const acceptedTokens = accepted.reduce((total, run) => total + run.inputTokens + run.outputTokens, 0);
  const routedCost = accepted.reduce((total, run) => total + (run.estimatedCost || 0), 0);
  const baselineCost = accepted.reduce((total, run) => total + (run.baselineCost || 0), 0);
  const learned = routingFeedbackSummary();
  return {
    totalRuns: summaries.length,
    ratedRuns: rated.length,
    acceptedRuns: accepted.length,
    successRate: rated.length ? accepted.length / rated.length : null,
    tokensPerAcceptedTask: accepted.length ? acceptedTokens / accepted.length : null,
    costPerAcceptedTask: accepted.length && routedCost ? routedCost / accepted.length : null,
    baselineCostPerAcceptedTask: accepted.length && baselineCost ? baselineCost / accepted.length : null,
    savingsRate: baselineCost > 0 ? Math.max(0, (baselineCost - routedCost) / baselineCost) : null,
    ratedModelDecisions: learned.ratedDecisions,
    adaptiveRoutes: learned.adaptiveRoutes,
    nativeOperations: summaries.reduce((total, run) => total + run.nativeOperations, 0),
    avoidedProviderCalls: summaries.reduce((total, run) => total + run.nativeOperations, 0),
  };
}

export function cancelRun(sessionId: string) {
  const run = runs.get(sessionId);
  if (!run) return false;
  if (!run.done) appendRunEvent(sessionId, { type: "error", message: "Run stopped. Completed workspace changes were preserved." });
  run.abort.abort();
  run.active = false;
  run.done = true;
  run.updatedAt = Date.now();
  if (activeWorkspaceRuns.get(run.workspaceId) === sessionId) activeWorkspaceRuns.delete(run.workspaceId);
  schedulePersist(run, true);
  const lease = leaseTimers.get(sessionId);
  if (lease) clearInterval(lease);
  leaseTimers.delete(sessionId);
  return true;
}
