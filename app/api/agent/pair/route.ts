import { NextRequest, NextResponse } from "next/server";
import { kvGet, kvSet, newToken } from "@/lib/relay-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Pairing { status: string; createdAt: number; account: unknown; token?: string; agent?: unknown }

// A local agent claims a pairing code shown in the hosted UI. It sends the
// environment it detected (Claude/Codex/Git/Node) and receives an agent token
// it uses for all later poll/result calls.
export async function POST(request: NextRequest) {
  const { code, agent } = await request.json().catch(() => ({} as any));
  const key = `pair:${String(code || "").toUpperCase()}`;
  if (!code) return NextResponse.json({ error: "Missing pairing code." }, { status: 400 });

  const pairing = await kvGet<Pairing>(key);
  if (!pairing) return NextResponse.json({ error: "That code has expired. Generate a new one." }, { status: 404 });
  if (pairing.status === "paired") return NextResponse.json({ error: "That code has already been used." }, { status: 409 });

  const token = newToken();
  const cleanAgent = {
    host: String(agent?.host || "your machine"),
    platform: String(agent?.platform || ""),
    claude: Boolean(agent?.claude),
    codex: Boolean(agent?.codex),
    git: Boolean(agent?.git),
    node: String(agent?.node || ""),
    engine: ["claude", "codex"].includes(String(agent?.engine)) ? String(agent?.engine) : (agent?.claude ? "claude" : agent?.codex ? "codex" : ""),
  };
  await kvSet(`agent:${token}`, { token, agent: cleanAgent, pairedAt: Date.now(), lastSeen: Date.now() }, 60 * 60 * 24 * 30);
  await kvSet(`token:${String(code).toUpperCase()}`, token, 60 * 60 * 24 * 30);
  await kvSet(key, { ...pairing, status: "paired", token, agent: cleanAgent }, 60 * 60 * 24 * 30);

  return NextResponse.json({ token }, { headers: { "Cache-Control": "no-store" } });
}
