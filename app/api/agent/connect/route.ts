import { NextRequest, NextResponse } from "next/server";
import { startRelayWorker, relayWorkerStatus } from "@/lib/relay-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Called on a LOCAL Hyzr install to connect it to a hosted site: it starts the
// relay worker, which pairs with the hosted relay and then runs every Agent
// task through this machine's full engine (planner + multi-model routing).
export async function POST(request: NextRequest) {
  const hosted = process.env.VERCEL === "1" || process.env.HYZR_HOSTED === "1";
  if (hosted) return NextResponse.json({ ok: false, error: "Run this from your local Hyzr app, not the hosted site." }, { status: 400 });
  const { url, code } = await request.json().catch(() => ({} as any));
  if (!url || !code) return NextResponse.json({ ok: false, error: "Missing url or code." }, { status: 400 });
  const result = await startRelayWorker(String(url), String(code));
  return NextResponse.json(result, { status: result.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
}

export async function GET() {
  return NextResponse.json(relayWorkerStatus(), { headers: { "Cache-Control": "no-store" } });
}
