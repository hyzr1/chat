import { NextRequest, NextResponse } from "next/server";
import { beginRun, cancelRun, getRun, listRuns, recordRunOutcome, runAnalytics, type RunEvent } from "@/lib/run-registry";
import { cancelDurableJob } from "@/lib/durable-jobs";
import { ensureDurableWorker } from "@/lib/durable-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  ensureDurableWorker();
  const sessionId = req.nextUrl.searchParams.get("run") ?? req.nextUrl.searchParams.get("session") ?? "";
  if (!sessionId || req.nextUrl.searchParams.get("list") === "1") {
    return NextResponse.json({ runs: listRuns(100), analytics: runAnalytics() }, { headers: { "Cache-Control": "no-store" } });
  }
  const after = Number(req.nextUrl.searchParams.get("after") ?? 0);
  const run = getRun(sessionId);
  const firstAvailableSeq = run?.events[0]?.seq ?? 1;
  return NextResponse.json(run ? {
    found: true,
    events: run.events.filter((event: RunEvent) => event.seq > after),
    resetAfter: after < firstAvailableSeq - 1 ? firstAvailableSeq - 1 : undefined,
    active: run.active,
    done: run.done,
    updatedAt: run.updatedAt,
    latestSeq: run.nextSeq - 1,
  } : { found: false, events: [], active: false, done: false, updatedAt: 0, latestSeq: after }, { headers: { "Cache-Control": "no-store" } });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json();
  const runId = String(body.runId || "");
  const verdict = String(body.verdict || "");
  if (!runId) return NextResponse.json({ error: "A run ID is required" }, { status: 400 });
  if (!["accepted", "needs_work", "regressed"].includes(verdict)) return NextResponse.json({ error: "Invalid outcome verdict" }, { status: 400 });
  const run = recordRunOutcome(runId, {
    verdict: verdict as "accepted" | "needs_work" | "regressed",
    humanEdits: Math.max(0, Number(body.humanEdits) || 0),
    note: typeof body.note === "string" ? body.note.slice(0, 2000) : undefined,
  });
  return run ? NextResponse.json({ run, analytics: runAnalytics() }) : NextResponse.json({ error: "Run not found" }, { status: 404 });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const runId = String(body.runId ?? "");
  const workspaceId = String(body.sessionId ?? runId);
  if (!runId) return NextResponse.json({ error: "A run ID is required" }, { status: 400 });
  const run = beginRun(runId, workspaceId);
  return NextResponse.json({ found: true, active: run.active, done: run.done, updatedAt: run.updatedAt });
}

export async function DELETE(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get("run") ?? req.nextUrl.searchParams.get("session") ?? "";
  if (req.nextUrl.searchParams.get("intent") !== "user") {
    return NextResponse.json({ cancelled: false, ignored: true, reason: "Explicit user intent is required" });
  }
  cancelDurableJob(sessionId);
  return NextResponse.json({ cancelled: cancelRun(sessionId) });
}
