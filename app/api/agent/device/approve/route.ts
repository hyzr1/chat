import { NextRequest, NextResponse } from "next/server";
import { authUser } from "@/lib/auth";
import { normalizeDeviceCode, type DevicePairing } from "@/lib/device-pairing";
import { kvGet, kvSet, newToken } from "@/lib/relay-store";
import { registerAgent } from "@/lib/agent-record";
import { AGENT_PROTOCOL_VERSION } from "@/lib/agent-protocol";
import { takeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function pairingForCode(codeInput: unknown) {
  const code = normalizeDeviceCode(codeInput);
  if (!code) return { code, secretKey: "", state: null };
  const secretKey = await kvGet<string>(`device-code:${code}`);
  const state = secretKey ? await kvGet<DevicePairing>(secretKey) : null;
  return { code, secretKey: secretKey || "", state };
}

export async function GET(request: NextRequest) {
  const user = await authUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to approve this computer." }, { status: 401 });
  const rate = await takeRateLimit(request, "agent-device-inspect", 30, 10 * 60);
  if (!rate.allowed) return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  const { code, state } = await pairingForCode(request.nextUrl.searchParams.get("code"));
  if (!code) return NextResponse.json({ error: "Enter the 8-character code from the terminal." }, { status: 400 });
  if (!state || state.expiresAt <= Date.now()) {
    return NextResponse.json({ error: "That code expired. The terminal will generate a new one automatically." }, { status: 404 });
  }
  return NextResponse.json({
    code,
    status: state.status,
    agent: state.agent,
    account: { email: user.email },
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const user = await authUser(request);
  if (!user) return NextResponse.json({ error: "Sign in to approve this computer." }, { status: 401 });
  const rate = await takeRateLimit(request, "agent-device-approve", 15, 15 * 60);
  if (!rate.allowed) return NextResponse.json({ error: "Too many approval attempts. Try again shortly." }, { status: 429 });
  const body = await request.json().catch(() => ({}));
  const { code, secretKey, state } = await pairingForCode((body as any)?.code);
  if (!code) return NextResponse.json({ error: "Enter the 8-character code from the terminal." }, { status: 400 });
  if (!state || !secretKey || state.expiresAt <= Date.now()) {
    return NextResponse.json({ error: "That code expired. The terminal will generate a new one automatically." }, { status: 404 });
  }
  if (state.status === "approved") {
    if (state.accountId !== user.id) return NextResponse.json({ error: "That code was already approved." }, { status: 409 });
    return NextResponse.json({ ok: true, protocol: AGENT_PROTOCOL_VERSION });
  }

  const token = newToken();
  await registerAgent(token, user.id, state.agent);
  await kvSet(secretKey, {
    ...state,
    status: "approved",
    accountId: user.id,
    token,
    approvedAt: Date.now(),
  } satisfies DevicePairing, Math.max(60, Math.ceil((state.expiresAt - Date.now()) / 1000)));
  return NextResponse.json({ ok: true, protocol: AGENT_PROTOCOL_VERSION }, { headers: { "Cache-Control": "no-store" } });
}
