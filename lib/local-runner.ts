// Drives the local, already-logged-in CLIs and streams their output.
// Prompts are fed via STDIN (both `claude -p` and `codex exec -` read stdin),
// which sidesteps all shell/Windows arg-escaping for multi-line prompts.
//
// Verified invocations (Windows, 2026-07):
//   claude -p --model <id> --output-format stream-json --include-partial-messages --verbose   (prompt on stdin)
//     -> NDJSON: stream_event/content_block_delta/text_delta ... then a `result` event with usage
//   codex exec [--model <id>] --json --output-last-message <file>
//        --dangerously-bypass-approvals-and-sandbox --skip-git-repo-check -                    (prompt on stdin)
//     -> JSONL: item.completed/agent_message.text ... turn.completed with usage
//   (sandbox is bypassed because a chat reply runs no shell commands; that mode
//    hangs on Windows otherwise.)

import { spawn } from "child_process";
import { promises as fs } from "fs";
import { existsSync } from "fs";
import readline from "readline";
import os from "os";
import path from "path";
import { Engine } from "./local-models";
import { WORKSPACE_ROOT, workspaceFor } from "./workspace";
export { WORKSPACE_ROOT, workspaceFor } from "./workspace";

export interface LocalChunk {
  type: "text" | "usage" | "error" | "status";
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  message?: string;
  code?: "execution_budget";
}

