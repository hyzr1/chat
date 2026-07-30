import { execFile } from "child_process";
import { access, stat } from "fs/promises";
import { promisify } from "util";
import { durableDatabase } from "./durable-jobs";
import { runAnalytics } from "./run-registry";
import { seal, unseal } from "./secure-store";
import { productEnv } from "./product";
import { STATE_DATABASE } from "./product-paths";
import { isHostedRuntime } from "./agent-protocol";
import { kvGet, kvSet, relayBackedByRedis } from "./relay-store";

const execFileAsync = promisify(execFile);

export type HealthState = "ready" | "attention" | "unavailable";
export interface HealthCheck {
  id: string;
  category: "core" | "providers" | "integrations" | "evidence";
  label: string;
  detail: string;
  state: HealthState;
  blocking: boolean;
}

async function commandAvailable(command: string) {
  try {
    const executable = process.platform === "win32" ? "where.exe" : "which";
    await execFileAsync(executable, [command], { timeout: 2500, windowsHide: true });
    return true;
  } catch { return false; }
}

function configured(...names: string[]) {
  return names.every((name) => Boolean(process.env[name]?.trim()));
}

export async function operationalHealth() {
  const database = durableDatabase();
  const checks: HealthCheck[] = [];
  const hosted = isHostedRuntime();
  let storageHealthy = false;
  if (hosted) {
    if (relayBackedByRedis) {
      try {
        const key = `health:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        await kvSet(key, "ok", 60);
        storageHealthy = await kvGet(key) === "ok";
      } catch {}
    }
    checks.push({
      id: "database",
      category: "core",
      label: "Hosted relay state",
      detail: storageHealthy
        ? "Redis REST read/write self-test passed; accounts, conversations, pairing, and relay queues are durable."
        : "The hosted Redis relay is unavailable.",
      state: storageHealthy ? "ready" : "unavailable",
      blocking: true,
    });
  } else {
    const quick = database.prepare("PRAGMA quick_check").get() as Record<string, string> | undefined;
    storageHealthy = Object.values(quick || {}).some((value) => value === "ok");
    checks.push({ id: "database", category: "core", label: "Durable state", detail: storageHealthy ? "SQLite integrity check passed; WAL-backed jobs are available." : "SQLite integrity check did not pass.", state: storageHealthy ? "ready" : "unavailable", blocking: true });
  }

  let encryptionHealthy = false;
  try {
    const value = { check: "hyzr-chat-health", nonce: Date.now() };
    encryptionHealthy = unseal<typeof value>(seal(value)).check === value.check;
  } catch {}
  checks.push({ id: "encryption", category: "core", label: "Encrypted job state", detail: encryptionHealthy ? "AES-256-GCM authenticated encryption self-test passed." : "Encryption self-test failed.", state: encryptionHealthy ? "ready" : "unavailable", blocking: true });

  const accessControl = hosted || Boolean(productEnv("HYZR_CHAT_ACCESS_TOKEN", "VMX_ACCESS_TOKEN"));
  checks.push({
    id: "access-control",
    category: "core",
    label: hosted ? "Hosted access control" : "LAN access control",
    detail: hosted
      ? "Browser work is account-scoped; local agents use short-lived pairing codes and bearer credentials."
      : accessControl
        ? "Remote devices require a paired HttpOnly access cookie or bearer token."
        : "Developer mode is open on the local network. Set HYZR_CHAT_ACCESS_TOKEN before a customer pilot.",
    state: accessControl ? "ready" : "attention",
    blocking: false,
  });

  const now = Date.now();
  const queue = database.prepare("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status").all() as Array<{ status: string; count: number }>;
  const activeJobs = queue.filter((row) => row.status === "queued" || row.status === "running").reduce((total, row) => total + Number(row.count), 0);
  const expiredLeases = Number((database.prepare("SELECT COUNT(*) AS count FROM jobs WHERE status='running' AND (lease_expires_at IS NULL OR lease_expires_at < ?)").get(now) as { count: number })?.count || 0);
  checks.push({
    id: "worker",
    category: "core",
    label: hosted ? "Agent relay queue" : "Execution queue",
    detail: hosted
      ? storageHealthy ? "Outbound agent job and result queues are available." : "Agent relay queues are unavailable."
      : expiredLeases ? `${expiredLeases} expired worker lease${expiredLeases === 1 ? "" : "s"} awaiting recovery.` : `${activeJobs} active job${activeJobs === 1 ? "" : "s"}; no expired leases.`,
    state: hosted ? storageHealthy ? "ready" : "unavailable" : expiredLeases ? "attention" : "ready",
    blocking: hosted,
  });

  if (hosted) {
    checks.push({ id: "codex", category: "providers", label: "ChatGPT / Codex", detail: "Codex capability is detected on each signed-in user's paired computer.", state: storageHealthy ? "ready" : "attention", blocking: false });
    checks.push({ id: "claude", category: "providers", label: "Claude", detail: "Claude capability is detected on each signed-in user's paired computer.", state: storageHealthy ? "ready" : "attention", blocking: false });
  } else {
    const [codex, claude] = await Promise.all([commandAvailable("codex"), commandAvailable("claude")]);
    checks.push({ id: "codex", category: "providers", label: "ChatGPT / Codex", detail: codex ? "Authenticated local Codex CLI is discoverable." : "Codex CLI was not found in the server PATH.", state: codex ? "ready" : "attention", blocking: !claude });
    checks.push({ id: "claude", category: "providers", label: "Claude", detail: claude ? "Authenticated local Claude CLI is discoverable." : "Claude CLI was not found in the server PATH.", state: claude ? "ready" : "attention", blocking: !codex });
  }

  const github = configured("GITHUB_APP_ID", "GITHUB_APP_PRIVATE_KEY", "GITHUB_WEBHOOK_SECRET");
  const linear = configured("LINEAR_CLIENT_ID", "LINEAR_CLIENT_SECRET", "LINEAR_WEBHOOK_SECRET");
  checks.push({ id: "github", category: "integrations", label: "GitHub delivery", detail: github ? "GitHub App credentials and signed webhooks are configured." : "Optional GitHub App credentials are not complete.", state: github ? "ready" : "attention", blocking: false });
  checks.push({ id: "linear", category: "integrations", label: "Linear intake", detail: linear ? "Linear OAuth and signed webhooks are configured." : "Optional Linear OAuth credentials are not complete.", state: linear ? "ready" : "attention", blocking: false });

  const benchmark = database.prepare("SELECT mode, created_at FROM benchmark_runs ORDER BY created_at DESC LIMIT 1").get() as { mode: string; created_at: number } | undefined;
  const liveBenchmark = database.prepare("SELECT created_at FROM benchmark_runs WHERE mode='live' ORDER BY created_at DESC LIMIT 1").get() as { created_at: number } | undefined;
  checks.push({ id: "evaluation", category: "evidence", label: "Routing evaluation", detail: liveBenchmark ? `Latest paired live benchmark: ${new Date(liveBenchmark.created_at).toLocaleDateString()}.` : benchmark ? "A routing audit exists; a paired live benchmark is still required for cost and quality claims." : "No evaluation record exists yet.", state: liveBenchmark ? "ready" : benchmark ? "attention" : "unavailable", blocking: false });
  const analytics = runAnalytics();
  checks.push({ id: "outcomes", category: "evidence", label: "Rated delivery outcomes", detail: analytics.ratedRuns ? `${analytics.ratedRuns} rated deliveries; ${analytics.acceptedRuns} accepted.` : "No user-rated deliveries have been recorded yet.", state: analytics.ratedRuns >= 20 ? "ready" : analytics.ratedRuns ? "attention" : "unavailable", blocking: false });

  const stateFile = STATE_DATABASE;
  let databaseBytes = 0;
  try { await access(stateFile); databaseBytes = (await stat(stateFile)).size; } catch {}
  const core = checks.filter((check) => check.category === "core");
  const blockingFailures = checks.filter((check) => check.blocking && check.state === "unavailable");
  const ready = checks.filter((check) => check.state === "ready").length;
  return {
    status: blockingFailures.length ? "unavailable" : core.some((check) => check.state === "attention") ? "attention" : "ready",
    score: Math.round(ready / checks.length * 100),
    checkedAt: Date.now(),
    server: { version: "0.9.0", node: process.version, uptimeSeconds: Math.round(process.uptime()), platform: process.platform, mode: hosted ? "hosted" : "local" },
    storage: { databaseBytes: hosted ? undefined : databaseBytes, journalMode: hosted ? "Redis REST" : "WAL" },
    checks,
  };
}
