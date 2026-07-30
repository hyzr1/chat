import { NextRequest, NextResponse } from "next/server";
import { kvGet, kvSet } from "@/lib/relay-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const { token } = await request.json().catch(() => ({} as { token?: string }));
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });
  const key = `agent:${token}`;
  const record = await kvGet<Record<string, unknown>>(key);
  if (!record) return NextResponse.json({ error: "Unknown agent token." }, { status: 401 });
  await kvSet(key, { ...record, lastSeen: 0 }, 60 * 60 * 24 * 30);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
