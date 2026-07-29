import { createHash, createHmac, createSign, timingSafeEqual } from "crypto";
import { execFile } from "child_process";
import { existsSync, mkdirSync, readdirSync } from "fs";
import path from "path";
import { promisify } from "util";
import { workspaceFor } from "./local-runner";
import { durableDatabase } from "./durable-jobs";
import { recordRunOutcome } from "./run-registry";
import { STATE_DIRECTORY } from "./product-paths";

const execFileAsync = promisify(execFile);
const apiBase = "https://api.github.com";
const cache = globalThis as typeof globalThis & { __hyzrChatGithubTokens?: Map<string, { token: string; expiresAt: number }> };
const tokenCache = cache.__hyzrChatGithubTokens ?? (cache.__hyzrChatGithubTokens = new Map());

export interface GitHubDeliverySource {
  installationId: number;
  owner: string;
  repo: string;
  issueNumber: number;
  issueTitle: string;
  baseBranch?: string;
  targetSha?: string;
  postMerge?: boolean;
}

function base64url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function privateKey() {
  const value = process.env.GITHUB_APP_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!value) throw new Error("GITHUB_APP_PRIVATE_KEY is not configured.");
  return value;
}

export function githubAppConfigured() {
  return Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY && process.env.GITHUB_WEBHOOK_SECRET);
}

export function githubAppJwt() {
  const appId = process.env.GITHUB_APP_ID;
  if (!appId) throw new Error("GITHUB_APP_ID is not configured.");
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: appId }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey()).toString("base64url")}`;
}

async function api<T>(pathname: string, init: RequestInit & { token?: string } = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${init.token || githubAppJwt()}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "hyzr-chat-agent",
      ...(init.headers || {}),
    },
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${body.slice(0, 1000)}`);
  return body ? JSON.parse(body) as T : {} as T;
}

export async function installationToken(installationId: number) {
  const key = String(installationId);
  const existing = tokenCache.get(key);
  if (existing && existing.expiresAt > Date.now() + 60_000) return existing.token;
  const result = await api<{ token: string; expires_at: string }>(`/app/installations/${installationId}/access_tokens`, { method: "POST" });
  tokenCache.set(key, { token: result.token, expiresAt: Date.parse(result.expires_at) });
  return result.token;
}

export function verifyGithubWebhook(rawBody: string, signature: string | null) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const suppliedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

export function webhookPayloadHash(rawBody: string) {
  return createHash("sha256").update(rawBody).digest("hex");
}

function gitEnvironment(token: string) {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
  };
}

function safeSegment(value: string) { return value.replace(/[^a-zA-Z0-9_.-]/g, "-").slice(0, 100); }

export function githubBranch(source: GitHubDeliverySource, runId: string) {
  return `hyzr-chat/${source.postMerge ? "regression" : "issue"}-${source.issueNumber}-${safeSegment(source.issueTitle.toLowerCase()).slice(0, 42) || safeSegment(runId)}`;
}

