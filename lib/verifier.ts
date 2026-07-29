import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { workspaceFor } from "./local-runner";
import { buildRepositoryIntelligence, type RepositoryIntelligence } from "./repository-intelligence";
import { verifyBrowserExperience } from "./browser-verifier";
import { verifySecurity } from "./security-verifier";

export interface VerificationCheck {
  id: string;
  label: string;
  status: "passed" | "failed" | "skipped";
  command?: string;
  durationMs: number;
  output?: string;
}

export interface VerificationOptions {
  baselineFingerprint?: string;
  requireMutation?: boolean;
}

export function requestRequiresWorkspaceMutation(prompt: string) {
  if (/\b(?:start|stop|restart|reopen|verify|check)\b.{0,64}\b(?:server|dev server|port|process|localhost)\b/i.test(prompt)) return false;
  if (/\b(?:explain|summarize|research|analyze|review)\b/i.test(prompt) && !/\b(?:fix|edit|change|implement|apply)\b/i.test(prompt)) return false;
  return /\b(?:make|build|create|implement|fix|change|update|redesign|generate|add|remove|edit|refactor|rename|scaffold)\b/i.test(prompt);
}

function execute(command: string, args: string[], cwd: string, timeout = 120_000) {
  return new Promise<{ ok: boolean; output: string; durationMs: number }>((resolve) => {
    const started = Date.now();
    execFile(command, args, { cwd, windowsHide: true, timeout, maxBuffer: 1024 * 1024 * 4 }, (error, stdout, stderr) => {
      const output = `${stdout || ""}\n${stderr || ""}`.trim().slice(-12_000);
      resolve({ ok: !error, output, durationMs: Date.now() - started });
    });
  });
}

async function packageScripts(root: string) {
  try {
    const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    return pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts as Record<string, string> : {};
  } catch { return {}; }
}

export async function verifyWorkspace(workspaceId?: string, options: VerificationOptions = {}): Promise<{ repository: RepositoryIntelligence; checks: VerificationCheck[]; passed: boolean }> {
  const root = workspaceFor(workspaceId);
  const repository = await buildRepositoryIntelligence(workspaceId);
  const checks: VerificationCheck[] = [];
  if (options.requireMutation) {
    const changed = !options.baselineFingerprint || repository.fingerprint !== options.baselineFingerprint;
    checks.push({
      id: "delivery-delta",
      label: "Requested workspace change exists",
      status: changed ? "passed" : "failed",
      durationMs: 0,
      output: changed ? "The repository fingerprint changed during this run." : "The request required an implementation, but no workspace change was detected.",
    });
  }
  if (!repository.files) {
    if (!options.requireMutation) checks.push({ id: "project-output", label: "Project output exists", status: "skipped", durationMs: 0, output: "The workspace is empty and this request did not require a file change." });
    return { repository, checks, passed: checks.every((check) => check.status !== "failed") };
  }
  const scripts = await packageScripts(root);
  const executable = process.platform === "win32" ? "npm.cmd" : "npm";
  const selected = ["typecheck", "lint", "test", "build"].filter((name) => scripts[name]).slice(0, 3);
  for (const name of selected) {
    const result = await execute(executable, ["run", name], root, name === "build" ? 180_000 : 120_000);
    checks.push({ id: `npm-${name}`, label: `npm run ${name}`, command: `npm run ${name}`, status: result.ok ? "passed" : "failed", durationMs: result.durationMs, output: result.output });
    if (!result.ok) break;
  }
  if (!selected.length) {
    const html = repository.entrypoints.find((entry) => /(?:^|\/)index\.html$/i.test(entry));
    if (html) {
      const started = Date.now();
      const content = await fs.readFile(path.join(root, html), "utf8").catch(() => "");
      const valid = /<!doctype html|<html[\s>]/i.test(content) && /<\/html>/i.test(content);
      checks.push({ id: "static-html", label: "Static HTML structure", status: valid ? "passed" : "failed", durationMs: Date.now() - started, output: valid ? "Document contains an HTML root and closing tag." : "index.html is missing a complete document structure." });
    } else {
      checks.push({ id: "project-files", label: "Project output exists", status: "passed", durationMs: 0, output: `${repository.files} project files present.` });
    }
  }
  checks.push(...await verifySecurity(workspaceId));
  checks.push(...await verifyBrowserExperience(workspaceId));
  const passed = checks.every((check) => check.status !== "failed");
  return { repository, checks, passed };
}
