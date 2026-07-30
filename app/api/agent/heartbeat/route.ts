import { NextRequest, NextResponse } from "next/server";
import { getAgentRecord, touchAgent } from "@/lib/agent-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const body = bearer ? null : await request.json().catch(() => ({} as { token?: string }));
  const token = bearer || body?.token || "";
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });

  const record = await getAgentRecord(token);
  if (!record || record.revokedAt) return NextResponse.json({ error: "Expired agent session." }, { status: 401 });
  await touchAgent(token, record);
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
