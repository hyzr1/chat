import { NextRequest, NextResponse } from "next/server";
import { deviceSecretFingerprint, type DevicePairing } from "@/lib/device-pairing";
import { kvGet } from "@/lib/relay-store";
import { AGENT_PROTOCOL_VERSION } from "@/lib/agent-protocol";
import { takeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rate = await takeRateLimit(request, "agent-device-token", 400, 15 * 60);
  if (!rate.allowed) return NextResponse.json({ error: "slow_down" }, { status: 429, headers: { "Retry-After": "5" } });
  const body = await request.json().catch(() => ({}));
  const secret = String((body as any)?.deviceSecret || "");
  if (secret.length < 32 || secret.length > 200) return NextResponse.json({ error: "invalid_device_secret" }, { status: 400 });
  const state = await kvGet<DevicePairing>(`device-secret:${deviceSecretFingerprint(secret)}`);
  if (!state || state.expiresAt <= Date.now()) return NextResponse.json({ error: "expired_token" }, { status: 404 });
  if (state.status !== "approved" || !state.token) {
    return NextResponse.json({ status: "authorization_pending" }, { status: 202, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({
    status: "approved",
    token: state.token,
    protocol: AGENT_PROTOCOL_VERSION,
  }, { headers: { "Cache-Control": "no-store" } });
}
