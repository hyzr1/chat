import { createHash, randomUUID } from "crypto";
import type { NextRequest } from "next/server";
import type { AgentCapabilities, AgentJob, AgentResultEvent, AgentRpcMethod } from "./agent-protocol";
import { kvGet, kvSet, queuePush, queueRange } from "./relay-store";
import { authUser } from "./auth";
import { AGENT_ONLINE_WINDOW_MS, isHostedRuntime } from "./agent-protocol";

export const AGENT_COOKIE = "hyzr_agent_pair";

export function tokenFingerprint(token: string) {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}

export function pairingCode(request: NextRequest) {
  return request.cookies.get(AGENT_COOKIE)?.value?.toUpperCase() || "";
}

export async function pairedAgent(request: NextRequest) {
  const code = pairingCode(request);
  const user = await authUser(request);
  if (isHostedRuntime() && !user) return null;
  const codeToken = code ? await kvGet<string>(`token:${code}`) : null;
  const token = codeToken || (user ? await kvGet<string>(`account-agent:${user.id}`) : null);
  if (!token) return null;
  const record = await kvGet<{ lastSeen: number; revokedAt?: number; agent: AgentCapabilities }>(`agent:${token}`);
  if (!record) return null;
  return {
    code,
    token,
    online: !record.revokedAt && Date.now() - Number(record.lastSeen || 0) < AGENT_ONLINE_WINDOW_MS,
    agent: record.agent,
    fingerprint: tokenFingerprint(token),
  };
}

export async function enqueueAgentJob(token: string, job: AgentJob) {
  await queuePush(`jobs:${token}`, job, 24 * 60 * 60);
  await kvSet(`job-owner:${job.id}`, tokenFingerprint(token), 24 * 60 * 60);
}

export async function ownsAgentJob(request: NextRequest, jobId: string) {
  const paired = await pairedAgent(request);
  if (!paired) return false;
  return await kvGet<string>(`job-owner:${jobId}`) === paired.fingerprint;
}

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function callPairedAgent(
  request: NextRequest,
  method: AgentRpcMethod,
  params: Record<string, unknown>,
  timeoutMs = 20_000,
) {
  const paired = await pairedAgent(request);
  if (!paired) throw Object.assign(new Error("Pair your computer before using local tools."), { status: 401, reason: "unpaired" });
  if (!paired.online) throw Object.assign(new Error("Your paired computer is offline."), { status: 410, reason: "offline" });

  const id = `rpc-${randomUUID()}`;
  await enqueueAgentJob(paired.token, { kind: "rpc", id, method, params, enqueuedAt: Date.now() });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await queueRange<AgentResultEvent>(`results:${id}`);
    const failure = events.find((event) => event.type === "error");
    if (failure) throw Object.assign(new Error(failure.text || "The local agent operation failed."), { status: 502 });
    const result = events.find((event) => event.type === "result");
    if (result) return result.data;
    await wait(180);
  }
  throw Object.assign(new Error("The local agent did not answer in time."), { status: 504, reason: "timeout" });
}
