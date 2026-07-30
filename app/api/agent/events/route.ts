import { NextRequest, NextResponse } from "next/server";
import { queueRange } from "@/lib/relay-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The hosted UI polls a job's result stream, passing a cursor so it only
// receives new events each time.
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const jobId = url.searchParams.get("job");
  const cursor = Number(url.searchParams.get("cursor") || 0);
  if (!jobId) return NextResponse.json({ error: "Missing job." }, { status: 400 });
  const all = await queueRange<{ type: string; text?: string; at: number }>(`results:${jobId}`);
  return NextResponse.json({ events: all.slice(cursor), cursor: all.length }, { headers: { "Cache-Control": "no-store" } });
}
