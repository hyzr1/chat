import { NextRequest, NextResponse } from "next/server";
import { kvGet } from "@/lib/relay-store";
import { AGENT_ONLINE_WINDOW_MS, cleanWorkspaceId, type AgentRunJob } from "@/lib/agent-protocol";
import { enqueueAgentJob, pairedAgent } from "@/lib/paired-agent";
import { authUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The hosted UI hands a task to the paired agent (referenced by its code).
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as any));
  const { job } = body;
  if (!job?.id || !job?.prompt) return NextResponse.json({ error: "Missing job." }, { status: 400 });
  const user = await authUser(request);
  if (!user) return NextResponse.json({ error: "Sign in before sending work to a paired computer." }, { status: 401 });
  const accountPair = await pairedAgent(request);
  const token = accountPair?.token;
  if (!token) return NextResponse.json({ error: "No agent is paired.", reason: "unpaired" }, { status: 404 });
  const record = await kvGet<{ lastSeen: number; agent?: { protocol?: number } }>(`agent:${token}`);
  // If the agent hasn't polled recently it's offline — tell the UI to reconnect.
  if (record && Date.now() - Number(record.lastSeen || 0) > AGENT_ONLINE_WINDOW_MS) {
    return NextResponse.json({ error: "Hyzr is offline. Reopen hyzr.cmd on your computer, then try again.", reason: "offline" }, { status: 410 });
  }
  if (Number(record?.agent?.protocol || 1) < 2) {
    return NextResponse.json({
      error: "This computer is using an old Hyzr bridge. Download the current tiny terminal launcher and pair again.",
      reason: "upgrade_required",
    }, { status: 426 });
  }
  const workspaceId = cleanWorkspaceId(job.workspaceId || job.conversationId);
  if (!workspaceId) return NextResponse.json({ error: "A stable conversation workspace is required." }, { status: 400 });
  const payload: AgentRunJob = {
    kind: "run",
    id: String(job.id).slice(0, 120),
    runId: String(job.runId || job.id).slice(0, 120),
    conversationId: cleanWorkspaceId(job.conversationId || workspaceId),
    workspaceId,
    projectId: cleanWorkspaceId(job.projectId) || undefined,
    prompt: String(job.prompt).slice(0, 48_000),
    history: Array.isArray(job.history) ? job.history.slice(-24).map((message: any) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: String(message?.content || "").slice(0, 12_000),
    })) : undefined,
    model: typeof job.model === "string" ? job.model.slice(0, 80) : null,
    effort: typeof job.effort === "string" ? job.effort.slice(0, 20) : undefined,
    plan: job.plan !== false,
    enqueuedAt: Date.now(),
  };
  await enqueueAgentJob(token, payload);
  return NextResponse.json({ ok: true, jobId: job.id }, { headers: { "Cache-Control": "no-store" } });
}
