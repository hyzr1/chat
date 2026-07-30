import { NextRequest, NextResponse } from "next/server";
import { queuePop } from "@/lib/relay-store";
import { getAgentRecord, touchAgent } from "@/lib/agent-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The local agent long-polls for the next job. Serverless-friendly: a short
// bounded wait, then return null so the agent immediately re-polls.
export async function GET(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });

  const record = await getAgentRecord(token);
  if (!record) return NextResponse.json({ error: "Unknown agent token." }, { status: 401 });
  await touchAgent(token, record);

  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const job = await queuePop(`jobs:${token}`);
    if (job) return NextResponse.json({ job }, { headers: { "Cache-Control": "no-store" } });
    await new Promise((r) => setTimeout(r, 700));
  }
  return NextResponse.json({ job: null }, { headers: { "Cache-Control": "no-store" } });
}
