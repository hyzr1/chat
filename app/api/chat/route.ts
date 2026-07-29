import { NextRequest } from "next/server";
import { enqueueDurableJob } from "@/lib/durable-jobs";
import { wakeDurableWorker } from "@/lib/durable-worker";
import type { ChatJobPayload } from "@/lib/execution-engine";
import { beginRun, getRun } from "@/lib/run-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function POST(request: NextRequest) {
  const body = await request.json() as ChatJobPayload;
  const runId = body.runId || `run-${Date.now()}`;
  const workspaceId = body.sessionId || runId;
  beginRun(runId, workspaceId);
  enqueueDurableJob(runId, workspaceId, { ...body, runId, sessionId: workspaceId });
  wakeDurableWorker();

  const encoder = new TextEncoder();
  let disconnected = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try { controller.enqueue(encoder.encode(`: ${" ".repeat(2048)}\n\n`)); } catch { disconnected = true; }
      let cursor = 0;
      let idleAfterDone = 0;
      while (!disconnected) {
        const run = getRun(runId);
        const events = run?.events.filter((event) => event.seq > cursor) ?? [];
        for (const event of events) {
          cursor = Math.max(cursor, event.seq);
          try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`)); }
          catch { disconnected = true; break; }
        }
        if (run?.done) {
          if (!events.length) idleAfterDone++;
          if (idleAfterDone >= 2) break;
        }
        await delay(events.length ? 25 : 150);
      }
      try { controller.close(); } catch {}
    },
    cancel() { disconnected = true; },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "X-Hyzr-Chat-Run-Id": runId,
    },
  });
}
