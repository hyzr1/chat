import { execFile, spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { copyFile, mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const PROTOCOL = 3;
const VERSION = "1.2.0";
const IS_WIN = process.platform === "win32";
const DEFAULT_ROOT = path.join(os.homedir(), "Hyzr");
const STATE_ROOT = path.join(os.homedir(), ".hyzr", "agent");
const CONFIG_FILE = path.join(STATE_ROOT, "config.json");
const CONFIG_BACKUP_FILE = path.join(STATE_ROOT, "config.backup.json");
const LOCK_FILE = path.join(STATE_ROOT, "runtime.lock");
const SESSIONS_FILE = path.join(STATE_ROOT, "sessions.json");
const IGNORE = new Set(["node_modules", ".git", ".next", ".cache"]);
const previewServers = new Map();
const PREVIEW_SERVER_LIMIT = 2;
const PREVIEW_IDLE_MS = 30 * 60 * 1000;

const log = (...values) => console.log("[hyzr]", ...values);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const cleanId = (value) => String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);

function previewListenerPidsFromNetstat(output, port) {
  const suffix = `:${Number(port)}`;
  return String(output || "").split(/\r?\n/).flatMap((line) => {
      const columns = line.trim().split(/\s+/);
      if (columns[0]?.toUpperCase() !== "TCP" || !columns[1]?.endsWith(suffix) || columns[3]?.toUpperCase() !== "LISTENING") return [];
      const pid = Number(columns[4]);
      return Number.isInteger(pid) && pid > 0 ? [pid] : [];
  });
}

function windowsPreviewListenerPids(port) {
  if (!IS_WIN || !Number.isInteger(Number(port))) return [];
  try {
    const result = spawnSync("netstat.exe", ["-ano", "-p", "tcp"], { windowsHide: true, encoding: "utf8" });
    return previewListenerPidsFromNetstat(result.stdout, port);
  } catch {
    return [];
  }
}

function stopPreviewRecord(id, record) {
  if (record?.server) {
    try { record.server.close(); } catch {}
  }
  const listenerPids = record?.child && !record.attached ? windowsPreviewListenerPids(record.port) : [];
  if (record?.child && !record.child.killed) {
    try {
      if (IS_WIN && record.child.pid) {
        spawnSync("taskkill.exe", ["/pid", String(record.child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
      } else if (record.child.pid) {
        process.kill(-record.child.pid, "SIGTERM");
      } else {
        record.child.kill();
      }
    } catch {
      try { record.child.kill(); } catch {}
    }
  }
  for (const pid of listenerPids) {
    if (pid === record?.child?.pid) continue;
    try { spawnSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" }); } catch {}
  }
  previewServers.delete(id);
}

function sweepPreviewServers(force = false) {
  const cutoff = Date.now() - PREVIEW_IDLE_MS;
  for (const [id, record] of previewServers) {
    if (force || Number(record.lastUsed || record.startedAt || 0) < cutoff) stopPreviewRecord(id, record);
  }
}

const previewSweep = setInterval(() => sweepPreviewServers(false), 5 * 60 * 1000);
previewSweep.unref?.();
process.once("exit", () => sweepPreviewServers(true));

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

async function readAgentConfig() {
  const primary = await readJson(CONFIG_FILE, null);
  if (primary && typeof primary === "object") return primary;
  const backup = await readJson(CONFIG_BACKUP_FILE, null);
  if (backup && typeof backup === "object") {
    await writeJson(CONFIG_FILE, backup).catch(() => {});
    return backup;
  }
  return {};
}

async function writeAgentConfig(value) {
  const current = await readJson(CONFIG_FILE, null);
  if (current && typeof current === "object") {
    await copyFile(CONFIG_FILE, CONFIG_BACKUP_FILE).catch(() => {});
  }
  await writeJson(CONFIG_FILE, value);
}

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) {
    return error?.code === "EPERM";
  }
}

async function acquireRuntimeLock(lockFile = LOCK_FILE) {
  await mkdir(path.dirname(lockFile), { recursive: true });
  const nonce = randomBytes(12).toString("hex");
  const payload = { pid: process.pid, nonce, version: VERSION, startedAt: Date.now() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockFile, "wx", 0o600);
      await handle.writeFile(JSON.stringify(payload));
      await handle.close();
      return async () => {
        const current = await readJson(lockFile, null);
        if (current?.nonce === nonce) await unlink(lockFile).catch(() => {});
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = await readJson(lockFile, null);
      if (existing?.pid && processIsAlive(Number(existing.pid))) {
        throw Object.assign(new Error(`Hyzr is already running in process ${existing.pid}. Keep that terminal open.`), { code: "ALREADY_RUNNING" });
      }
      await unlink(lockFile).catch(() => {});
    }
  }
  throw new Error("Could not acquire the Hyzr runtime lock.");
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
  const history = (Array.isArray(job.history) ? job.history.slice(-16) : []).filter((message) => {
    if (message?.role !== "assistant") return true;
    const content = String(message.content || "");
    return !/\bHyzr\b[\s\S]{0,100}\b(?:manages|owns)\b[\s\S]{0,80}\b(?:preview|server|process)\b|\bHyzr workspace\b[\s\S]{0,100}\bnot to start\b[\s\S]{0,80}\bserver/i.test(content);
  });
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

function openExternalUrl(url) {
  try {
    const child = IS_WIN
      ? spawn("rundll32.exe", ["url.dll,FileProtocolHandler", url], { detached: true, stdio: "ignore", windowsHide: true })
      : process.platform === "darwin"
        ? spawn("open", [url], { detached: true, stdio: "ignore" })
        : spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

async function deviceAuthorize(relay, capabilities, options = {}) {
  while (!options.signal?.aborted) {
    const flow = await post(relay, "/api/agent/device/start", { agent: capabilities });
    options.onCode?.(flow);
    if (options.openBrowser !== false) openExternalUrl(flow.verificationUriComplete);
    const deadline = Date.now() + Number(flow.expiresIn || 900) * 1000;
    const interval = Math.max(
      Number(options.minimumPollMs ?? 2_000),
      Math.max(0, Number(flow.interval || 3)) * 1000,
    );
    while (!options.signal?.aborted && Date.now() < deadline) {
      await sleep(interval);
      let response;
      try {
        response = await fetch(`${relay}/api/agent/device/token`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ deviceSecret: flow.deviceSecret }),
          signal: AbortSignal.timeout(12_000),
        });
      } catch (error) {
        options.onWait?.(error instanceof Error ? error.message : String(error));
        continue;
      }
      if (response.status === 202) continue;
      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.token) return payload.token;
      if (response.status === 404 || payload.error === "expired_token") break;
      if (response.status === 429) {
        await sleep(Math.max(3, Number(response.headers.get("retry-after") || 5)) * 1000);
        continue;
      }
      options.onWait?.(payload.error || `Pairing service returned ${response.status}.`);
    }
    if (!options.signal?.aborted) options.onExpired?.();
  }
  throw Object.assign(new Error("Pairing cancelled."), { code: "ABORTED" });
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
  let separateNextTextBlock = false;
  let resultError = "";
  const processResult = await runProcess(command, args, priorSession ? String(job.prompt) : transcript(job), cwd, (line) => {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    if (event.session_id) sessionId = event.session_id;
    if (event.type === "system" && event.subtype === "init" && event.session_id) sessionId = event.session_id;
    if (event.type === "stream_event" && event.event?.type === "content_block_start" && event.event.content_block?.type === "tool_use") {
      separateNextTextBlock = Boolean(answer);
    }
    if (event.type === "stream_event" && event.event?.type === "content_block_delta" && event.event.delta?.type === "text_delta") {
      sawPartial = true;
      const delta = event.event.delta.text || "";
      if (delta && separateNextTextBlock) {
        const separator = streamSeparator(answer);
        answer += separator;
        if (separator) emit("text", separator);
        separateNextTextBlock = false;
      }
      answer += delta;
      emit("text", delta);
    }
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      for (const content of event.message.content) {
        if (content?.type === "tool_use") {
          separateNextTextBlock = Boolean(answer);
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

function streamSeparator(previous) {
  if (!previous || /\n\s*\n$/.test(previous)) return "";
  return "\n\n";
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

const STATIC_PREVIEW_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function privateLanAddress(interfaces = os.networkInterfaces()) {
  const candidates = Object.entries(interfaces || {}).flatMap(([adapter, addresses]) =>
    (addresses || []).filter((item) =>
      item && !item.internal && (item.family === "IPv4" || item.family === 4),
    ).map((item) => ({ adapter, address: item.address })),
  ).filter(({ address }) =>
    /^10\./.test(address)
    || /^192\.168\./.test(address)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(address),
  );
  const physical = candidates.filter(({ adapter }) => !/\b(vethernet|virtual|wsl|docker|vmware|virtualbox|tailscale)\b/i.test(adapter));
  return (physical.length ? physical : candidates).sort((a, b) => {
    const score = ({ adapter, address }) =>
      (/wi-?fi|wireless/i.test(adapter) ? 0 : /ethernet/i.test(adapter) ? 10 : 20)
      + (/^192\.168\./.test(address) ? 0 : /^10\./.test(address) ? 1 : 2);
    return score(a) - score(b);
  })[0]?.address || null;
}

function previewDetails(port, extra = {}, lanAvailable = true) {
  const networkHost = privateLanAddress();
  return {
    port,
    localUrl: `http://localhost:${port}`,
    lanUrl: lanAvailable && networkHost ? `http://${networkHost}:${port}` : null,
    networkHost: lanAvailable ? networkHost : null,
    ...extra,
  };
}

function previewHostArgs(scriptCommand) {
  if (/\bnext(?:\.js)?\b/i.test(scriptCommand)) return ["--hostname", "0.0.0.0"];
  if (/\b(vite|astro|ng\s+serve|vue-cli-service\s+serve)\b/i.test(scriptCommand)) return ["--host", "0.0.0.0"];
  return [];
}

function staticPreviewServer(workspace, entry) {
  const entryFile = safeRelative(workspace, entry);
  const root = path.dirname(entryFile);
  const rootPrefix = `${path.resolve(root)}${path.sep}`;
  return createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url || "/", "http://localhost").pathname);
      const relative = pathname.replace(/^\/+/, "") || path.basename(entryFile);
      if (relative.split("/").some((part) => part.startsWith(".")) || /^package(?:-lock)?\.json$/i.test(path.basename(relative))) {
        response.writeHead(404).end("Not found");
        return;
      }
      let file = path.resolve(root, relative);
      if (file !== path.resolve(root) && !file.startsWith(rootPrefix)) {
        response.writeHead(400).end("Bad path");
        return;
      }
      try {
        const metadata = await stat(file);
        if (metadata.isDirectory()) file = path.join(file, "index.html");
        else if (!metadata.isFile()) throw new Error("Not a file");
      } catch {
        if (path.extname(relative)) {
          response.writeHead(404).end("Not found");
          return;
        }
        file = entryFile;
      }
      const type = STATIC_PREVIEW_TYPES[path.extname(file).toLowerCase()];
      if (!type) {
        response.writeHead(404).end("Not found");
        return;
      }
      const body = await readFile(file);
      response.writeHead(200, {
        "Content-Type": type,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      response.end(body);
    } catch {
      response.writeHead(404).end("Not found");
    }
  });
}

async function listenStaticPreview(server) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = 43100 + Math.floor(Math.random() * 800);
    const listening = await new Promise((resolve) => {
      const onError = () => { server.off("listening", onListening); resolve(false); };
      const onListening = () => { server.off("error", onError); resolve(true); };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "0.0.0.0");
    });
    if (listening) return port;
  }
  throw new Error("No local preview port is available.");
}

async function startPreviewServer(context, workspaceId) {
  const workspace = safeWorkspace(context.workspaceRoot, workspaceId);
  const id = cleanId(workspaceId);
  const existing = previewServers.get(id);
  if (existing) {
    try {
      const response = await fetch(`http://127.0.0.1:${existing.port}/`, { signal: AbortSignal.timeout(1200) });
      if (response.status < 500) {
        existing.lastUsed = Date.now();
        return previewDetails(existing.port, { reused: true, attached: Boolean(existing.attached), static: Boolean(existing.server) }, existing.lanAvailable !== false);
      }
    } catch {}
    stopPreviewRecord(id, existing);
  }
  const packageFile = safeRelative(workspace, "package.json");
  let manifest = null;
  try { manifest = JSON.parse(await readFile(packageFile, "utf8")); } catch {}
  const script = manifest?.scripts?.dev ? "dev" : manifest?.scripts?.start ? "start" : "";
  if (!script) {
    const files = await walkWorkspace(workspace);
    const entry = previewEntry(files);
    if (!entry) throw new Error("Add an index.html or a package.json dev script before opening a preview.");
    if (previewServers.size >= PREVIEW_SERVER_LIMIT) {
      const oldest = [...previewServers.entries()].sort((a, b) =>
        Number(a[1].lastUsed || a[1].startedAt || 0) - Number(b[1].lastUsed || b[1].startedAt || 0),
      )[0];
      if (oldest) stopPreviewRecord(oldest[0], oldest[1]);
    }
    const server = staticPreviewServer(workspace, entry);
    const port = await listenStaticPreview(server);
    server.unref();
    previewServers.set(id, { child: null, server, port, workspace, startedAt: Date.now(), lastUsed: Date.now(), attached: false, lanAvailable: true });
    return previewDetails(port, { reused: false, attached: false, static: true });
  }
  const scriptCommand = String(manifest.scripts[script] || "");
  const declaredPort = previewPortFor(manifest, scriptCommand);
  if (declaredPort) {
    try {
      const response = await fetch(`http://127.0.0.1:${declaredPort}/`, { signal: AbortSignal.timeout(1500) });
      if (response.status < 500) {
        const networkHost = privateLanAddress();
        let lanAvailable = false;
        if (networkHost) {
          try {
            const lanResponse = await fetch(`http://${networkHost}:${declaredPort}/`, { signal: AbortSignal.timeout(1500) });
            lanAvailable = lanResponse.status < 500;
          } catch {}
        }
        previewServers.set(id, { child: null, server: null, port: declaredPort, workspace, startedAt: Date.now(), lastUsed: Date.now(), attached: true, lanAvailable });
        return previewDetails(declaredPort, { reused: true, attached: true, static: false }, lanAvailable);
      }
    } catch {}
  }
  // Preview is deliberately passive for framework projects. Claude/Codex owns
  // shell commands and long-running processes; the bridge only discovers and
  // displays a server after the coding agent has started it.
  if (!declaredPort) {
    throw new Error(`No running dev server was found and the "${script}" script does not declare a detectable port. Ask Agent to start it on a specific port.`);
  }
  throw new Error(`No server is listening on port ${declaredPort}. Ask Agent to run the project's "${script}" command; Preview will attach after it starts.`);
}

function previewPortFor(manifest, script = "") {
  const configured = Number(manifest?.hyzr?.previewPort);
  if (Number.isInteger(configured) && configured >= 1024 && configured <= 65535) return configured;
  const explicit = String(script).match(/(?:--port(?:=|\s+)|(?:^|\s)-p(?:=|\s+)|\bPORT=)(\d{4,5})\b/i);
  if (explicit) return Number(explicit[1]);
  if (/\bvite\b/i.test(script)) return 5173;
  if (/\bastro\b/i.test(script)) return 4321;
  if (/\bng\s+serve\b|\bng\b.*\bserve\b/i.test(script)) return 4200;
  if (/\bvue-cli-service\s+serve\b/i.test(script)) return 8080;
  if (/\b(next|react-scripts|remix)\b/i.test(script)) return 3000;
  return null;
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
      if (!record || (record.child && record.child.killed)) await startPreviewServer(context, id);
      const active = previewServers.get(id);
      active.lastUsed = Date.now();
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
    // Version the provider session key so an agent upgrade cannot resume a
    // thread containing obsolete bridge instructions.
    const sessionKey = `${VERSION}:${cleanId(job.conversationId)}:${task.engine}`;
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

export async function detectAgentEnvironment(options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || DEFAULT_ROOT);
  await mkdir(workspaceRoot, { recursive: true });
  const tools = {
    claude: await locate("claude"),
    codex: await locate("codex"),
    git: await locate("git"),
    gh: await locate("gh"),
    npm: await locate("npm"),
  };
  if (!tools.claude && !tools.codex) throw new Error("Install and sign in to Claude Code or Codex before pairing Hyzr.");
  const permissionMode = options.permissionMode || "full-access";
  return {
    tools,
    capabilities: {
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
    },
  };
}

export async function startAgent(options = {}) {
  const saved = options.savedConfig || await readAgentConfig();
  const relay = cleanRelay(options.relay || saved.relay || "https://chat.hyzr.ai");
  const workspaceRoot = path.resolve(options.workspaceRoot || saved.workspaceRoot || DEFAULT_ROOT);
  const permissionMode = options.permissionMode || saved.permissionMode || "workspace";
  await mkdir(workspaceRoot, { recursive: true });

  const environment = options.environment || await detectAgentEnvironment({ workspaceRoot, permissionMode });
  const { tools, capabilities } = environment;

  const code = String(options.code || saved.pendingCode || "").toUpperCase();
  let token = options.token || saved.token || "";
  if (code) {
    const paired = await post(relay, "/api/agent/pair", { code, agent: capabilities });
    token = paired.token;
  }
  if (!token) throw new Error("A pairing code is required.");
  const persisted = { relay, token, workspaceRoot, permissionMode, pairedAt: Date.now() };
  if (options.persistConfig) await options.persistConfig(persisted);
  else await writeAgentConfig(persisted);
  options.onToken?.(token);

  // Polling pauses while Claude/Codex is working. Presence must not: otherwise
  // the website incorrectly declares the machine offline in the middle of a
  // healthy long-running task.
  let heartbeatBusy = false;
  const heartbeat = async () => {
    if (heartbeatBusy || options.signal?.aborted) return;
    heartbeatBusy = true;
    try {
      await fetch(`${relay}/api/agent/heartbeat`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(8_000),
      });
    } catch {}
    finally { heartbeatBusy = false; }
  };
  await heartbeat();
  const heartbeatTimer = setInterval(heartbeat, 5_000);
  heartbeatTimer.unref?.();

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
  try {
    while (!options.signal?.aborted) {
      try {
      const response = await fetch(`${relay}/api/agent/poll`, {
        cache: "no-store",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (response.status === 401) {
        throw Object.assign(new Error("The saved pairing was rejected."), { code: "PAIRING_EXPIRED" });
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
        if (error?.code === "PAIRING_EXPIRED") throw error;
        failures += 1;
        options.onStatus?.({ connected: false, error: error instanceof Error ? error.message : String(error) });
        await sleep(Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)) + Math.floor(Math.random() * 300));
      }
    }
  } finally {
    clearInterval(heartbeatTimer);
  }
}

function argumentsMap() {
  return Object.fromEntries(process.argv.slice(2).map((item) => {
    const [key, ...rest] = item.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  }));
}

async function runAgentCliLegacy() {
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
  let activeToken = "";
  let stopping = false;
  const controller = new AbortController();
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    controller.abort();
    sweepPreviewServers(true);
    if (activeToken) {
      try {
        await fetch(`${cleanRelay(relay)}/api/agent/disconnect`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: activeToken }),
          signal: AbortSignal.timeout(1500),
        });
      } catch {}
    }
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("SIGHUP", stop);
  try {
    await startAgent({
      relay,
      code,
      workspaceRoot,
      permissionMode,
      signal: controller.signal,
      onToken(token) { activeToken = token; },
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
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGHUP", stop);
  }
}

export async function runAgentCli() {
  const args = argumentsMap();
  if ("version" in args) {
    console.log(`Hyzr Agent ${VERSION} (protocol ${PROTOCOL})`);
    return;
  }

  let releaseLock;
  try {
    releaseLock = await acquireRuntimeLock();
  } catch (error) {
    if (error?.code === "ALREADY_RUNNING") {
      console.log(`\n  ${error.message}\n`);
      return;
    }
    throw error;
  }

  const saved = await readAgentConfig();
  const relay = args.url || process.env.HYZR_URL || saved.relay || "https://chat.hyzr.ai";
  let legacyCode = String(args.code || process.env.HYZR_CODE || "").replace(/\s/g, "").toUpperCase();
  const workspaceRoot = path.resolve(args.workspace || saved.workspaceRoot || DEFAULT_ROOT);
  const permissionMode = args.restricted === "true" ? "workspace" : (saved.permissionMode || "full-access");
  await mkdir(workspaceRoot, { recursive: true });

  const colors = process.stdout.isTTY && !process.env.NO_COLOR;
  const paint = (code, value) => colors ? `\x1b[${code}m${value}\x1b[0m` : value;
  const muted = (value) => paint("90", value);
  const green = (value) => paint("32", value);
  const cyan = (value) => paint("36", value);
  const yellow = (value) => paint("33", value);
  const environment = await detectAgentEnvironment({ workspaceRoot, permissionMode });
  const toolNames = [
    environment.capabilities.claude && "Claude",
    environment.capabilities.codex && "Codex",
    environment.capabilities.git && "Git",
    environment.capabilities.gh && "GitHub",
  ].filter(Boolean);

  console.log("");
  console.log(`  ${paint("1", "HYZR AGENT")} ${muted(`v${VERSION}`)}`);
  console.log(`  ${muted("────────────────────────────────────────")}`);
  console.log(`  ${muted("Computer")}   ${environment.capabilities.host}`);
  console.log(`  ${muted("Projects")}   ${workspaceRoot}`);
  console.log(`  ${muted("Tools")}      ${toolNames.join(" · ") || "No coding provider found"}`);
  console.log(`  ${muted("Access")}     ${permissionMode === "full-access" ? "Full local access" : "Project workspace only"}`);
  console.log("");

  if ("doctor" in args) {
    console.log(`  ${green("●")} Runtime is healthy`);
    console.log(`  ${muted("Relay")}      ${cleanRelay(relay)}`);
    console.log(`  ${muted("Config")}     ${CONFIG_FILE}`);
    console.log("");
    await releaseLock();
    return;
  }

  let connectionState = "";
  let activeToken = "";
  let stopping = false;
  const controller = new AbortController();
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    controller.abort();
    sweepPreviewServers(true);
    if (activeToken) {
      try {
        await fetch(`${cleanRelay(relay)}/api/agent/disconnect`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: activeToken }),
          signal: AbortSignal.timeout(1500),
        });
      } catch {}
    }
    await releaseLock?.();
    process.exit(0);
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("SIGHUP", stop);
  try {
    if (args.reset === "true") {
      await writeAgentConfig({ relay: cleanRelay(relay), workspaceRoot, permissionMode });
    }
    while (!controller.signal.aborted) {
      const current = await readAgentConfig();
      let token = current.token || "";
      try {
        if (!token && !legacyCode) {
          token = await deviceAuthorize(cleanRelay(relay), environment.capabilities, {
            signal: controller.signal,
            openBrowser: args.browser !== "false",
            onCode(flow) {
              connectionState = "pairing";
              console.log(`  ${yellow("●")} Pair this computer`);
              console.log(`  ${muted("Code")}       ${paint("1;36", flow.userCode)}`);
              console.log(`  ${muted("Browser")}    ${cyan(flow.verificationUriComplete)}`);
              console.log(`  ${muted("Waiting for approval… A new code appears automatically if this one expires.")}`);
              console.log("");
            },
            onExpired() {
              console.log(`  ${yellow("↻")} Code expired — generating a fresh one…`);
            },
            onWait(message) {
              if (connectionState !== "pair-wait") {
                connectionState = "pair-wait";
                console.log(`  ${yellow("↻")} Pairing service unavailable (${message}). Retrying…`);
              }
            },
          });
          activeToken = token;
          await writeAgentConfig({ relay: cleanRelay(relay), token, workspaceRoot, permissionMode, pairedAt: Date.now() });
          console.log(`  ${green("✓")} Approved securely`);
        }

        await startAgent({
          relay,
          code: legacyCode,
          token,
          savedConfig: current,
          environment,
          workspaceRoot,
          permissionMode,
          signal: controller.signal,
          persistConfig: writeAgentConfig,
          onToken(nextToken) {
            activeToken = nextToken;
            legacyCode = "";
          },
          onStatus(status) {
            if (status.connected && connectionState !== "connected") {
              connectionState = "connected";
              console.log(`  ${green("●")} Connected — build from the web or your phone`);
              console.log(`  ${muted("The launcher reconnects automatically. Press Ctrl+C to stop.")}`);
              console.log("");
            } else if (!status.connected && connectionState !== "reconnecting") {
              connectionState = "reconnecting";
              console.log(`  ${yellow("↻")} Connection interrupted — retrying automatically`);
            }
          },
        });
        break;
      } catch (error) {
        if (controller.signal.aborted || error?.code === "ABORTED") break;
        if (error?.code === "PAIRING_EXPIRED") {
          activeToken = "";
          connectionState = "reauthorizing";
          await writeAgentConfig({ relay: cleanRelay(relay), workspaceRoot, permissionMode });
          console.log(`  ${yellow("↻")} Pairing needs approval again — creating a fresh code…`);
          continue;
        }
        connectionState = "startup-retry";
        console.log(`  ${yellow("↻")} ${error instanceof Error ? error.message : String(error)}`);
        console.log(`  ${muted("Retrying in 5 seconds…")}`);
        await sleep(5_000);
      }
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGHUP", stop);
    await releaseLock?.();
  }
}

export async function loadAgentConfig() {
  return readAgentConfig();
}

export const __test = { cleanId, cleanRelay, safeWorkspace, safeRelative, selectExecutable, cmdQuote, engineFor, providerModel, transcript, previewEntry, previewPortFor, previewHostArgs, previewListenerPidsFromNetstat, privateLanAddress, startPreviewServer, sweepPreviewServers, streamSeparator, specialistPlan, processIsAlive, acquireRuntimeLock, deviceAuthorize };

runAgentCli().catch((error) => {
  console.error("\n  Hyzr stopped —", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
