import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { relayBackedByRedis, kvGet, kvSet, newCode } from "@/lib/relay-store";
import { isHostedRuntime } from "@/lib/agent-protocol";
import { sanitizeAgentCapabilities } from "@/lib/agent-record";
import {
  DEVICE_PAIR_TTL_SECONDS,
  DEVICE_POLL_INTERVAL_SECONDS,
  deviceSecretFingerprint,
  type DevicePairing,
} from "@/lib/device-pairing";
import { takeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (isHostedRuntime() && !relayBackedByRedis) {
    return NextResponse.json({ error: "Pairing is temporarily unavailable." }, { status: 503 });
  }
  const rate = await takeRateLimit(request, "agent-device-start", 20, 15 * 60);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Too many pairing attempts. Please wait a moment.", retryAfter: rate.retryAfter },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
    );
  }

  const body = await request.json().catch(() => ({}));
  const agent = sanitizeAgentCapabilities((body as any)?.agent);
  const secret = randomBytes(32).toString("base64url");
  const secretKey = `device-secret:${deviceSecretFingerprint(secret)}`;
  let rawCode = newCode(8);
  let code = `${rawCode.slice(0, 4)}-${rawCode.slice(4)}`;
  for (let attempt = 0; attempt < 6 && await kvGet(`device-code:${code}`); attempt++) {
    rawCode = newCode(8);
    code = `${rawCode.slice(0, 4)}-${rawCode.slice(4)}`;
  }
  if (await kvGet(`device-code:${code}`)) {
    return NextResponse.json({ error: "Could not allocate a pairing code. Try again." }, { status: 503 });
  }

  const now = Date.now();
  const state: DevicePairing = {
    status: "pending",
    createdAt: now,
    expiresAt: now + DEVICE_PAIR_TTL_SECONDS * 1000,
    agent,
  };
  await kvSet(secretKey, state, DEVICE_PAIR_TTL_SECONDS);
  await kvSet(`device-code:${code}`, secretKey, DEVICE_PAIR_TTL_SECONDS);

  const origin = request.nextUrl.origin;
  const verificationUri = `${origin}/pair/device`;
  return NextResponse.json({
    userCode: code,
    deviceSecret: secret,
    verificationUri,
    verificationUriComplete: `${verificationUri}?code=${encodeURIComponent(code)}`,
    expiresIn: DEVICE_PAIR_TTL_SECONDS,
    interval: DEVICE_POLL_INTERVAL_SECONDS,
  }, { headers: { "Cache-Control": "no-store" } });
}
