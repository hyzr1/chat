#!/usr/bin/env node
// Hyzr agent — connect your machine.
//
// This is the ONE thing a user downloads and runs. It is self-contained: it
// detects your local Claude and Codex, connects to the hosted Hyzr app with a
// pairing code, then runs each task it receives on the best-fit CLI in an
// isolated per-task workspace, streaming the output back. No other install,
// no local server — works the same on every machine.
//
//   node hyzr-agent.mjs --url=https://chat.hyzr.ai --code=ABC123
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

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const RELAY = (arg("url") || process.env.HYZR_URL || "http://localhost:3000").replace(/\/$/, "");
const WORKSPACES = path.join(os.homedir(), "hyzr-workspaces");

const log = (...a) => console.log("[hyzr]", ...a);

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

// Route each task to the CLI that fits it — using both across the workload.
// Codex leans to hands-on code execution/refactors; Claude to reasoning, design,
// and general work. If only one is installed, that one handles everything.
function pickEngine(prompt, avail, hint) {
  if (hint === "codex" && avail.codex) return "codex";
  if (hint === "claude" && avail.claude) return "claude";
  if (!avail.claude) return "codex";
  if (!avail.codex) return "claude";
  const p = String(prompt).toLowerCase();
  const codexy = /\b(run|execute|refactor|debug|fix (the|this)|failing tests?|compile|lint|migrate|implement|codebase|repository|repo|script)\b/.test(p);
  return codexy ? "codex" : "claude";
}

function runOn(engine, prompt, cwd, onText) {
  return new Promise((resolve) => {
    // Both CLIs read the prompt from stdin — no shell-escaping issues.
    const args = engine === "claude" ? ["-p"] : ["exec", "-"];
    const child = spawn(engine, args, { cwd, shell: IS_WIN, windowsHide: true });
    child.stdin.write(prompt);
    child.stdin.end();
    child.stdout.on("data", (d) => onText(d.toString()));
    child.stderr.on("data", (d) => process.env.HYZR_DEBUG && log(`${engine}:`, d.toString().slice(0, 200)));
    child.on("close", (code) => resolve(code ?? 0));
    child.on("error", (err) => { onText(`\n[could not start ${engine}: ${err.message}]`); resolve(1); });
  });
}

async function runJob(job, token, avail) {
  const engine = pickEngine(job.prompt, avail, job.model);
  const cwd = path.join(WORKSPACES, String(job.id).replace(/[^a-z0-9-]/gi, "").slice(0, 32) || "task");
  await mkdir(cwd, { recursive: true }).catch(() => {});
  await post("/api/agent/result", { token, jobId: job.id, type: "status", text: `Routed to ${engine}` });

  let buffered = "";
  let timer = null;
  const flush = () => { if (buffered) { post("/api/agent/result", { token, jobId: job.id, type: "text", text: buffered }); buffered = ""; } };
  const onText = (t) => { buffered += t; if (!timer) timer = setTimeout(() => { timer = null; flush(); }, 250); };

  const code = await runOn(engine, job.prompt, cwd, onText);
  if (timer) clearTimeout(timer);
  flush();
  await post("/api/agent/result", { token, jobId: job.id, type: code === 0 ? "done" : "error", text: code === 0 ? "" : `${engine} exited with code ${code}` });
  log(`task ${job.id} done on ${engine} (exit ${code})`);
}

async function main() {
  log(`connecting to ${RELAY}`);
  const avail = { claude: await detect("claude"), codex: await detect("codex"), git: await detect("git") };
  const agent = {
    host: os.hostname(),
    platform: process.platform,
    claude: avail.claude,
    codex: avail.codex,
    git: avail.git,
    node: process.version,
    engine: avail.claude && avail.codex ? "claude+codex" : avail.claude ? "claude" : avail.codex ? "codex" : "",
  };
  if (!avail.claude && !avail.codex) {
    log("No Claude or Codex CLI found. Install at least one and sign in:");
    log("  Claude:  npm i -g @anthropic-ai/claude-code   then run: claude");
    log("  Codex:   npm i -g @openai/codex                then run: codex");
    process.exit(1);
  }
  log(`ready: claude=${avail.claude} codex=${avail.codex} git=${avail.git} → routing across ${agent.engine}`);

  const code = (arg("code") || process.env.HYZR_CODE || await ask("Enter the pairing code from the Hyzr site: ")).toUpperCase();
  const paired = await post("/api/agent/pair", { code, agent });
  if (!paired.token) { log("Pairing failed:", paired.error || "unknown error"); process.exit(1); }
  const token = paired.token;
  log("paired ✓  leave this window open — tasks will run here on your machine.");

  while (true) {
    try {
      const res = await fetch(`${RELAY}/api/agent/poll?token=${token}`);
      const { job } = await res.json();
      if (job) { log(`task: ${String(job.prompt).slice(0, 70)}…`); await runJob(job, token, avail); }
    } catch (err) {
      log("connection dropped, retrying in 3s…");
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main().catch((e) => { log("fatal:", e); process.exit(1); });