export async function prepareGithubWorktree(source: GitHubDeliverySource, workspaceId: string, runId: string) {
  const token = await installationToken(source.installationId);
  const mirrors = path.join(STATE_DIRECTORY, "repositories");
  mkdirSync(mirrors, { recursive: true });
  const mirror = path.join(mirrors, `${safeSegment(source.owner)}--${safeSegment(source.repo)}.git`);
  const remote = `https://github.com/${source.owner}/${source.repo}.git`;
  const environment = gitEnvironment(token);
  if (!existsSync(mirror)) {
    await execFileAsync("git", ["clone", "--mirror", remote, mirror], { env: environment, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  } else {
    await execFileAsync("git", ["--git-dir", mirror, "fetch", "--prune", "origin"], { env: environment, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  }
  const workspace = workspaceFor(workspaceId);
  mkdirSync(path.dirname(workspace), { recursive: true });
  if (existsSync(workspace) && readdirSync(workspace).length) {
    const gitFile = path.join(workspace, ".git");
    if (!existsSync(gitFile)) throw new Error("The issue workspace already contains non-GitHub files; refusing to overwrite it.");
    return { workspace, branch: githubBranch(source, runId), resumed: true };
  }
  const branch = githubBranch(source, runId);
  const base = source.targetSha || (source.baseBranch ? `origin/${source.baseBranch}` : "origin/HEAD");
  await execFileAsync("git", ["--git-dir", mirror, "worktree", "add", "-B", branch, workspace, base], { env: environment, windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  return { workspace, branch, resumed: false };
}

async function git(workspace: string, args: string[], token?: string) {
  return execFileAsync("git", ["-C", workspace, ...args], { env: token ? gitEnvironment(token) : process.env, windowsHide: true, maxBuffer: 20 * 1024 * 1024 });
}

export async function publishGithubDelivery(source: GitHubDeliverySource, workspaceId: string, runId: string, verificationPassed: boolean) {
  const token = await installationToken(source.installationId);
  const workspace = workspaceFor(workspaceId);
  const branch = githubBranch(source, runId);
  await git(workspace, ["add", "-A"]);
  const status = await git(workspace, ["status", "--porcelain"]);
  if (status.stdout.trim()) {
    await git(workspace, ["-c", "user.name=hyzr-chat[bot]", "-c", "user.email=hyzr-chat[bot]@users.noreply.github.com", "commit", "-m", `Resolve #${source.issueNumber}: ${source.issueTitle}`]);
  }
  await git(workspace, ["push", "--force-with-lease", "origin", `${branch}:${branch}`], token);
  const headSha = (await git(workspace, ["rev-parse", "HEAD"])).stdout.trim();
  const existing = await api<Array<{ number: number; html_url: string }>>(`/repos/${source.owner}/${source.repo}/pulls?head=${encodeURIComponent(`${source.owner}:${branch}`)}&state=open`, { token });
  const pull = existing[0] || await api<{ number: number; html_url: string }>(`/repos/${source.owner}/${source.repo}/pulls`, {
    method: "POST", token,
    body: JSON.stringify({ title: `Resolve #${source.issueNumber}: ${source.issueTitle}`, head: branch, base: source.baseBranch || "main", body: `Closes #${source.issueNumber}\n\nImplemented by Hyzr Chat run \`${runId}\`. Delivery evidence is attached through the Hyzr Chat check run.` }),
  });
  const check = await api<{ id: number; html_url: string }>(`/repos/${source.owner}/${source.repo}/check-runs`, {
    method: "POST", token,
    body: JSON.stringify({
      name: "Hyzr Chat delivery contract",
      head_sha: headSha,
      status: "completed",
      conclusion: verificationPassed ? "success" : "failure",
      output: { title: verificationPassed ? "Delivery verified" : "Delivery needs attention", summary: verificationPassed ? "The implementation passed Hyzr Chat's independent verification pipeline." : "At least one independent verification check failed. Review the Hyzr Chat evidence before merging." },
    }),
  });
  durableDatabase().prepare(`INSERT INTO deliveries(provider, external_id, run_id, repository, branch, delivered_sha, pull_request, status, metadata_json, updated_at)
    VALUES ('github', ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(provider, external_id) DO UPDATE SET
    delivered_sha=excluded.delivered_sha, pull_request=excluded.pull_request, status=excluded.status, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`)
    .run(`${source.owner}/${source.repo}#${source.issueNumber}`, runId, `${source.owner}/${source.repo}`, branch, headSha, pull.number, verificationPassed ? "verified" : "failed", JSON.stringify({ pullUrl: pull.html_url, checkUrl: check.html_url }), Date.now());
  return { pull, check, headSha, branch };
}

export async function publishGithubRegressionCheck(source: GitHubDeliverySource, verificationPassed: boolean, summary: string) {
  const token = await installationToken(source.installationId);
  if (!source.targetSha) throw new Error("A target commit SHA is required for post-merge verification.");
  return api<{ id: number; html_url: string }>(`/repos/${source.owner}/${source.repo}/check-runs`, {
    method: "POST", token,
    body: JSON.stringify({
      name: "Hyzr Chat post-merge regression",
      head_sha: source.targetSha,
      status: "completed",
      conclusion: verificationPassed ? "success" : "failure",
      output: { title: verificationPassed ? "No regression detected" : "Post-merge regression detected", summary: summary.slice(0, 60_000) },
    }),
  });
}

export async function recordHumanEdits(owner: string, repo: string, pullNumber: number, installationId: number, merged = false) {
  const token = await installationToken(installationId);
  const pull = await api<{ head: { sha: string } }>(`/repos/${owner}/${repo}/pulls/${pullNumber}`, { token });
  const delivery = durableDatabase().prepare("SELECT external_id, delivered_sha, run_id FROM deliveries WHERE provider='github' AND repository=? AND pull_request=?")
    .get(`${owner}/${repo}`, pullNumber) as { external_id: string; delivered_sha: string; run_id: string } | undefined;
  if (!delivery?.delivered_sha) return { additions: 0, deletions: 0 };
  if (delivery.delivered_sha === pull.head.sha) {
    if (merged) recordRunOutcome(delivery.run_id, { verdict: "accepted", humanEdits: 0, note: `Merged PR #${pullNumber} without human code edits after the Hyzr Chat delivery SHA.` });
    return { additions: 0, deletions: 0 };
  }
  const comparison = await api<{ files?: Array<{ additions: number; deletions: number }> }>(`/repos/${owner}/${repo}/compare/${delivery.delivered_sha}...${pull.head.sha}`, { token });
  const additions = comparison.files?.reduce((total, file) => total + file.additions, 0) || 0;
  const deletions = comparison.files?.reduce((total, file) => total + file.deletions, 0) || 0;
  durableDatabase().prepare("UPDATE deliveries SET human_additions=?, human_deletions=?, updated_at=? WHERE provider='github' AND external_id=?")
    .run(additions, deletions, Date.now(), delivery.external_id);
  if (merged) recordRunOutcome(delivery.run_id, { verdict: "accepted", humanEdits: additions + deletions, note: `Merged PR #${pullNumber}; measured from the Hyzr Chat delivery SHA to the final head SHA.` });
  return { additions, deletions };
}

export async function commentOnGithubIssue(source: GitHubDeliverySource, body: string) {
  const token = await installationToken(source.installationId);
  return api(`/repos/${source.owner}/${source.repo}/issues/${source.issueNumber}/comments`, { method: "POST", token, body: JSON.stringify({ body }) });
}