// Friendly label for a codex activity item, so the UI can show live progress
// like Claude Code ("Running command…", "Editing files…").
function codexLabel(item: any): string | null {
  if (!item?.type) return null;
  const map: Record<string, string> = {
    reasoning: "Reasoning",
    command_execution: "Running a command",
    file_change: "Editing files",
    patch_apply: "Applying changes",
    mcp_tool_call: "Calling a tool",
    web_search: "Searching the web",
    todo_list: "Planning steps",
  };
  if (item.command) {
    const command = Array.isArray(item.command) ? item.command.join(" ") : String(item.command);
    if (/powershell(?:\.exe)?/i.test(command)) return "Running a PowerShell command";
    if (/\bcmd(?:\.exe)?\b/i.test(command)) return "Running a shell command";
    const executable = command.replace(/^\s*["']?/, "").split(/[\\/\s"']/).filter(Boolean).pop() ?? "command";
    return `Running ${executable.slice(0, 36)}`;
  }
  if (item.path) return `Editing ${item.path}`;
  return map[item.type] ?? item.type.replace(/_/g, " ");
}

const IS_WIN = process.platform === "win32";
let tmpSeq = 0;

function nativeCli(cmd: string) {
  if (!IS_WIN) return cmd;
  const npmRoot = process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "node_modules") : "";
  const npmBin = process.env.APPDATA ? path.join(process.env.APPDATA, "npm") : "";
  const candidates = cmd === "claude" ? [
    path.join(npmRoot, "@anthropic-ai", "claude-code", "bin", "claude.exe"),
    path.join(npmBin, "claude.cmd"),
  ] : cmd === "codex" ? [
    path.join(npmRoot, "@openai", "codex", "node_modules", "@openai", "codex-win32-x64", "vendor", "x86_64-pc-windows-msvc", "bin", "codex.exe"),
  ] : [];
  return candidates.find((candidate) => candidate && existsSync(candidate)) || cmd;
}

function cmdQuote(value: string) {
  return `"${String(value).replace(/[\r\n]/g, " ").replace(/%/g, "%%").replace(/"/g, '""')}"`;
}

function commandLaunch(command: string, args: string[]) {
  if (!(IS_WIN && /\.(cmd|bat)$/i.test(command))) {
    return { command, args, windowsVerbatimArguments: false };
  }
  return {
    command: process.env.ComSpec || "C:\\Windows\\System32\\cmd.exe",
    args: ["/d", "/s", "/c", `call ${cmdQuote(command)} ${args.map(cmdQuote).join(" ")}`],
    windowsVerbatimArguments: true,
  };
}

// Codex returns its whole message at once (no token deltas). To match Claude's
// "read it as it's written" feel, reveal the text in small chunks.
async function* reveal(text: string): AsyncGenerator<LocalChunk> {
  const parts = text.split(/(\s+)/); // keep whitespace tokens
  const per = Math.max(1, Math.ceil(parts.length / 140)); // ~140 steps max
  for (let i = 0; i < parts.length; i += per) {
    yield { type: "text", text: parts.slice(i, i + per).join("") };
    await new Promise((r) => setTimeout(r, 11));
  }
}

// CRITICAL: the local CLIs (codex/claude) are AGENTIC — they can write files
// and run commands. We MUST NOT let them run in the Hyzr Chat source directory, or a
// "build me an app" prompt will overwrite Hyzr Chat's own code (this actually
// happened). Every CLI runs with its cwd pinned to an isolated workspace dir
// outside the project, so any files an agent creates land there.
// Because the agents CAN write files, they otherwise treat every request as a
// file task ("I couldn't find that in your working directory"). This guidance
// keeps normal chat inline and only builds files on an explicit ask.
const GUIDANCE =
  "You are Hyzr Chat, a coding assistant. Treat this chat and its isolated working directory as the entire project context. " +
  "Never infer files, requirements, or project state from any other conversation or directory. If the user includes code inline or asks a " +
  "question, answer directly in your message — do NOT look for or create files. " +
  "Only create, edit, or run files when the user explicitly asks you to build, " +
  "create, scaffold, save, deploy, or run something, or names a specific file. " +
  "Your working directory is a disposable scratch workspace. Run the commands the user requests and report their actual output and exact URLs without rewriting hostnames or ports. Format answers in Markdown. " +
  // Craft bar — lifts every model to frontier-level thoroughness so routing to a
  // cheaper model does not cost quality (targets thin tests and fabricated content).
  "When you build something, finish it completely: handle edge cases and errors, wire every part together so it actually runs, and leave no stubs, TODOs, or placeholders-as-features. " +
  "If you write tests, cover the real edge cases and failure modes, not just the happy path. " +
  "Never fabricate data, results, credentials, customer names, testimonials, logos, or endorsements — use clearly-labeled placeholder content and never present invented facts as real.";
async function ensureWorkspace(id?: string) {
  const workspace = workspaceFor(id);
  try { await fs.mkdir(workspace, { recursive: true }); } catch {}
  return workspace;
}

// Turn the chat history into a single prompt. The CLIs are one-shot, so we
// embed prior turns as context and end on the new user message.
export function buildPrompt(
  messages: { role: "user" | "assistant"; content: string }[],
): string {
  // A one-shot CLI must not receive an ever-growing transcript. Keep the
  // current request intact and spend a fixed context budget on recent turns.
  const selected: typeof messages = [];
  let budget = 9000;
  for (let i = messages.length - 1; i >= 0 && selected.length < 6 && budget > 0; i--) {
    const limit = selected.length === 0 ? 6000 : 1200;
    const content = messages[i].content.slice(-Math.min(limit, budget));
    selected.unshift({ ...messages[i], content });
    budget -= content.length;
  }
  if (selected.length === 1) return `${GUIDANCE}\n\n${selected[0].content}`;
  const lines = selected.map(
    (m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`,
  );
  return (
    `${GUIDANCE}\n\nContinue this conversation. Reply only as the assistant to the final user message.\n\n` +
    lines.join("\n\n")
  );
}

// Planner context is deliberately smaller than executor context. It needs the
// current request and a little project continuity, not previous model prose or
// tool transcripts.
export function buildRoutingContext(
  messages: { role: "user" | "assistant"; content: string }[],
): string {
  const selected: typeof messages = [];
  let budget = 7000;
  for (let i = messages.length - 1; i >= 0 && selected.length < 5 && budget > 0; i--) {
    const limit = selected.length === 0 ? 5000 : 700;
    const content = messages[i].content.slice(-Math.min(limit, budget));
    selected.unshift({ ...messages[i], content });
    budget -= content.length;
  }
  return selected.map((message) => `${message.role === "user" ? "User" : "Assistant"}: ${message.content}`).join("\n\n");
}

async function* spawnLines(
  cmd: string,
  args: string[],
  prompt: string,
  workspaceId?: string,
  signal?: AbortSignal,
): AsyncGenerator<{ line?: string; stderr?: string; code?: number }> {
  const cwd = await ensureWorkspace(workspaceId);
  const executable = nativeCli(cmd);
  // Native provider executables avoid shell interpolation entirely. The shell
  // fallback supports nonstandard Windows installs; every argument is still
  // selected by Hyzr Chat and the user prompt always travels over stdin.
  const launch = commandLaunch(executable, args);
  const child = spawn(launch.command, launch.args, {
    cwd,
    windowsHide: true,
    windowsVerbatimArguments: launch.windowsVerbatimArguments,
  });
  let aborted = false;
  const stop = () => {
    aborted = true;
    if (!child.pid || child.killed) return;
    if (IS_WIN) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  };
  if (signal?.aborted) stop();
  signal?.addEventListener("abort", stop, { once: true });
  if (!signal?.aborted) {
    child.stdin.write(prompt);
    child.stdin.end();
  }

  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));

  const rl = readline.createInterface({ input: child.stdout });
  const exited = new Promise<number>((resolve) =>
    child.on("close", (code) => resolve(code ?? 0)),
  );

  for await (const line of rl) {
    if (aborted) break;
    yield { line };
  }
  const code = await exited;
  signal?.removeEventListener("abort", stop);
  yield { stderr: aborted ? "Run stopped by user" : stderr, code: aborted ? 130 : code };
}

async function* runClaude(
  prompt: string,
  model: string,
  images: string[] = [],
  workspaceId?: string,
  effort?: string,
  signal?: AbortSignal,
): AsyncGenerator<LocalChunk> {
  // Claude can view images via its Read tool — point it at the files.
  if (images.length) {
    prompt = `${prompt}\n\n[The user attached ${images.length} image(s). View each with the Read tool:]\n${images.join("\n")}`;
  }
  const args = [
    "-p",
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
    ...(effort ? ["--effort", effort === "ultra" ? "max" : effort] : []),
    // Safe now: every CLI runs with cwd pinned to the isolated ~/Hyzr Chat-workspace
    // (see WORKSPACE), so granting file/command tools can't touch Hyzr Chat's source.
    // This lets Claude actually BUILD apps (like Codex), not just describe them.
    "--dangerously-skip-permissions",
  ];
  let sawText = false;
  let resultText = "";
  let usage: any;
  let errored = false;
  let textBlockOpen = false;

  for await (const out of spawnLines("claude", args, prompt, workspaceId, signal)) {
    if (out.line !== undefined) {
      const t = out.line.trim();
      if (!t) continue;
      let ev: any;
      try {
        ev = JSON.parse(t);
      } catch {
        continue;
      }
      if (ev.type === "stream_event" && ev.event?.type === "content_block_start") {
        textBlockOpen = false;
      } else if (
        ev.type === "stream_event" &&
        ev.event?.type === "content_block_delta" &&
        ev.event.delta?.type === "text_delta"
      ) {
        if (!textBlockOpen && sawText) yield { type: "text", text: "\n\n" };
        textBlockOpen = true;
        sawText = true;
        yield { type: "text", text: ev.event.delta.text };
      } else if (ev.type === "stream_event" && ev.event?.type === "content_block_stop") {
        textBlockOpen = false;
      } else if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
        // Surface tool use as live activity.
        for (const c of ev.message.content) {
          if (c?.type === "tool_use" && c.name) {
            const labels: Record<string, string> = {
              Read: "Reading project files",
              Write: "Updating project files",
              Edit: "Editing project files",
              PowerShell: "Running a command",
              Bash: "Running a command",
              Glob: "Finding project files",
              Grep: "Searching project files",
            };
            yield { type: "status", text: labels[c.name] ?? `Using ${c.name}` };
          }
        }
      } else if (ev.type === "result") {
        resultText = ev.result ?? "";
        usage = ev.usage;
        if (ev.is_error) {
          errored = true;
          yield { type: "error", message: ev.result || "Claude CLI error" };
        }
      }
    } else {
      if (out.code && out.code !== 0 && !sawText && !errored) {
        yield {
          type: "error",
          message: out.stderr?.trim() || `claude exited with code ${out.code}`,
        };
      }
    }
  }
  if (!sawText && !errored && resultText) yield { type: "text", text: resultText };
  if (usage)
    yield {
      type: "usage",
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cache_read_input_tokens ?? 0,
      cacheCreationTokens: usage.cache_creation_input_tokens ?? 0,
    };
}

async function* runCodex(
  prompt: string,
  model: string,
  images: string[] = [],
  workspaceId?: string,
  effort?: string,
  signal?: AbortSignal,
): AsyncGenerator<LocalChunk> {
  const workspace = await ensureWorkspace(workspaceId);
  const tmp = path.join(os.tmpdir(), `hyzr-chat-codex-${process.pid}-${tmpSeq++}.txt`);
  const imageArgs = images.flatMap((p) => ["-i", p]);
  const args = [
    "exec",
    "-C",
    workspace, // pin codex's working dir to this chat's isolated workspace
    ...(model ? ["--model", model] : []),
    ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
    ...imageArgs,
    "--json",
    "--output-last-message",
    tmp,
    "--dangerously-bypass-approvals-and-sandbox",
    "--skip-git-repo-check",
    "-",
  ];
  let agentText = "";
  let usage: any;
  let failureMessage = "";

  for await (const out of spawnLines("codex", args, prompt, workspaceId, signal)) {
    if (out.line !== undefined) {
      let ev: any;
      try {
        ev = JSON.parse(out.line.trim());
      } catch {
        continue;
      }
      if (
        ev.type === "item.completed" &&
        ev.item?.type === "agent_message" &&
        ev.item.text
      ) {
        // Capture; reveal progressively AFTER the run so it types out.
        agentText = ev.item.text;
      } else if (
        (ev.type === "item.started" || ev.type === "item.completed") &&
        ev.item?.type &&
        ev.item.type !== "agent_message"
      ) {
        const label = codexLabel(ev.item);
        if (label) yield { type: "status", text: label };
      } else if (ev.type === "turn.completed" && ev.usage) {
        usage = ev.usage;
      }
    } else if (out.code && out.code !== 0 && !agentText) {
      const cleanedStderr = (out.stderr ?? "")
        .split(/\r?\n/)
        .filter((line) => !/^\s*(?:\u26a0\s*)?\d{4}-\d{2}-\d{2}T\S+\s+WARN\s+codex_core::shell_snapshot\b/i.test(line))
        .join("\n")
        .trim();
      failureMessage = cleanedStderr || `The model process exited before producing a response (code ${out.code}).`;
    }
  }

  if (failureMessage && !agentText) yield { type: "error", message: failureMessage };

  let emitted = false;
  if (agentText) {
    agentText = agentText
      .split(/\r?\n/)
      .filter((line) => !/^\s*(?:>\s*)?(?:\u26a0\s*)?\d{4}-\d{2}-\d{2}T\S+\s+WARN\s+codex_core::shell_snapshot\b/i.test(line))
      .join("\n")
      .trim();
  }
  if (agentText) {
    emitted = true;
    yield* reveal(agentText);
  }

  if (!emitted) {
    try {
      const txt = await fs.readFile(tmp, "utf8");
      if (txt.trim()) yield { type: "text", text: txt };
    } catch {}
  }
  if (usage)
    yield {
      type: "usage",
      inputTokens: usage.input_tokens ?? 0,
      outputTokens: usage.output_tokens ?? 0,
      cacheReadTokens: usage.cached_input_tokens ?? 0,
    };
  try {
    await fs.unlink(tmp);
  } catch {}
}

export interface RunOpts {
  images?: string[]; // absolute paths to image files to attach
  noReveal?: boolean; // skip the typewriter reveal (planner/followups)
  workspaceId?: string;
  effort?: string;
  signal?: AbortSignal;
  maxDurationMs?: number;
  maxActivityEvents?: number;
  maxAttempts?: number;
}

async function* runCodexOuter(
  prompt: string,
  model: string,
  opts: RunOpts,
): AsyncGenerator<LocalChunk> {
  if (opts.noReveal) {
    // collect + emit at once (used by planner) — no artificial delay
    let text = "";
    for await (const c of runCodex(prompt, model, opts.images ?? [], opts.workspaceId, opts.effort, opts.signal)) {
      if (c.type === "text") text += c.text ?? "";
      else yield c;
    }
    if (text) yield { type: "text", text };
  } else {
    yield* runCodex(prompt, model, opts.images ?? [], opts.workspaceId, opts.effort, opts.signal);
  }
}

function runLocalOnce(
  engine: Engine,
  model: string,
  prompt: string,
  opts: RunOpts = {},
): AsyncGenerator<LocalChunk> {
  return engine === "codex"
    ? runCodexOuter(prompt, model, opts)
    : runClaude(prompt, model, opts.images ?? [], opts.workspaceId, opts.effort, opts.signal);
}

export async function* runLocal(
  engine: Engine,
  model: string,
  prompt: string,
  opts: RunOpts = {},
): AsyncGenerator<LocalChunk> {
  const transient = /\b(load failed|connection (?:failed|reset)|temporarily unavailable|service unavailable|timed? out|network error|rate limit)\b/i;
  const maxAttempts = Math.max(1, Math.min(3, opts.maxAttempts ?? 2));
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController();
    let budgetReason = "";
    let activityEvents = 0;
    const stopForUser = () => controller.abort(opts.signal?.reason);
    if (opts.signal?.aborted) stopForUser();
    opts.signal?.addEventListener("abort", stopForUser, { once: true });
    const timer = opts.maxDurationMs ? setTimeout(() => {
      budgetReason = `Runtime ceiling reached after ${Math.round(opts.maxDurationMs! / 1000)} seconds`;
      controller.abort(new Error(budgetReason));
    }, opts.maxDurationMs) : undefined;
    timer?.unref?.();
    let emittedText = false;
    let retryMessage = "";
    for await (const chunk of runLocalOnce(engine, model, prompt, { ...opts, signal: controller.signal })) {
      if (chunk.type === "status") {
        activityEvents++;
        if (!budgetReason && opts.maxActivityEvents && activityEvents > opts.maxActivityEvents) {
          budgetReason = `Tool-activity ceiling reached after ${opts.maxActivityEvents} events`;
          controller.abort(new Error(budgetReason));
          continue;
        }
      }
      if (budgetReason) continue;
      if (chunk.type === "text" && chunk.text) emittedText = true;
      if (chunk.type === "error" && !emittedText && transient.test(chunk.message || "") && attempt < maxAttempts - 1) {
        retryMessage = chunk.message || "Temporary provider failure";
        continue;
      }
      yield chunk;
    }
    if (timer) clearTimeout(timer);
    opts.signal?.removeEventListener("abort", stopForUser);
    if (budgetReason) {
      yield { type: "error", code: "execution_budget", message: budgetReason };
      return;
    }
    if (!retryMessage) return;
    if (opts.signal?.aborted) return;
    const delay = 750 * 2 ** attempt;
    yield { type: "status", text: `Provider connection interrupted; retrying safely (${attempt + 1}/${maxAttempts - 1})` };
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

// Run a model to completion and return the full text (used by the planner).
export async function collectLocal(
  engine: Engine,
  model: string,
  prompt: string,
  effort?: string,
  signal?: AbortSignal,
): Promise<string> {
  let out = "";
  for await (const chunk of runLocal(engine, model, prompt, {
    noReveal: true,
    effort,
    signal,
    maxAttempts: 1,
    maxDurationMs: 45_000,
    maxActivityEvents: 4,
  })) {
    if (chunk.type === "text") out += chunk.text ?? "";
    if (chunk.type === "error") throw new Error(chunk.message ?? "runner error");
  }
  return out.trim();
}
