// Relay worker — the fold-in that gives paired users the FULL pipeline.
//
// When the Hyzr app runs on a user's own machine with HYZR_RELAY_URL + a
// pairing code set, this connects to the hosted site's relay, pulls each Agent
// task, and runs it through the app's OWN execution engine in-process — the
// same planner + capability routing across every model (Fable 5 for design,
// Opus for APIs, Sonnet for math, a small GPT for image-gen, …) — writing each
// project into its isolated workspace folder on the user's disk, and streaming
// the output back to the hosted UI.
//
// It never runs on the hosted deployment itself (no CLIs there); it's strictly
// the local executor for a paired machine.

import { execFile } from "child_process";
import { promisify } from "util";
import os from "os";
import { beginRun, getRun } from "./run-registry";
import { enqueueDurableJob } from "./durable-jobs";
import { wakeDurableWorker } from "./durable-worker";

const execFileAsync = promisify(execFile);
let started = false;

async function detect(command: string) {
  try { await execFileAsync(process.platform === "win32" ? "where.exe" : "which", [command], { timeout: 2500, windowsHide: true }); return true; }
  catch { return false; }
}

async function post(relay: string, path: string, body: unknown) {
  try {
    const res = await fetch(`${relay}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    return await res.json().catch(() => ({}));
  } catch { return {}; }
}

// Run one task through the real engine and forward its stream to the relay.
async function runLocally(relay: string, token: string, job: { id: string; prompt: string; model?: string | null }) {
  const runId = `agent-${String(job.id).replace(/[^a-z0-9-]/gi, "").slice(0, 40) || "task"}`;
  beginRun(runId, runId);
  enqueueDurableJob(runId, runId, {
    messages: [{ role: "user", content: String(job.prompt) }],
    keys: { anthropic: "", openai: "", linear: "" },
    override: job.model || "auto",
    mode: "local",
    plan: true, // full decomposition + multi-model routing
    effort: "high",
    runId,
    sessionId: runId,
    preferences: { adaptiveRouting: true },
  });
  wakeDurableWorker();

  let cursor = 0;
  const startedAt = Date.now();
  while (true) {
    const run = getRun(runId);
    for (const event of (run?.events ?? []).filter((e) => (e.seq as number) > cursor)) {
      cursor = Math.max(cursor, event.seq as number);
      const type = event.type as string;
      if (type === "text" && event.text) await post(relay, "/api/agent/result", { token, jobId: job.id, type: "text", text: String(event.text) });
      else if (type === "status" && event.status) await post(relay, "/api/agent/result", { token, jobId: job.id, type: "status", text: String(event.status) });
      else if (type === "planner_status" && event.text) await post(relay, "/api/agent/result", { token, jobId: job.id, type: "status", text: String(event.text) });
      // The planner splits one task across models; surface each routing decision.
      // The multi-subtask path emits `task_start`; the single-model path emits `route`.
      else if (type === "task_start") {
        const label = (event as any).modelLabel || (event as any).modelId;
        const cap = (event as any).capability;
        if (label) await post(relay, "/api/agent/result", { token, jobId: job.id, type: "status", text: `Routing${cap ? ` ${cap}` : ""} → ${label}` });
      } else if (type === "route") {
        const label = (event as any).modelLabel || (event as any).modelId || (event.route as any)?.modelLabel || (event.route as any)?.modelId;
        if (label) await post(relay, "/api/agent/result", { token, jobId: job.id, type: "status", text: `Routing → ${label}` });
      } else if (type === "error") await post(relay, "/api/agent/result", { token, jobId: job.id, type: "error", text: String(event.message || "The run hit an error.") });
    }
    if (run?.done) break;
    if (Date.now() - startedAt > 15 * 60 * 1000) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  await post(relay, "/api/agent/result", { token, jobId: job.id, type: "done" });
}

export function relayWorkerStatus() {
  return { connected: started };
}

export async function startRelayWorker(relayArg?: string, codeArg?: string) {
  if (started) return { ok: true, alreadyConnected: true };
  const relay = (relayArg || process.env.HYZR_RELAY_URL)?.replace(/\/$/, "");
  const code = (codeArg || process.env.HYZR_CODE)?.trim().toUpperCase();
  const hosted = process.env.VERCEL === "1" || process.env.HYZR_HOSTED === "1";
  if (hosted) return { ok: false, error: "Run this from a local Hyzr install, not the hosted site." };
  if (!relay || !code) return { ok: false, error: "Missing relay URL or pairing code." };
  started = true;

  const agent = {
    host: os.hostname(),
    platform: process.platform,
    claude: await detect("claude"),
    codex: await detect("codex"),
    git: await detect("git"),
    node: process.version,
    engine: "",
  };
  agent.engine = agent.claude && agent.codex ? "claude+codex" : agent.claude ? "claude" : agent.codex ? "codex" : "";
  if (!agent.claude && !agent.codex) { console.log("[hyzr-relay] no Claude or Codex CLI found; not connecting."); started = false; return { ok: false, error: "No Claude or Codex CLI found on this machine." }; }

  console.log(`[hyzr-relay] connecting to ${relay} with code ${code} …`);
  const paired = (await post(relay, "/api/agent/pair", { code, agent })) as { token?: string; error?: string };
  if (!paired.token) { console.log("[hyzr-relay] pairing failed:", paired.error || "unknown error"); started = false; return { ok: false, error: paired.error || "Pairing failed." }; }
  const token = paired.token;
  console.log("[hyzr-relay] paired ✓ — this machine now runs Agent tasks from the hosted site with full model routing.");

  void (async () => {
    while (true) {
      try {
        const res = await fetch(`${relay}/api/agent/poll?token=${token}`, { cache: "no-store" });
        const { job } = await res.json();
        if (job) { console.log(`[hyzr-relay] task: ${String(job.prompt).slice(0, 70)}…`); await runLocally(relay, token, job); }
      } catch { await new Promise((r) => setTimeout(r, 3000)); }
    }
  })();
  return { ok: true, engine: agent.engine };
}
