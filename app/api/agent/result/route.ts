import { NextRequest, NextResponse } from "next/server";
import { kvGet, queuePush } from "@/lib/relay-store";
import { tokenFingerprint } from "@/lib/paired-agent";
import { getAgentRecord, touchAgent } from "@/lib/agent-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The agent streams a job's output back in chunks, ending with a done/error
// event. The hosted UI reads these via /api/agent/events.
export async function POST(request: NextRequest) {
  const { token, jobId, type, text, data } = await request.json().catch(() => ({} as any));
  if (!token || !jobId || !type) return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  const record = await getAgentRecord(token);
  if (!record || record.revokedAt) return NextResponse.json({ error: "Expired agent session." }, { status: 401 });
  // Result delivery is also proof that the launcher is alive. This keeps
  // launchers from older releases online during long model/tool operations.
  await touchAgent(token, record);
  const owner = await kvGet<string>(`job-owner:${jobId}`);
  if (owner !== tokenFingerprint(token)) return NextResponse.json({ error: "Unknown job." }, { status: 404 });
  const allowed = new Set(["status", "text", "tool", "usage", "result", "done", "error"]);
  if (!allowed.has(String(type))) return NextResponse.json({ error: "Unknown result type." }, { status: 400 });
  await queuePush(`results:${jobId}`, {
    type,
    text: typeof text === "string" ? text.slice(0, 48_000) : undefined,
    data: data === undefined ? undefined : data,
    at: Date.now(),
  }, 24 * 60 * 60);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
