import { NextRequest, NextResponse } from "next/server";
import { kvSet, newCode } from "@/lib/relay-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The hosted UI asks for a fresh pairing code, then polls /api/agent/status
// until a local agent claims it.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const code = newCode();
  await kvSet(`pair:${code}`, { status: "pending", createdAt: Date.now(), account: body.account ?? null }, 900);
  return NextResponse.json({ code, expiresIn: 900 }, { headers: { "Cache-Control": "no-store" } });
}
