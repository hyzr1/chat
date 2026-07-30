import { NextRequest, NextResponse } from "next/server";
import { kvGet, kvSet, newToken } from "@/lib/relay-store";
import { AGENT_PROTOCOL_VERSION } from "@/lib/agent-protocol";
import { takeRateLimit } from "@/lib/rate-limit";
import { registerAgent } from "@/lib/agent-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Pairing { status: string; createdAt: number; accountId?: string; token?: string; agent?: unknown }

// A local agent claims a pairing code shown in the hosted UI. It sends the
// environment it detected (Claude/Codex/Git/Node) and receives an agent token
// it uses for all later poll/result calls.
export async function POST(request: NextRequest) {
  const { code, agent } = await request.json().catch(() => ({} as any));
  const normalizedCode = String(code || "").trim().toUpperCase();
  const key = `pair:${normalizedCode}`;
  if (!code) return NextResponse.json({ error: "Missing pairing code." }, { status: 400 });
  if (!/^[A-HJ-NP-Z2-9]{6}$/.test(normalizedCode)) {
    return NextResponse.json({ error: "That pairing code is invalid." }, { status: 400 });
  }
  const rate = await takeRateLimit(request, "agent-pair-claim", 20, 10 * 60);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many pairing attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
    );
  }

  const pairing = await kvGet<Pairing>(key);
  if (!pairing) return NextResponse.json({ error: "That code has expired. Generate a new one." }, { status: 404 });
  if (pairing.status === "paired") return NextResponse.json({ error: "That code has already been used." }, { status: 409 });

  const token = newToken();
  const record = await registerAgent(token, pairing.accountId, agent);
  // The code is a short-lived bootstrap secret. Normal browser requests resolve
  // the paired machine through the authenticated account after this point.
  await kvSet(`token:${normalizedCode}`, token, 900);
  await kvSet(key, { ...pairing, status: "paired", agent: record.agent }, 900);

  return NextResponse.json({ token, protocol: AGENT_PROTOCOL_VERSION }, { headers: { "Cache-Control": "no-store" } });
}
