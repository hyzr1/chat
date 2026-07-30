import { NextRequest, NextResponse } from "next/server";
import { kvGet, queuePush } from "@/lib/relay-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The agent streams a job's output back in chunks, ending with a done/error
// event. The hosted UI reads these via /api/agent/events.
export async function POST(request: NextRequest) {
  const { token, jobId, type, text } = await request.json().catch(() => ({} as any));
  if (!token || !jobId || !type) return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  const record = await kvGet(`agent:${token}`);
  if (!record) return NextResponse.json({ error: "Unknown agent token." }, { status: 401 });
  await queuePush(`results:${jobId}`, { type, text: typeof text === "string" ? text.slice(0, 24000) : undefined, at: Date.now() }, 3600);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
