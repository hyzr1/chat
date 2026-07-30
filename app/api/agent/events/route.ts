import { NextRequest, NextResponse } from "next/server";
import { queueRange } from "@/lib/relay-store";
import { ownsAgentJob } from "@/lib/paired-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

// The hosted UI polls a job's result stream, passing a cursor so it only
// receives new events each time. A short server-side wait prevents visible
// 600 ms bursts without turning every model token into a separate request.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("job");
  const cursor = Number(url.searchParams.get("cursor") || 0);
  if (!jobId) return NextResponse.json({ error: "Missing job." }, { status: 400 });
  if (!await ownsAgentJob(request, jobId)) return NextResponse.json({ error: "Run not found." }, { status: 404 });
  const deadline = Date.now() + 1400;
  let all = await queueRange<{ type: string; text?: string; at: number }>(`results:${jobId}`);
  while (all.length <= cursor && Date.now() < deadline) {
    await wait(100);
    all = await queueRange<{ type: string; text?: string; at: number }>(`results:${jobId}`);
  }
  return NextResponse.json(
    { events: all.slice(cursor), cursor: all.length },
    { headers: { "Cache-Control": "no-store", "X-Accel-Buffering": "no" } },
  );
}
