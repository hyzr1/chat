import os from "os";
import { claimDurableJob, finishDurableJob, heartbeatDurableJob, recoverExpiredJobs, retryDurableJob, type DurableJob } from "./durable-jobs";
import { executeChatJob, type ChatJobPayload } from "./execution-engine";
import { appendRunEvent, finishRun, getRun } from "./run-registry";

type WorkerHandle = { running: boolean; generation: object; wake?: () => void };
const state = globalThis as typeof globalThis & { __hyzrChatWorker?: WorkerHandle };
// A module reload creates a new identity. This lets development hot reload drain
// the stale worker before it can execute jobs with an old execution engine.
const moduleGeneration = {};
const workerId = `${os.hostname()}:${process.pid}:${Math.random().toString(36).slice(2, 8)}`;

async function waitForWork(milliseconds: number, worker: WorkerHandle) {
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, milliseconds);
    timer.unref?.();
    worker.wake = () => { clearTimeout(timer); resolve(); };
  });
}

async function processJob(job: DurableJob<ChatJobPayload>) {
  const heartbeat = setInterval(() => heartbeatDurableJob(job.id, workerId), 10_000);
  heartbeat.unref?.();
  try {
    await executeChatJob(job.id, job.payload);
  } catch (error: any) {
    const message = getRun(job.id)?.abort.signal.aborted
      ? "Run stopped. Completed workspace changes were preserved."
      : String(error?.message || "The durable worker failed.");
    if (getRun(job.id)?.abort.signal.aborted) {
      finishDurableJob(job.id, "cancelled", message);
      appendRunEvent(job.id, { type: "error", message });
      finishRun(job.id);
    } else if (retryDurableJob(job.id, message)) {
      appendRunEvent(job.id, { type: "activity", label: `Execution was interrupted and will resume automatically (attempt ${job.attempt}/${job.maxAttempts}).` });
    } else {
      appendRunEvent(job.id, { type: "needs_attention", message: `Hyzr Chat could not complete this job after ${job.maxAttempts} durable attempts: ${message}` });
      finishRun(job.id);
    }
  } finally {
    clearInterval(heartbeat);
  }
}

async function loop(worker: WorkerHandle) {
  recoverExpiredJobs();
  while (worker.running && state.__hyzrChatWorker === worker) {
    const job = claimDurableJob<ChatJobPayload>(workerId);
    if (!job) { await waitForWork(1000, worker); continue; }
    await processJob(job);
  }
}

export function ensureDurableWorker() {
  if (state.__hyzrChatWorker?.running && state.__hyzrChatWorker.generation === moduleGeneration) {
    state.__hyzrChatWorker.wake?.();
    return;
  }
  const previous = state.__hyzrChatWorker;
  if (previous) {
    previous.running = false;
    previous.wake?.();
  }
  const worker: WorkerHandle = { running: true, generation: moduleGeneration };
  state.__hyzrChatWorker = worker;
  void loop(worker).catch((error) => {
    console.error("Hyzr Chat durable worker stopped unexpectedly", error);
    if (state.__hyzrChatWorker === worker) worker.running = false;
  });
}

export function wakeDurableWorker() {
  ensureDurableWorker();
  state.__hyzrChatWorker?.wake?.();
}
