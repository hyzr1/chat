import { NextRequest, NextResponse } from "next/server";
import { kvGet } from "@/lib/relay-store";
import { pairingCode } from "@/lib/paired-agent";
import { authUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Pairing { status: string; accountId?: string; agent?: { host: string; claude: boolean; codex: boolean; git: boolean; node: string } }

// The hosted UI polls this with its pairing code until an agent has claimed it.
export async function GET(request: NextRequest) {
  const user = await authUser(request);
  if (!user) return NextResponse.json({ error: "Sign in before checking a paired computer." }, { status: 401 });
  const code = new URL(request.url).searchParams.get("code") || pairingCode(request);
  if (!code) return NextResponse.json({ error: "Missing code." }, { status: 400 });
  const pairing = await kvGet<Pairing>(`pair:${code.toUpperCase()}`);
  if (!pairing) return NextResponse.json({ status: "expired" }, { headers: { "Cache-Control": "no-store" } });
  if (pairing.accountId !== user.id) return NextResponse.json({ status: "expired" }, { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(
    { status: pairing.status, agent: pairing.status === "paired" ? pairing.agent ?? null : null },
    { headers: { "Cache-Control": "no-store" } },
  );
}
