import { NextRequest, NextResponse } from "next/server";
import { queueLength, queueRange } from "@/lib/relay-store";
import { ownsAgentJob } from "@/lib/paired-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// 400 ms is still well below the threshold where token streaming looks chunky,
// and the launcher now batches its deltas on a 200 ms timer anyway, so a finer
// tick here would find nothing new.
const IDLE_TICK_MS = 400;

// How long to hold an idle poll open before answering "nothing yet". Every
// return trip is a fresh browser request and a fresh function invocation, so a
// longer hold means proportionally fewer of both. The wait itself is idle, and
// idle time is not billed as active CPU.
const HOLD_OPEN_MS = 5_000;

// The hosted UI polls a job's result stream, passing a cursor so it only
// receives new events each time. A short server-side wait prevents visible
// 600 ms bursts without turning every model token into a separate request.
//
// While waiting we ask only for the queue's length (LLEN) rather than pulling
// the whole list back and parsing it; a long response used to be re-fetched in
// full on every tick, so the cost grew with the square of the event count.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("job");
  const cursor = Number(url.searchParams.get("cursor") || 0);
  if (!jobId) return NextResponse.json({ error: "Missing job." }, { status: 400 });
  if (!await ownsAgentJob(request, jobId)) return NextResponse.json({ error: "Run not found." }, { status: 404 });

  const key = `results:${jobId}`;
  const deadline = Date.now() + HOLD_OPEN_MS;
  let total = await queueLength(key);
  while (total <= cursor && Date.now() < deadline) {
    await wait(IDLE_TICK_MS);
    total = await queueLength(key);
  }

  // Fetch only the slice the client has not seen yet.
  const events = total > cursor
    ? await queueRange<{ type: string; text?: string; at: number }>(key, cursor)
    : [];
  return NextResponse.json(
    { events, cursor: total },
    { headers: { "Cache-Control": "no-store", "X-Accel-Buffering": "no" } },
  );
}
