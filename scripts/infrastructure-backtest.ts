import { createHmac } from "crypto";
import {
  checkpointDurableJob, claimDurableJob, createBenchmarkJob, durableDatabase, enqueueDurableJob, finishDurableJob,
  getBenchmarkJob, getDurableJob, recoverExpiredBenchmarkJobs, recoverExpiredJobs, rememberWebhook,
} from "../lib/durable-jobs";
import { verifyGithubWebhook } from "../lib/github-app";
import { verifyLinearWebhook } from "../lib/linear-integration";
import { seal, unseal } from "../lib/secure-store";
import { activeProjectId, listProjects, removeProject, saveProject, setActiveProject } from "../lib/project-store";
import { NextRequest } from "next/server";
import { proxy } from "../proxy";

let failures = 0;
function check(condition: unknown, label: string) {
  console.log(`${condition ? "PASS" : "FAIL"} | ${label}`);
  if (!condition) failures++;
}

const id = `infra-test-${Date.now()}`;
const secretValue = `secret-${Math.random().toString(36).slice(2)}`;
enqueueDurableJob(id, id, { task: "durable", credential: secretValue });
const rawRow = durableDatabase().prepare("SELECT payload_ciphertext FROM jobs WHERE id=?").get(id) as { payload_ciphertext: string };
check(!rawRow.payload_ciphertext.includes(secretValue), "job payload is encrypted at rest");
const first = claimDurableJob<{ task: string; credential: string }>("worker-a", 5000);
check(first?.id === id && first.payload.credential === secretValue, "worker atomically claims and decrypts a queued job");
checkpointDurableJob(id, 2);
durableDatabase().prepare("UPDATE jobs SET lease_expires_at=? WHERE id=?").run(Date.now() - 10, id);
check(recoverExpiredJobs() === 1, "expired running lease is recovered to the queue");
const resumed = claimDurableJob("worker-b", 5000);
check(resumed?.attempt === 2 && resumed.checkpointTask === 2, "reclaimed job preserves attempt and checkpoint state");
finishDurableJob(id, "completed");
check(getDurableJob(id)?.status === "completed", "completed job reaches a durable terminal state");

const paidBenchmark = `paid-recovery-${Date.now()}`;
const dryBenchmark = `dry-recovery-${Date.now()}`;
createBenchmarkJob(paidBenchmark, "live", "test", "gpt-5.6-sol", 2);
createBenchmarkJob(dryBenchmark, "dry", "test", "gpt-5.6-sol", 2);
durableDatabase().prepare("UPDATE benchmark_jobs SET status='running', lease_expires_at=? WHERE id IN (?, ?)").run(Date.now() - 10, paidBenchmark, dryBenchmark);
recoverExpiredBenchmarkJobs();
check(getBenchmarkJob(paidBenchmark)?.status === "cancelled", "expired paid evaluation never silently resumes spending after restart");
check(getBenchmarkJob(dryBenchmark)?.status === "queued", "free routing audit safely resumes after restart");

const projectId = `project-${Date.now()}`;
saveProject({ id: projectId, name: "Cross-device pilot", instructions: "Use the shared delivery contract." });
setActiveProject(projectId);
check(listProjects().some((project) => project.id === projectId) && activeProjectId() === projectId, "projects and active selection persist in shared server state");
removeProject(projectId);
check(!listProjects().some((project) => project.id === projectId) && activeProjectId() !== projectId, "project removal clears shared active state");

process.env.HYZR_CHAT_ACCESS_TOKEN = "pilot-access-test";
const remoteDenied = proxy(new NextRequest("http://192.168.1.10:3000/api/runs", { headers: { host: "192.168.1.10:3000" } }));
const remoteAllowed = proxy(new NextRequest("http://192.168.1.10:3000/api/runs", { headers: { host: "192.168.1.10:3000", authorization: "Bearer pilot-access-test" } }));
const localAllowed = proxy(new NextRequest("http://localhost:3000/api/runs", { headers: { host: "localhost:3000" } }));
check(remoteDenied?.status === 401, "unpaired LAN API requests are rejected when pilot access control is enabled");
check(remoteAllowed?.status === 200 && localAllowed?.status === 200, "paired LAN and host-local requests remain available");
delete process.env.HYZR_CHAT_ACCESS_TOKEN;

const encrypted = seal({ value: secretValue });
check(unseal<{ value: string }>(encrypted).value === secretValue, "authenticated encryption round trip");
let tamperRejected = false;
try { unseal(`${encrypted.slice(0, -2)}AA`); } catch { tamperRejected = true; }
check(tamperRejected, "tampered encrypted data is rejected");

const delivery = `delivery-${Date.now()}`;
check(rememberWebhook("test", delivery, "abc"), "first webhook delivery is accepted");
check(!rememberWebhook("test", delivery, "abc"), "replayed webhook delivery is rejected");

const body = JSON.stringify({ type: "Issue", webhookTimestamp: new Date().toISOString() });
process.env.GITHUB_WEBHOOK_SECRET = "github-test-secret";
const githubSignature = `sha256=${createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET).update(body).digest("hex")}`;
check(verifyGithubWebhook(body, githubSignature), "valid GitHub webhook HMAC is accepted");
check(!verifyGithubWebhook(`${body}x`, githubSignature), "modified GitHub webhook payload is rejected");
process.env.LINEAR_WEBHOOK_SECRET = "linear-test-secret";
const linearSignature = createHmac("sha256", process.env.LINEAR_WEBHOOK_SECRET).update(body).digest("hex");
check(verifyLinearWebhook(body, linearSignature), "valid Linear webhook HMAC is accepted");
check(!verifyLinearWebhook(`${body}x`, linearSignature), "modified Linear webhook payload is rejected");

durableDatabase().prepare("DELETE FROM jobs WHERE id=?").run(id);
durableDatabase().prepare("DELETE FROM webhook_deliveries WHERE provider='test' AND delivery_id=?").run(delivery);
durableDatabase().prepare("DELETE FROM benchmark_jobs WHERE id IN (?, ?)").run(paidBenchmark, dryBenchmark);
if (failures) process.exit(1);
