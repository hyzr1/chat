import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import { kvGet, kvSet } from "./relay-store";

export async function takeRateLimit(request: NextRequest, namespace: string, limit: number, windowSeconds: number) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "local";
  const key = createHash("sha256").update(`${namespace}:${address}`).digest("hex").slice(0, 32);
  const now = Date.now();
  const current = await kvGet<{ count: number; resetAt: number }>(`limit:${key}`);
  const next = !current || current.resetAt <= now
    ? { count: 1, resetAt: now + windowSeconds * 1000 }
    : { count: current.count + 1, resetAt: current.resetAt };
  await kvSet(`limit:${key}`, next, Math.max(1, Math.ceil((next.resetAt - now) / 1000)));
  return {
    allowed: next.count <= limit,
    remaining: Math.max(0, limit - next.count),
    retryAfter: Math.max(1, Math.ceil((next.resetAt - now) / 1000)),
  };
}

