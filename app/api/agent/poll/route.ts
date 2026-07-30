import { NextRequest, NextResponse } from "next/server";
import { kvGet, kvSet, queuePop } from "@/lib/relay-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The local agent long-polls for the next job. Serverless-friendly: a short
// bounded wait, then return null so the agent immediately re-polls.
export async function GET(request: NextRequest) {
  const token = new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });

  const record = await kvGet<{ token: string; agent: unknown }>(`agent:${token}`);
  if (!record) return NextResponse.json({ error: "Unknown agent token." }, { status: 401 });
  await kvSet(`agent:${token}`, { ...record, lastSeen: Date.now() }, 60 * 60 * 24 * 30);

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const job = await queuePop(`jobs:${token}`);
    if (job) return NextResponse.json({ job }, { headers: { "Cache-Control": "no-store" } });
    await new Promise((r) => setTimeout(r, 700));
  }
  return NextResponse.json({ job: null }, { headers: { "Cache-Control": "no-store" } });
}
