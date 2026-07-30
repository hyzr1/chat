import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROTOCOL = 2;
const VERSION = "1.1.0";
const IS_WIN = process.platform === "win32";
const DEFAULT_ROOT = path.join(os.homedir(), "Hyzr");
const STATE_ROOT = path.join(os.homedir(), ".hyzr", "agent");
const CONFIG_FILE = path.join(STATE_ROOT, "config.json");
const SESSIONS_FILE = path.join(STATE_ROOT, "sessions.json");
const IGNORE = new Set(["node_modules", ".git", ".next", ".cache"]);
const previewServers = new Map();

const log = (...values) => console.log("[hyzr]", ...values);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const cleanId = (value) => String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);

function cleanRelay(value) {
  const url = new URL(String(value || "https://chat.hyzr.ai"));
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
    throw new Error("Hyzr Agent requires HTTPS except for a localhost development server.");
  }
  return url.origin.replace(/\/$/, "");
}

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

async function ask(question, fallback = "") {
  if (!process.stdin.isTTY) return fallback;
  const terminal = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => terminal.question(question, (answer) => {
    terminal.close();
    resolve(answer.trim() || fallback);
  }));
}

function selectExecutable(candidates, windows = IS_WIN) {
  if (!windows) return candidates[0] || null;
  // npm's .cmd launcher is runnable by child_process. A later WindowsApps
  // .exe candidate may be an App Execution Alias that returns EPERM to a
  // background desktop process, so prefer the command shim when present.
  return candidates.find((item) => /\.(cmd|bat)$/i.test(item))
    || candidates.find((item) => /\.(exe|com)$/i.test(item))
    || candidates[0]
    || null;
}

async function locate(command) {
  try {
    const { stdout } = await execFileAsync(IS_WIN ? "where.exe" : "which", [command], { timeout: 4000, windowsHide: true });
    const candidates = stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    return selectExecutable(candidates);
  } catch {
    return null;
  }
}

async function commandVersion(commandPath) {
  if (!commandPath) return null;
  try {
    const launch = commandLaunch(commandPath, ["--version"]);
    const { stdout, stderr } = await execFileAsync(launch.command, launch.args, {
      timeout: 5000,
      windowsHide: true,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
    });
    return (stdout || stderr).trim().split(/\r?\n/)[0]?.slice(0, 100) || null;
  } catch {
    return null;
  }
}

function cmdQuote(value) {
  return `"${String(value).replace(/[\r\n]/g, " ").replace(/%/g, "%%").replace(/"/g, '""')}"`;
}

function commandLaunch(command, args) {
  if (!(IS_WIN && /\.(cmd|bat)$/i.test(command))) return { command, args, windowsVerbatimArguments: false };
  const shell = process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe";
  return {
    command: shell,
    args: ["/d", "/s", "/c", `call ${cmdQuote(command)} ${args.map(cmdQuote).join(" ")}`],
    windowsVerbatimArguments: true,
  };
}

function safeWorkspace(root, workspaceId) {
  const id = cleanId(workspaceId);
  if (!id) throw new Error("The job did not include a valid workspace ID.");
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, id);
  if (!target.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("Invalid workspace path.");
  return target;
}

function safeRelative(root, relative) {
  const base = path.resolve(root);
  const target = path.resolve(base, String(relative || ""));
  if (target === base || target.startsWith(`${base}${path.sep}`)) return target;
  throw new Error("Invalid project path.");
}

function engineFor(job, tools) {
  const requested = String(job.model || "").toLowerCase();
  if (/(claude|fable|sonnet|opus|haiku)/.test(requested) && tools.claude) return "claude";
  if (/(gpt|codex|sol|terra|luna)/.test(requested) && tools.codex) return "codex";
  if (!tools.claude) return "codex";
  if (!tools.codex) return "claude";
  const prompt = String(job.prompt).toLowerCase();
  return /\b(debug|fix|refactor|implement|test|compile|lint|repository|repo|migration|run|terminal|command|math|formula)\b/.test(prompt)
    ? "codex"
    : "claude";
}

