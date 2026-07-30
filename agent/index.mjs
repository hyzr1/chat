#!/usr/bin/env node
// Hyzr local agent.
//
// Runs on the user's own computer. It detects the local Claude and Codex
// CLIs, claims a pairing code from the hosted Hyzr app, then long-polls for
// tasks, runs each one on the local CLI, and streams the output back. This is
// what lets a hosted (Vercel) deployment execute on a user's own machine.
//
//   node index.mjs --code=ABC123 --url=https://chat.hyzr.ai
//
// Env alternatives: HYZR_URL, HYZR_CODE.

import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";

const execFileAsync = promisify(execFile);
const IS_WIN = process.platform === "win32";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const BASE = (arg("url") || process.env.HYZR_URL || "http://localhost:3000").replace(/\/$/, "");
const WORKSPACES = path.join(os.homedir(), "hyzr-agent-workspaces");

function log(...a) { console.log("[hyzr-agent]", ...a); }

async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

async function detect(cmd) {
  try { await execFileAsync(IS_WIN ? "where.exe" : "which", [cmd], { timeout: 2500, windowsHide: true }); return true; }
  catch { return false; }
}

async function post(url, body) {
  const res = await fetch(`${BASE}${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.json().catch(() => ({}));
}

// Run one task on the local CLI, streaming stdout back as it arrives.
function runJob(job, token, engine) {
  return new Promise(async (resolve) => {
    const cwd = path.join(WORKSPACES, String(job.id).replace(/[^a-z0-9]/gi, "").slice(0, 24) || "task");
    await mkdir(cwd, { recursive: true }).catch(() => {});
    // Both CLIs read the prompt from stdin — no shell-escaping headaches.
    const args = engine === "claude" ? ["-p"] : ["exec", "-"];
    const child = spawn(engine, args, { cwd, shell: IS_WIN, windowsHide: true });
    child.stdin.write(job.prompt);
    child.stdin.end();
    let buffered = "";
    let timer = null;
    const flush = () => { if (buffered) { post("/api/agent/result", { token, jobId: job.id, type: "text", text: buffered }); buffered = ""; } };
    child.stdout.on("data", (d) => { buffered += d.toString(); if (!timer) timer = setTimeout(() => { timer = null; flush(); }, 250); });
    child.stderr.on("data", (d) => log(`${engine} stderr:`, d.toString().slice(0, 200)));
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      flush();
      post("/api/agent/result", { token, jobId: job.id, type: code === 0 ? "done" : "error", text: code === 0 ? "" : `${engine} exited with code ${code}` });
      log(`job ${job.id} finished (exit ${code})`);
      resolve();
    });
    child.on("error", (err) => { post("/api/agent/result", { token, jobId: job.id, type: "error", text: String(err.message) }); resolve(); });
  });
}

async function main() {
  log(`connecting to ${BASE}`);
  const agent = {
    host: os.hostname(),
    platform: process.platform,
    claude: await detect("claude"),
    codex: await detect("codex"),
    git: await detect("git"),
    node: process.version,
  };
  // Adapt to whatever the machine has: prefer an explicit --engine, else
  // Claude, else Codex. Works fine if only one is installed.
  const wanted = (arg("engine") || process.env.HYZR_ENGINE || "").toLowerCase();
  const engine = (wanted === "claude" && agent.claude) ? "claude"
    : (wanted === "codex" && agent.codex) ? "codex"
    : agent.claude ? "claude" : agent.codex ? "codex" : null;
  if (!engine) { log("No Claude or Codex CLI found on PATH. Install one, sign in, and re-run."); process.exit(1); }
  agent.engine = engine;
  log(`detected: claude=${agent.claude} codex=${agent.codex} git=${agent.git} node=${agent.node} → using ${engine}`);

  const code = (arg("code") || process.env.HYZR_CODE || await ask("Enter the pairing code from the Hyzr app: ")).toUpperCase();
  const paired = await post("/api/agent/pair", { code, agent });
  if (!paired.token) { log("Pairing failed:", paired.error || "unknown error"); process.exit(1); }
  const token = paired.token;
  log(`paired. running tasks on your ${engine} — leave this window open.`);

  // Long-poll forever; the endpoint returns quickly when idle so this stays cheap.
  while (true) {
    try {
      const res = await fetch(`${BASE}/api/agent/poll?token=${token}`);
      const { job } = await res.json();
      if (job) { log(`task received: ${String(job.prompt).slice(0, 60)}…`); await runJob(job, token, engine); }
    } catch (err) {
      log("poll error, retrying in 3s:", String(err.message || err));
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main().catch((err) => { log("fatal:", err); process.exit(1); });
