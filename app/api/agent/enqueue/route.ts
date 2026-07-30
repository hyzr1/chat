import { NextRequest, NextResponse } from "next/server";
import { kvGet, queuePush } from "@/lib/relay-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The hosted UI hands a task to the paired agent (referenced by its code).
export async function POST(request: NextRequest) {
  const { code, job } = await request.json().catch(() => ({} as any));
  if (!code || !job?.id || !job?.prompt) return NextResponse.json({ error: "Missing code or job." }, { status: 400 });
  const token = await kvGet<string>(`token:${String(code).toUpperCase()}`);
  if (!token) return NextResponse.json({ error: "No agent is paired." }, { status: 404 });
  await queuePush(`jobs:${token}`, { id: job.id, prompt: String(job.prompt).slice(0, 24000), model: job.model ?? null, enqueuedAt: Date.now() }, 3600);
  return NextResponse.json({ ok: true, jobId: job.id }, { headers: { "Cache-Control": "no-store" } });
}