function providerModel(engine, requested) {
  const id = String(requested || "");
  if (engine === "claude") {
    if (/haiku/i.test(id)) return "haiku";
    if (/sonnet/i.test(id)) return "sonnet";
    if (/opus|fable/i.test(id)) return "opus";
    return "";
  }
  if (!id || /(claude|fable|sonnet|opus|haiku)/i.test(id)) return "";
  return id.match(/^gpt-[a-zA-Z0-9_.-]+$/)?.[0] || "";
}

function transcript(job) {
  const history = Array.isArray(job.history) ? job.history.slice(-16) : [];
  if (!history.length) return String(job.prompt);
  return [
    "This is a resumed Hyzr web conversation. Preserve continuity within this workspace.",
    ...history.map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${String(message.content || "").slice(0, 8000)}`),
    `User: ${String(job.prompt)}`,
  ].join("\n\n");
}

async function post(relay, pathname, body, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(`${relay}${pathname}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Relay returned ${response.status}.`);
      return payload;
    } catch (error) {
      lastError = error;
      if (attempt < attempts - 1) await sleep(400 * 2 ** attempt);
    }
  }
  throw lastError;
}

function runProcess(command, args, prompt, cwd, onLine) {
  return new Promise((resolve) => {
    const launch = commandLaunch(command, args);
    const child = spawn(launch.command, launch.args, {
      cwd,
      windowsHide: true,
      windowsVerbatimArguments: launch.windowsVerbatimArguments,
      env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdoutBuffer = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) onLine(line);
    });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => resolve({ code: 1, stderr: error.message }));
    child.once("close", (code) => {
      if (stdoutBuffer.trim()) onLine(stdoutBuffer);
      resolve({ code: code ?? 1, stderr });
    });
    child.stdin.end(prompt);
  });
}

function claudeActivity(content) {
  const labels = {
    Read: "Reading project files",
    Write: "Writing project files",
    Edit: "Editing project files",
    Bash: "Running a command",
    PowerShell: "Running a command",
    Glob: "Finding project files",
    Grep: "Searching project files",
  };
  return labels[content?.name] || (content?.name ? `Using ${content.name}` : "");
}

async function runClaude({ command, job, cwd, priorSession, permissionMode, emit }) {
  const model = providerModel("claude", job.model);
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    ...(model ? ["--model", model] : []),
    ...(priorSession ? ["--resume", priorSession] : []),
    ...(permissionMode === "full-access"
      ? ["--dangerously-skip-permissions"]
      : ["--permission-mode", "acceptEdits"]),
  ];
  let sessionId = priorSession || "";
  let answer = "";
  let sawPartial = false;
  let resultError = "";
  const processResult = await runProcess(command, args, priorSession ? String(job.prompt) : transcript(job), cwd, (line) => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event.session_id) sessionId = event.session_id;
    if (event.type === "system" && event.subtype === "init" && event.session_id) sessionId = event.session_id;
    if (event.type === "stream_event" && event.event?.type === "content_block_delta" && event.event.delta?.type === "text_delta") {
      sawPartial = true;
      answer += event.event.delta.text || "";
      emit("text", event.event.delta.text || "");
    }
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      for (const content of event.message.content) {
        if (content?.type === "tool_use") {
          const text = claudeActivity(content);
          if (text) emit("status", text, { tool: content.name });
        }
      }
    }
    if (event.type === "result") {
      if (!sawPartial && event.result) {
        answer = event.result;
        emit("text", event.result);
      }
      if (event.usage) emit("usage", "", event.usage);
      if (event.is_error) resultError = event.result || "Claude reported an error.";
    }
  });
  if (processResult.code !== 0 || resultError) throw new Error(resultError || processResult.stderr.trim() || `Claude exited with code ${processResult.code}.`);
  return { sessionId, answer };
}

async function runCodex({ command, job, cwd, priorSession, permissionMode, emit }) {
  const model = providerModel("codex", job.model);
  const requestedEffort = String(job.effort || "").toLowerCase();
  const effort = requestedEffort === "ultra"
    ? "xhigh"
    : ["low", "medium", "high", "xhigh"].includes(requestedEffort)
      ? requestedEffort
      : "";
  const common = [
    ...(model ? ["--model", model] : []),
    ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
    "--json",
    "--skip-git-repo-check",
    ...(permissionMode === "full-access"
      ? ["--dangerously-bypass-approvals-and-sandbox"]
      : ["-c", 'sandbox_mode="workspace-write"', "-c", 'approval_policy="never"']),
  ];
  const args = priorSession ? ["exec", "resume", priorSession, ...common, "-"] : ["exec", ...common, "-"];
  let sessionId = priorSession || "";
  let answer = "";
  let failure = "";
  const processResult = await runProcess(command, args, priorSession ? String(job.prompt) : transcript(job), cwd, (line) => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event.type === "thread.started" && event.thread_id) sessionId = event.thread_id;
    if ((event.type === "item.started" || event.type === "item.completed") && event.item?.type && event.item.type !== "agent_message") {
      const names = {
        command_execution: "Running a command",
        file_change: "Editing project files",
        mcp_tool_call: "Using a connected tool",
        web_search: "Searching the web",
        plan: "Updating the plan",
        reasoning: "Reasoning",
      };
      emit("status", names[event.item.type] || `Using ${event.item.type}`, { tool: event.item.type });
    }
    if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) answer = event.item.text;
    if (event.type === "turn.completed" && event.usage) emit("usage", "", event.usage);
    if (event.type === "turn.failed" || event.type === "error") failure = event.error?.message || event.message || "Codex reported an error.";
  });
  if (answer) emit("text", answer);
  if (processResult.code !== 0 || failure) throw new Error(failure || processResult.stderr.trim() || `Codex exited with code ${processResult.code}.`);
  return { sessionId, answer };
}

function safeRepo(value) {
  const repo = String(value || "");
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(repo)) throw new Error("Invalid repository name.");
  return repo;
}

function safeGitHubPath(value) {
  const item = String(value || "").replace(/^\/+/, "");
  if (item.split("/").includes("..")) throw new Error("Invalid repository path.");
  return item;
}

async function ghJson(command, args) {
  if (!command) throw new Error("GitHub CLI is not installed on the paired computer.");
  const { stdout, stderr } = await execFileAsync(command, args, { timeout: 30_000, windowsHide: true, maxBuffer: 12 * 1024 * 1024 });
  if (stderr && !stdout) throw new Error(stderr.trim());
  return JSON.parse(stdout);
}

async function walkWorkspace(directory, relative = "", depth = 0, output = []) {
  if (depth > 16 || output.length >= 3000) return output;
  let entries = [];
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return output; }
  for (const entry of entries) {
    if (IGNORE.has(entry.name) || entry.name.startsWith(".")) continue;
    const itemPath = relative ? `${relative}/${entry.name}` : entry.name;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      output.push({ name: entry.name, path: itemPath, type: "dir" });
      await walkWorkspace(absolute, itemPath, depth + 1, output);
    } else {
      let size = 0;
      try { size = (await stat(absolute)).size; } catch {}
      output.push({ name: entry.name, path: itemPath, type: "file", size });
    }
  }
  return output;
}

async function startPreviewServer(context, workspaceId) {
  const workspace = safeWorkspace(context.workspaceRoot, workspaceId);
  const existing = previewServers.get(cleanId(workspaceId));
  if (existing?.child && !existing.child.killed) return { port: existing.port, reused: true };
  const packageFile = safeRelative(workspace, "package.json");
  let manifest;
  try { manifest = JSON.parse(await readFile(packageFile, "utf8")); } catch { throw new Error("This project has no package.json dev server."); }
  const script = manifest?.scripts?.dev ? "dev" : manifest?.scripts?.start ? "start" : "";
  if (!script) throw new Error("Add a dev or start script to package.json before opening a live preview.");
  const npm = context.tools.npm;
  if (!npm) throw new Error("Node.js/npm is not available to start this project.");
  const port = 43100 + Math.floor(Math.random() * 90);
  const launch = commandLaunch(npm, ["run", script, "--", "--port", String(port)]);
  const child = spawn(launch.command, launch.args, {
    cwd: workspace,
    windowsHide: true,
    windowsVerbatimArguments: launch.windowsVerbatimArguments,
    detached: false,
    env: { ...process.env, BROWSER: "none", PORT: String(port), HOST: "127.0.0.1", NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk) => { output = `${output}${chunk}`.slice(-12_000); });
  child.stderr?.on("data", (chunk) => { output = `${output}${chunk}`.slice(-12_000); });
  child.once("close", () => previewServers.delete(cleanId(workspaceId)));
  previewServers.set(cleanId(workspaceId), { child, port, workspace, startedAt: Date.now() });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(output.trim() || `The ${script} script exited with code ${child.exitCode}.`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1200) });
      if (response.status < 500) return { port, reused: false };
    } catch {}
    await sleep(350);
  }
  try { child.kill(); } catch {}
  previewServers.delete(cleanId(workspaceId));
  throw new Error(`The project server did not become ready on port ${port}.\n${output.trim()}`.trim());
}

function previewEntry(files) {
  const html = files.filter((item) => item.type === "file" && /\.html?$/i.test(item.name));
  const index = html.find((item) => /^(dist|build|out)\/index\.html?$/i.test(item.path))
    || html.filter((item) => /^index\.html?$/i.test(item.name)).sort((a, b) => a.path.split("/").length - b.path.split("/").length)[0]
    || html[0];
  return index?.path || null;
}

function specialistPlan(job, tools) {
  const prompt = String(job.prompt || "");
  const text = prompt.toLowerCase();
  const broad = Boolean(job.plan) && (
    prompt.length > 220 ||
    /\b(build|create|make|implement|redesign|migrate)\b[\s\S]{0,80}\b(app|website|platform|system|project|feature)\b/.test(text) ||
    /\b(end[- ]to[- ]end|production[- ]grade|multiple|multi[- ]step|entire)\b/.test(text)
  );
  if (!broad || (!tools.claude && !tools.codex)) return [];

  const tasks = [];
  if (tools.claude && /\b(ui|ux|frontend|website|web app|design|portfolio|dashboard|landing page|responsive)\b/.test(text)) {
    tasks.push({
      label: "Interface and product design",
      engine: "claude",
      model: "claude-sonnet",
      instruction: "Create a concise implementation-ready interface brief. Resolve layout, visual hierarchy, interaction states, accessibility, and responsive behavior. Do not edit files yet.",
    });
  }
  if (tools.codex && /\b(math|formula|algorithm|forecast|prediction|statistics|optimization|simulation)\b/.test(text)) {
    tasks.push({
      label: "Technical and mathematical design",
      engine: "codex",
      model: "gpt-5.6-sol",
      instruction: "Derive and check the difficult technical or mathematical part. Produce implementation-ready equations, assumptions, edge cases, and tests. Do not edit files yet.",
    });
  }
  if (tools.codex && /\b(image|background|illustration|logo|photo|texture|graphic|visual asset)\b/.test(text)) {
    tasks.push({
      label: "Visual asset generation",
      engine: "codex",
      model: "gpt-5.6-terra",
      instruction: "Create the requested visual asset using an installed image-generation capability if available. Save useful outputs inside the project and report their paths. Do not substitute a text-only description when image generation is available.",
    });
  }
  const implementationEngine = tools.codex ? "codex" : "claude";
  tasks.push({
    label: "Implementation",
    engine: implementationEngine,
    model: implementationEngine === "codex" ? "gpt-5.6-terra" : "claude-sonnet",
    instruction: "Implement the complete user request in the current workspace. Use the specialist handoffs below, inspect existing files first, make real file changes, and run the narrowest relevant validation. Do not merely describe code or ask the user to create files.",
  });
  if (tasks.length > 1) {
    const verifierEngine = tools.claude ? "claude" : "codex";
    tasks.push({
      label: "Verification and delivery",
      engine: verifierEngine,
      model: verifierEngine === "claude" ? "claude-haiku" : "gpt-5.4-mini",
      instruction: "Independently inspect the implementation against the original request. Run relevant checks, fix concrete problems you find, and finish with a concise user-facing delivery summary including files and verification. Do not claim success without inspecting the workspace.",
    });
  }
  return tasks.slice(0, 4);
}

async function handleRpc(job, context) {
  const params = job.params || {};
  switch (job.method) {
    case "system.status":
      return context.capabilities;
    case "github.status": {
      const user = await ghJson(context.tools.gh, ["api", "user"]);
      return { connected: true, login: user.login };
    }
    case "github.repos":
      return { repos: await ghJson(context.tools.gh, ["repo", "list", "--json", "nameWithOwner,description,updatedAt,visibility,primaryLanguage,stargazerCount", "--limit", "60"]) };
    case "github.tree": {
      const repo = safeRepo(params.repo);
      const repoPath = safeGitHubPath(params.path);
      const raw = await ghJson(context.tools.gh, ["api", `repos/${repo}/contents/${repoPath}`]);
      const items = (Array.isArray(raw) ? raw : [raw]).map((item) => ({ name: item.name, path: item.path, type: item.type, size: item.size }));
      items.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1);
      return { items };
    }
    case "github.file": {
      const repo = safeRepo(params.repo);
      const repoPath = safeGitHubPath(params.path);
      const data = await ghJson(context.tools.gh, ["api", `repos/${repo}/contents/${repoPath}`]);
      return { content: Buffer.from(data.content || "", "base64").toString("utf8"), path: repoPath };
    }
    case "github.issues": {
      const repo = safeRepo(params.repo);
      const state = params.state === "closed" ? "closed" : "open";
      return { issues: await ghJson(context.tools.gh, ["issue", "list", "--repo", repo, "--state", state, "--limit", "50", "--json", "number,title,body,url,labels,assignees,updatedAt"]) };
    }
    case "github.issue": {
      const repo = safeRepo(params.repo);
      const number = Number(params.number);
      if (!Number.isInteger(number) || number < 1) throw new Error("Invalid issue number.");
      return { issue: await ghJson(context.tools.gh, ["issue", "view", String(number), "--repo", repo, "--json", "number,title,body,url,labels,assignees,state,comments"]) };
    }
    case "workspace.list": {
      const workspace = safeWorkspace(context.workspaceRoot, params.workspaceId);
      await mkdir(workspace, { recursive: true });
      const files = await walkWorkspace(workspace);
      return { files, entry: previewEntry(files), count: files.length, workspace };
    }
    case "workspace.read": {
      const workspace = safeWorkspace(context.workspaceRoot, params.workspaceId);
      const file = safeRelative(workspace, params.path);
      const metadata = await stat(file);
      if (!metadata.isFile()) throw new Error("Not a file.");
      if (metadata.size > 512 * 1024) throw new Error("File exceeds the 512 KB viewer limit.");
      const content = await readFile(file, "utf8");
      if (content.includes("\0")) throw new Error("Binary files cannot be displayed.");
      return { path: String(params.path), content, size: metadata.size };
    }
    case "workspace.asset": {
      const workspace = safeWorkspace(context.workspaceRoot, params.workspaceId);
      const file = safeRelative(workspace, params.path);
      const metadata = await stat(file);
      if (!metadata.isFile()) throw new Error("Not a file.");
      if (metadata.size > 3 * 1024 * 1024) throw new Error("Preview asset exceeds the 3 MB relay limit.");
      const content = await readFile(file);
      return { path: String(params.path), body: content.toString("base64"), size: metadata.size };
    }
    case "preview.start":
      return startPreviewServer(context, params.workspaceId);
    case "preview.http": {
      const id = cleanId(params.workspaceId);
      const record = previewServers.get(id);
      if (!record?.child || record.child.killed) await startPreviewServer(context, id);
      const active = previewServers.get(id);
      const requested = String(params.path || "/");
      if (!requested.startsWith("/") || requested.startsWith("//")) throw new Error("Invalid preview URL.");
      const response = await fetch(`http://127.0.0.1:${active.port}${requested}`, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(20_000),
      });
      const body = Buffer.from(await response.arrayBuffer());
      if (body.length > 3 * 1024 * 1024) throw new Error("Preview response exceeds the 3 MB relay limit.");
      return {
        status: response.status,
        contentType: response.headers.get("content-type") || "application/octet-stream",
        location: response.headers.get("location"),
        body: body.toString("base64"),
      };
    }
    default:
      throw new Error(`Unsupported local operation: ${job.method}`);
  }
}

