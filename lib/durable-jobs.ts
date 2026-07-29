import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "fs";
import path from "path";
import { seal, unseal } from "./secure-store";
import { STATE_DATABASE, STATE_DIRECTORY } from "./product-paths";

export type DurableJobStatus = "queued" | "running" | "completed" | "needs_attention" | "cancelled";

export interface DurableJob<T = unknown> {
  id: string;
  workspaceId: string;
  status: DurableJobStatus;
  payload: T;
  attempt: number;
  maxAttempts: number;
  checkpointTask: number;
  leaseOwner?: string;
  leaseExpiresAt?: number;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export type BenchmarkJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export interface BenchmarkJob<T = unknown> {
  id: string;
  mode: "dry" | "live";
  status: BenchmarkJobStatus;
  dataset: string;
  premiumModelId: string;
  completedRuns: number;
  totalRuns: number;
  result: T;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

type JobRow = {
  id: string;
  workspace_id: string;
  status: DurableJobStatus;
  payload_ciphertext: string;
  attempt: number;
  max_attempts: number;
  checkpoint_task: number;
  lease_owner: string | null;
  lease_expires_at: number | null;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

const stateDirectory = STATE_DIRECTORY;
mkdirSync(stateDirectory, { recursive: true });

const shared = globalThis as typeof globalThis & { __hyzrChatDatabase?: DatabaseSync };
const database = shared.__hyzrChatDatabase ?? (shared.__hyzrChatDatabase = new DatabaseSync(STATE_DATABASE, {
  timeout: 5000,
  defensive: true,
}));

database.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued','running','completed','needs_attention','cancelled')),
    payload_ciphertext TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    checkpoint_task INTEGER NOT NULL DEFAULT -1,
    lease_owner TEXT,
    lease_expires_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS jobs_status_created ON jobs(status, created_at);
  CREATE INDEX IF NOT EXISTS jobs_lease ON jobs(status, lease_expires_at);
  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    provider TEXT NOT NULL,
    delivery_id TEXT NOT NULL,
    received_at INTEGER NOT NULL,
    payload_sha256 TEXT NOT NULL,
    status TEXT NOT NULL,
    PRIMARY KEY(provider, delivery_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS integration_tokens (
    provider TEXT NOT NULL,
    account_id TEXT NOT NULL,
    token_ciphertext TEXT NOT NULL,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(provider, account_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS deliveries (
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    run_id TEXT NOT NULL,
    repository TEXT,
    branch TEXT,
    base_sha TEXT,
    delivered_sha TEXT,
    pull_request INTEGER,
    status TEXT NOT NULL,
    human_additions INTEGER NOT NULL DEFAULT 0,
    human_deletions INTEGER NOT NULL DEFAULT 0,
    metadata_json TEXT NOT NULL DEFAULT '{}',
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(provider, external_id)
  ) STRICT;
  CREATE TABLE IF NOT EXISTS benchmark_runs (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL,
    dataset TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE IF NOT EXISTS benchmark_jobs (
    id TEXT PRIMARY KEY,
    mode TEXT NOT NULL CHECK(mode IN ('dry','live')),
    status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed','cancelled')),
    dataset TEXT NOT NULL,
    premium_model_id TEXT NOT NULL,
    completed_runs INTEGER NOT NULL DEFAULT 0,
    total_runs INTEGER NOT NULL,
    result_json TEXT NOT NULL DEFAULT '{}',
    lease_owner TEXT,
    lease_expires_at INTEGER,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX IF NOT EXISTS benchmark_jobs_status_created ON benchmark_jobs(status, created_at);
`);

function hydrate<T>(row: JobRow | undefined): DurableJob<T> | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    status: row.status,
    payload: unseal<T>(row.payload_ciphertext),
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    checkpointTask: row.checkpoint_task,
    leaseOwner: row.lease_owner || undefined,
    leaseExpiresAt: row.lease_expires_at || undefined,
    error: row.last_error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function enqueueDurableJob<T>(id: string, workspaceId: string, payload: T) {
  const now = Date.now();
  database.prepare(`
    INSERT INTO jobs(id, workspace_id, status, payload_ciphertext, max_attempts, created_at, updated_at)
    VALUES (?, ?, 'queued', ?, 2, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      payload_ciphertext = excluded.payload_ciphertext,
      status = CASE WHEN jobs.status IN ('completed','cancelled') THEN jobs.status ELSE 'queued' END,
      max_attempts = MIN(jobs.max_attempts, 2),
      updated_at = excluded.updated_at
  `).run(id, workspaceId, seal(payload), now, now);
  return getDurableJob<T>(id);
}

export function getDurableJob<T>(id: string) {
  return hydrate<T>(database.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as JobRow | undefined);
}

export function recoverExpiredJobs(now = Date.now()) {
  return database.prepare(`
    UPDATE jobs SET status = 'queued', lease_owner = NULL, lease_expires_at = NULL,
      last_error = COALESCE(last_error, 'Worker lease expired; resuming from the last checkpoint.'), updated_at = ?
    WHERE status = 'running' AND (lease_expires_at IS NULL OR lease_expires_at < ?)
  `).run(now, now).changes;
}

export function claimDurableJob<T>(workerId: string, leaseMs = 45_000) {
  const now = Date.now();
  database.exec("BEGIN IMMEDIATE");
  try {
    const candidate = database.prepare(`
      SELECT id FROM jobs
      WHERE status = 'queued' AND attempt < max_attempts
      ORDER BY created_at ASC LIMIT 1
    `).get() as { id: string } | undefined;
    if (!candidate) { database.exec("COMMIT"); return undefined; }
    database.prepare(`
      UPDATE jobs SET status = 'running', attempt = attempt + 1, lease_owner = ?,
        lease_expires_at = ?, updated_at = ?, last_error = NULL
      WHERE id = ? AND status = 'queued'
    `).run(workerId, now + leaseMs, now, candidate.id);
    database.exec("COMMIT");
    return getDurableJob<T>(candidate.id);
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function heartbeatDurableJob(id: string, workerId: string, leaseMs = 45_000) {
  const now = Date.now();
  return database.prepare(`
    UPDATE jobs SET lease_expires_at = ?, updated_at = ?
    WHERE id = ? AND status = 'running' AND lease_owner = ?
  `).run(now + leaseMs, now, id, workerId).changes > 0;
}

export function checkpointDurableJob(id: string, taskIndex: number) {
  database.prepare("UPDATE jobs SET checkpoint_task = MAX(checkpoint_task, ?), updated_at = ? WHERE id = ?")
    .run(taskIndex, Date.now(), id);
}

export function finishDurableJob(id: string, status: Extract<DurableJobStatus, "completed" | "needs_attention" | "cancelled">, error?: string) {
  database.prepare(`
    UPDATE jobs SET status = ?, lease_owner = NULL, lease_expires_at = NULL,
      last_error = ?, updated_at = ? WHERE id = ?
  `).run(status, error || null, Date.now(), id);
}

export function retryDurableJob(id: string, error: string) {
  const job = getDurableJob(id);
  const terminal = !job || job.attempt >= job.maxAttempts;
  database.prepare(`
    UPDATE jobs SET status = ?, lease_owner = NULL, lease_expires_at = NULL,
      last_error = ?, updated_at = ? WHERE id = ?
  `).run(terminal ? "needs_attention" : "queued", error.slice(0, 4000), Date.now(), id);
  return !terminal;
}

export function cancelDurableJob(id: string) {
  finishDurableJob(id, "cancelled", "Stopped by the user.");
}

export function rememberWebhook(provider: string, deliveryId: string, payloadSha256: string) {
  try {
    database.prepare(`INSERT INTO webhook_deliveries(provider, delivery_id, received_at, payload_sha256, status)
      VALUES (?, ?, ?, ?, 'received')`).run(provider, deliveryId, Date.now(), payloadSha256);
    return true;
  } catch (error: any) {
    if (String(error?.message).includes("UNIQUE")) return false;
    throw error;
  }
}

export function setWebhookStatus(provider: string, deliveryId: string, status: string) {
  database.prepare("UPDATE webhook_deliveries SET status = ? WHERE provider = ? AND delivery_id = ?")
    .run(status, provider, deliveryId);
}

export function saveIntegrationToken(provider: string, accountId: string, token: unknown, metadata: unknown = {}) {
  database.prepare(`INSERT INTO integration_tokens(provider, account_id, token_ciphertext, metadata_json, updated_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(provider, account_id) DO UPDATE SET
    token_ciphertext = excluded.token_ciphertext, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at`)
    .run(provider, accountId, seal(token), JSON.stringify(metadata), Date.now());
}

export function getIntegrationToken<T>(provider: string, accountId: string) {
  const row = database.prepare("SELECT token_ciphertext, metadata_json FROM integration_tokens WHERE provider = ? AND account_id = ?")
    .get(provider, accountId) as { token_ciphertext: string; metadata_json: string } | undefined;
  return row ? { token: unseal<T>(row.token_ciphertext), metadata: JSON.parse(row.metadata_json) } : undefined;
}

export function saveBenchmarkResult(id: string, mode: string, dataset: string, result: unknown) {
  database.prepare("INSERT OR REPLACE INTO benchmark_runs(id, mode, dataset, result_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, mode, dataset, JSON.stringify(result), Date.now());
}

type BenchmarkJobRow = {
  id: string;
  mode: "dry" | "live";
  status: BenchmarkJobStatus;
  dataset: string;
  premium_model_id: string;
  completed_runs: number;
  total_runs: number;
  result_json: string;
  last_error: string | null;
  created_at: number;
  updated_at: number;
};

function hydrateBenchmarkJob<T>(row: BenchmarkJobRow | undefined): BenchmarkJob<T> | undefined {
  if (!row) return undefined;
  let result = {} as T;
  try { result = JSON.parse(row.result_json || "{}") as T; } catch {}
  return {
    id: row.id,
    mode: row.mode,
    status: row.status,
    dataset: row.dataset,
    premiumModelId: row.premium_model_id,
    completedRuns: row.completed_runs,
    totalRuns: row.total_runs,
    result,
    error: row.last_error || undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createBenchmarkJob(id: string, mode: "dry" | "live", dataset: string, premiumModelId: string, totalRuns: number, initialResult: unknown = {}) {
  const now = Date.now();
  database.prepare(`INSERT INTO benchmark_jobs
    (id, mode, status, dataset, premium_model_id, completed_runs, total_runs, result_json, created_at, updated_at)
    VALUES (?, ?, 'queued', ?, ?, 0, ?, ?, ?, ?)`)
    .run(id, mode, dataset, premiumModelId, totalRuns, JSON.stringify(initialResult), now, now);
  return getBenchmarkJob(id);
}

export function getBenchmarkJob<T = unknown>(id: string) {
  return hydrateBenchmarkJob<T>(database.prepare("SELECT * FROM benchmark_jobs WHERE id = ?").get(id) as BenchmarkJobRow | undefined);
}

export function listBenchmarkJobs<T = unknown>(limit = 20) {
  return (database.prepare("SELECT * FROM benchmark_jobs ORDER BY created_at DESC LIMIT ?").all(Math.max(1, Math.min(100, limit))) as BenchmarkJobRow[])
    .map((row) => hydrateBenchmarkJob<T>(row)!);
}

export function recoverExpiredBenchmarkJobs(now = Date.now()) {
  // A live benchmark spends paid provider capacity. Never resume that spend
  // merely because the Hyzr Chat process restarted; require a fresh explicit launch.
  const paid = database.prepare(`UPDATE benchmark_jobs SET status='cancelled', lease_owner=NULL, lease_expires_at=NULL,
    last_error='Paid evaluation paused after a worker restart. Start a new live comparison to explicitly authorize more model usage.', updated_at=?
    WHERE mode='live' AND status='running' AND (lease_expires_at IS NULL OR lease_expires_at < ?)`)
    .run(now, now).changes;
  const dry = database.prepare(`UPDATE benchmark_jobs SET status='queued', lease_owner=NULL, lease_expires_at=NULL,
    last_error=COALESCE(last_error, 'Routing audit worker restarted; resuming from saved progress.'), updated_at=?
    WHERE mode='dry' AND status='running' AND (lease_expires_at IS NULL OR lease_expires_at < ?)`)
    .run(now, now).changes;
  return Number(paid) + Number(dry);
}

export function claimBenchmarkJob(workerId: string, leaseMs = 60_000) {
  const now = Date.now();
  database.exec("BEGIN IMMEDIATE");
  try {
    const candidate = database.prepare("SELECT id FROM benchmark_jobs WHERE status='queued' ORDER BY created_at ASC LIMIT 1")
      .get() as { id: string } | undefined;
    if (!candidate) { database.exec("COMMIT"); return undefined; }
    database.prepare(`UPDATE benchmark_jobs SET status='running', lease_owner=?, lease_expires_at=?, updated_at=?, last_error=NULL
      WHERE id=? AND status='queued'`).run(workerId, now + leaseMs, now, candidate.id);
    database.exec("COMMIT");
    return getBenchmarkJob(candidate.id);
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

export function heartbeatBenchmarkJob(id: string, workerId: string, leaseMs = 60_000) {
  const now = Date.now();
  return database.prepare(`UPDATE benchmark_jobs SET lease_expires_at=?, updated_at=?
    WHERE id=? AND status='running' AND lease_owner=?`).run(now + leaseMs, now, id, workerId).changes > 0;
}

export function updateBenchmarkProgress(id: string, completedRuns: number, result: unknown) {
  database.prepare(`UPDATE benchmark_jobs SET completed_runs=?, result_json=?, updated_at=? WHERE id=? AND status='running'`)
    .run(completedRuns, JSON.stringify(result), Date.now(), id);
}

export function finishBenchmarkJob(id: string, status: Extract<BenchmarkJobStatus, "completed" | "failed" | "cancelled">, result: unknown, error?: string) {
  database.prepare(`UPDATE benchmark_jobs SET status=?, result_json=?, last_error=?, lease_owner=NULL, lease_expires_at=NULL, updated_at=? WHERE id=?`)
    .run(status, JSON.stringify(result), error?.slice(0, 4000) || null, Date.now(), id);
}

export function cancelBenchmarkJob(id: string) {
  const job = getBenchmarkJob(id);
  if (!job || ["completed", "failed", "cancelled"].includes(job.status)) return job;
  finishBenchmarkJob(id, "cancelled", job.result, "Stopped by the user.");
  return getBenchmarkJob(id);
}

export function durableDatabase() { return database; }
