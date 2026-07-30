import { NextRequest, NextResponse } from "next/server";
import { kvGet, kvSet, newCode, relayBackedByRedis } from "@/lib/relay-store";
import { AGENT_COOKIE } from "@/lib/paired-agent";
import { authUser } from "@/lib/auth";
import { isHostedRuntime } from "@/lib/agent-protocol";
import { takeRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The hosted UI asks for a fresh pairing code, then polls /api/agent/status
// until a local agent claims it.
export async function POST(request: NextRequest) {
  if (isHostedRuntime() && !relayBackedByRedis) {
    return NextResponse.json({ error: "Pairing requires UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN on Vercel." }, { status: 503 });
  }
  const user = await authUser(request);
  if (!user) return NextResponse.json({ error: "Sign in before pairing a computer." }, { status: 401 });
  const rate = await takeRateLimit(request, "agent-pair-code", 10, 15 * 60);
  if (!rate.allowed) return NextResponse.json({ error: "Too many pairing codes. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
  let code = newCode();
  for (let attempt = 0; attempt < 5 && await kvGet(`pair:${code}`); attempt++) code = newCode();
  if (await kvGet(`pair:${code}`)) return NextResponse.json({ error: "Could not allocate a pairing code. Try again." }, { status: 503 });
  await kvSet(`pair:${code}`, { status: "pending", createdAt: Date.now(), accountId: user.id }, 900);
  const response = NextResponse.json({ code, expiresIn: 900 }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(AGENT_COOKIE, code, {
    httpOnly: true,
    sameSite: "strict",
    secure: isHostedRuntime(),
    path: "/",
    maxAge: 900,
  });
  return response;
}
