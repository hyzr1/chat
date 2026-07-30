#!/usr/bin/env node
// Hyzr local agent (relay bridge).
//
// Runs on the user's own computer. It bridges a hosted Hyzr deployment to the
// FULL Hyzr pipeline running locally: it pulls tasks from the hosted relay and
// runs each one through the local app's /api/chat, which does real capability
// routing across BOTH the user's Claude and Codex (that's the whole point of
// Hyzr — no single-model preference), then streams the output back.
//
//   node index.mjs --url=https://chat.hyzr.ai --code=ABC123 --app=http://localhost:3000
//
// --url  : the hosted Hyzr app the code came from (the relay)
// --app  : the local Hyzr app running the pipeline (default http://localhost:3000)
// Env alternatives: HYZR_URL, HYZR_CODE, HYZR_APP.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import readline from "node:readline";

const execFileAsync = promisify(execFile);
const IS_WIN = process.platform === "win32";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const RELAY = (arg("url") || process.env.HYZR_URL || "http://localhost:3000").replace(/\/$/, "");
const APP = (arg("app") || process.env.HYZR_APP || RELAY).replace(/\/$/, "");
const PLAN = (arg("plan") || process.env.HYZR_PLAN || "true").toLowerCase() !== "false";

function log(...a) { console.log("[hyzr-agent]", ...a); }

async function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(q, (a) => { rl.close(); r(a.trim()); }));
}

async function detect(cmd) {
  try { await execFileAsync(IS_WIN ? "where.exe" : "which", [cmd], { timeout: 2500, windowsHide: true }); return true; }
  catch { return false; }
}

async function post(url, body) {
  try { return await (await fetch(`${RELAY}${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json(); }
  catch { return {}; }
}

// Run one task through the LOCAL app's full pipeline and stream results back.
async function runJob(job, token) {
  const runId = `agent-${String(job.id).replace(/[^a-z0-9-]/gi, "")}`;
  const payload = {
    messages: [{ role: "user", content: job.prompt }],
    keys: { anthropic: "", openai: "", linear: "" },
    override: job.model || "auto",
    mode: "local",
    plan: PLAN,                       // capability routing across both CLIs
    sessionId: runId,
    runId,
    effort: "high",
    preferences: { adaptiveRouting: true },
  };
  let res;
  try {
    res = await fetch(`${APP}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  } catch (err) {
    await post("/api/agent/result", { token, jobId: job.id, type: "error", text: `Couldn't reach your local Hyzr app at ${APP}. Is it running? (${err.message})` });
    return;
  }
  if (!res.ok || !res.body) {
    await post("/api/agent/result", { token, jobId: job.id, type: "error", text: `Local Hyzr returned ${res.status}.` });
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let got = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      let evt;
      try { evt = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (evt.type === "text" && evt.text) { got = true; await post("/api/agent/result", { token, jobId: job.id, type: "text", text: evt.text }); }
      else if (evt.type === "status" && evt.status) { await post("/api/agent/result", { token, jobId: job.id, type: "status", text: evt.status }); }
      else if (evt.type === "error" && evt.message) { await post("/api/agent/result", { token, jobId: job.id, type: "error", text: evt.message }); }
    }
  }
  await post("/api/agent/result", { token, jobId: job.id, type: "done", text: got ? "" : "No output produced." });
  log(`job ${job.id} finished`);
}

async function main() {
  log(`relay: ${RELAY}`);
  log(`local pipeline: ${APP}`);
  const agent = {
    host: os.hostname(),
    platform: process.platform,
    claude: await detect("claude"),
    codex: await detect("codex"),
    git: await detect("git"),
    node: process.version,
  };
  // Report both — the pipeline routes each task to whichever fits best.
  agent.engine = agent.claude && agent.codex ? "claude+codex" : agent.claude ? "claude" : agent.codex ? "codex" : "";
  if (!agent.claude && !agent.codex) { log("No Claude or Codex CLI found. Install at least one, sign in, and re-run."); process.exit(1); }
  log(`detected: claude=${agent.claude} codex=${agent.codex} git=${agent.git} node=${agent.node} → routing across ${agent.engine}`);

  const code = (arg("code") || process.env.HYZR_CODE || await ask("Enter the pairing code from the Hyzr app: ")).toUpperCase();
  const paired = await post("/api/agent/pair", { code, agent });
  if (!paired.token) { log("Pairing failed:", paired.error || "unknown error"); process.exit(1); }
  const token = paired.token;
  log("paired. leave this window open — Agent tasks will run here on your machine.");

  while (true) {
    try {
      const res = await fetch(`${RELAY}/api/agent/poll?token=${token}`);
      const { job } = await res.json();
      if (job) { log(`task: ${String(job.prompt).slice(0, 70)}…`); await runJob(job, token); }
    } catch (err) {
      log("poll error, retrying in 3s:", String(err.message || err));
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main().catch((err) => { log("fatal:", err); process.exit(1); });