async function handleRun(job, context) {
  const workspace = safeWorkspace(context.workspaceRoot, job.workspaceId);
  await mkdir(workspace, { recursive: true });
  const sessions = await readJson(context.sessionsFile, {});
  const planned = specialistPlan(job, context.tools);
  const tasks = planned.length ? planned : [{
    label: "Agent",
    engine: engineFor(job, context.tools),
    model: job.model,
    instruction: "",
  }];
  const handoffs = [];

  for (let index = 0; index < tasks.length; index++) {
    const task = tasks[index];
    const sessionKey = `${cleanId(job.conversationId)}:${task.engine}`;
    const priorSession = sessions[sessionKey]?.sessionId || "";
    const finalTask = index === tasks.length - 1;
    await context.emit(
      job.id,
      "status",
      `${task.label} → ${task.engine === "codex" ? task.model || "Codex" : task.model || "Claude"}`,
      { task: index + 1, totalTasks: tasks.length, engine: task.engine, model: task.model },
    );
    const handoff = handoffs.length
      ? `\n\nSPECIALIST HANDOFFS\n${handoffs.map((item) => `--- ${item.label} ---\n${item.answer}`).join("\n\n")}`
      : "";
    const taskJob = {
      ...job,
      model: task.model || job.model,
      prompt: task.instruction
        ? `${task.instruction}\n\nORIGINAL USER REQUEST\n${job.prompt}${handoff}`
        : job.prompt,
      history: priorSession ? [] : job.history,
    };
    const emit = (type, text, data) => {
      if (type !== "text" || finalTask) return context.emit(job.id, type, text, data);
      return Promise.resolve();
    };
    const runner = task.engine === "codex" ? runCodex : runClaude;
    let result;
    try {
      result = await runner({
        command: context.tools[task.engine],
        job: taskJob,
        cwd: workspace,
        priorSession,
        permissionMode: context.permissionMode,
        emit,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!taskJob.model || !/\b(model|slug)\b[\s\S]{0,100}\b(unknown|invalid|not found|unsupported|unavailable|access)\b/i.test(message)) throw error;
      await context.emit(job.id, "status", `${task.model} is unavailable on this account; using the provider default.`);
      result = await runner({
        command: context.tools[task.engine],
        job: { ...taskJob, model: null },
        cwd: workspace,
        priorSession,
        permissionMode: context.permissionMode,
        emit,
      });
    }
    handoffs.push({ label: task.label, answer: String(result.answer || "").slice(0, 12_000) });
    if (result.sessionId) {
      sessions[sessionKey] = {
        sessionId: result.sessionId,
        engine: task.engine,
        workspaceId: cleanId(job.workspaceId),
        conversationId: cleanId(job.conversationId),
        updatedAt: Date.now(),
      };
      await writeJson(context.sessionsFile, sessions);
    }
  }
}

export async function startAgent(options = {}) {
  const saved = options.savedConfig || await readJson(CONFIG_FILE, {});
  const relay = cleanRelay(options.relay || saved.relay || "https://chat.hyzr.ai");
  const workspaceRoot = path.resolve(options.workspaceRoot || saved.workspaceRoot || DEFAULT_ROOT);
  const permissionMode = options.permissionMode || saved.permissionMode || "workspace";
  await mkdir(workspaceRoot, { recursive: true });

  const tools = {
    claude: await locate("claude"),
    codex: await locate("codex"),
    git: await locate("git"),
    gh: await locate("gh"),
    npm: await locate("npm"),
  };
  if (!tools.claude && !tools.codex) throw new Error("Install and sign in to Claude Code or Codex before pairing Hyzr.");
  const capabilities = {
    protocol: PROTOCOL,
    version: VERSION,
    host: os.hostname(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    claude: Boolean(tools.claude),
    codex: Boolean(tools.codex),
    git: Boolean(tools.git),
    gh: Boolean(tools.gh),
    engine: tools.claude && tools.codex ? "claude+codex" : tools.claude ? "claude" : "codex",
    workspaceRoot,
    permissionMode,
    versions: {
      claude: await commandVersion(tools.claude),
      codex: await commandVersion(tools.codex),
      git: await commandVersion(tools.git),
      gh: await commandVersion(tools.gh),
    },
  };

  const code = String(options.code || saved.pendingCode || "").toUpperCase();
  let token = options.token || saved.token || "";
  if (code) {
    const paired = await post(relay, "/api/agent/pair", { code, agent: capabilities });
    token = paired.token;
  }
  if (!token) throw new Error("A pairing code is required.");
  const persisted = { relay, token, workspaceRoot, permissionMode, pairedAt: Date.now() };
  if (options.persistConfig) await options.persistConfig(persisted);
  else await writeJson(CONFIG_FILE, persisted);

  let writeChain = Promise.resolve();
  const emit = (jobId, type, text = "", data) => {
    writeChain = writeChain
      .then(() => post(relay, "/api/agent/result", { token, jobId, type, text, data }))
      .catch((error) => log("could not deliver an event:", error.message));
    return writeChain;
  };
  const context = {
    relay,
    token,
    tools,
    capabilities,
    workspaceRoot,
    permissionMode,
    sessionsFile: options.sessionsFile || SESSIONS_FILE,
    emit,
  };
  options.onStatus?.({ connected: true, capabilities });

  let failures = 0;
  while (!options.signal?.aborted) {
    try {
      const response = await fetch(`${relay}/api/agent/poll`, {
        cache: "no-store",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 401) {
        const unpaired = { relay, workspaceRoot, permissionMode, pairedAt: persisted.pairedAt };
        if (options.persistConfig) await options.persistConfig(unpaired);
        else await writeJson(CONFIG_FILE, unpaired);
        throw new Error("Pairing expired. Run Hyzr again and enter a new code.");
      }
      if (!response.ok) throw new Error(`Relay returned ${response.status}.`);
      const { job } = await response.json();
      failures = 0;
      if (!job) continue;
      try {
        if (job.kind === "rpc") {
          const data = await handleRpc(job, context);
          await emit(job.id, "result", "", data);
        } else {
          await handleRun({ ...job, kind: "run" }, context);
          await emit(job.id, "done");
        }
      } catch (error) {
        await emit(job.id, "error", error instanceof Error ? error.message : String(error));
      }
      await writeChain;
    } catch (error) {
      if (/^Pairing expired\./.test(error instanceof Error ? error.message : String(error))) throw error;
      failures += 1;
      options.onStatus?.({ connected: false, error: error instanceof Error ? error.message : String(error) });
      await sleep(Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)) + Math.floor(Math.random() * 300));
    }
  }
}

function argumentsMap() {
  return Object.fromEntries(process.argv.slice(2).map((item) => {
    const [key, ...rest] = item.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }));
}

export async function runAgentCli() {
  const args = argumentsMap();
  const saved = await readJson(CONFIG_FILE, {});
  const relay = args.url || process.env.HYZR_URL || saved.relay || "https://chat.hyzr.ai";
  const code = String(
    args.code
    || process.env.HYZR_CODE
    || (saved.token ? "" : await ask("Enter the code from Hyzr: ")),
  ).replace(/\s/g, "").toUpperCase();
  const workspaceRoot = path.resolve(args.workspace || saved.workspaceRoot || DEFAULT_ROOT);
  const permissionMode = args.restricted === "true" ? "workspace" : (saved.permissionMode || "full-access");
  await mkdir(workspaceRoot, { recursive: true });

  console.log("");
  console.log("  HYZR");
  console.log(`  Projects: ${workspaceRoot}`);
  console.log("  Keep this window open while you work from the web.");
  console.log("");

  let announced = false;
  await startAgent({
    relay,
    code,
    workspaceRoot,
    permissionMode,
    onStatus(status) {
      if (status.connected && !announced) {
        announced = true;
        const available = [
          status.capabilities.claude && "Claude",
          status.capabilities.codex && "Codex",
          status.capabilities.git && "Git",
          status.capabilities.gh && "GitHub",
        ].filter(Boolean).join(" · ");
        console.log(`  Connected${available ? ` — ${available}` : ""}`);
        console.log("");
      } else if (!status.connected && status.error) {
        console.log(`  Reconnecting — ${status.error}`);
      }
    },
  });
}

export async function loadAgentConfig() {
  return readJson(CONFIG_FILE, {});
}

export const __test = { cleanId, cleanRelay, safeWorkspace, safeRelative, selectExecutable, cmdQuote, engineFor, providerModel, previewEntry, specialistPlan };

runAgentCli().catch((error) => {
  console.error("\n  Hyzr stopped —", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
