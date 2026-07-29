import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { workspaceFor } from "./local-runner";
import type { VerificationCheck } from "./verifier";

const execFileAsync = promisify(execFile);
const ignored = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage"]);
const secretPatterns = [
  { label: "GitHub token", pattern: /\bgh[opusr]_[A-Za-z0-9_]{30,}\b/g },
  { label: "OpenAI key", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { label: "Anthropic key", pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { label: "Private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
];

async function secretScan(root: string) {
  const findings: string[] = [];
  async function walk(directory: string, depth = 0) {
    if (depth > 8 || findings.length > 50) return;
    let entries: import("fs").Dirent[] = [];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute, depth + 1);
      else if (entry.isFile()) {
        const stat = await fs.stat(absolute).catch(() => undefined);
        if (!stat || stat.size > 1_000_000 || /\.(?:png|jpe?g|gif|webp|ico|woff2?|zip|pdf)$/i.test(entry.name)) continue;
        const content = await fs.readFile(absolute, "utf8").catch(() => "");
        for (const candidate of secretPatterns) if (candidate.pattern.test(content)) findings.push(`${candidate.label}: ${path.relative(root, absolute)}`);
      }
    }
  }
  await walk(root);
  return findings;
}

export async function verifySecurity(workspaceId?: string): Promise<VerificationCheck[]> {
  const root = workspaceFor(workspaceId);
  const checks: VerificationCheck[] = [];
  const secretStarted = Date.now();
  const secrets = await secretScan(root);
  checks.push({ id: "secret-scan", label: "Credential and private-key scan", status: secrets.length ? "failed" : "passed", durationMs: Date.now() - secretStarted, output: secrets.length ? secrets.join("\n") : "No high-confidence committed secrets were detected." });
  try {
    await fs.access(path.join(root, "package-lock.json"));
    const started = Date.now();
    const executable = process.platform === "win32" ? "npm.cmd" : "npm";
    let output = "";
    try { output = (await execFileAsync(executable, ["audit", "--omit=dev", "--json"], { cwd: root, windowsHide: true, timeout: 120_000, maxBuffer: 8 * 1024 * 1024 })).stdout; }
    catch (error: any) { output = String(error?.stdout || error?.stderr || "{}"); }
    let vulnerabilities: Record<string, number> = {};
    try { vulnerabilities = JSON.parse(output).metadata?.vulnerabilities || {}; } catch {}
    const blocking = (vulnerabilities.high || 0) + (vulnerabilities.critical || 0);
    checks.push({ id: "dependency-audit", label: "Production dependency vulnerability audit", status: blocking ? "failed" : "passed", command: "npm audit --omit=dev --json", durationMs: Date.now() - started, output: JSON.stringify(vulnerabilities) });
  } catch {
    checks.push({ id: "dependency-audit", label: "Production dependency vulnerability audit", status: "skipped", durationMs: 0, output: "No npm lockfile was found." });
  }
  return checks;
}
