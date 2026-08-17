import { NextRequest, NextResponse } from "next/server";
import { queuePopBlocking } from "@/lib/relay-store";
import { getAgentRecord, touchAgent } from "@/lib/agent-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keep this comfortably under the platform's function time limit; the agent
// simply re-polls when it expires.
const POLL_WAIT_SECONDS = 8;

// The local agent long-polls for the next job. The wait is handed to Redis via
// BLPOP, so this costs one round trip regardless of how long it blocks and the
// function sits idle rather than burning CPU on a polling timer.
export async function GET(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || new URL(request.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "Missing token." }, { status: 400 });

  const record = await getAgentRecord(token);
  if (!record || record.revokedAt) return NextResponse.json({ error: "Expired agent session." }, { status: 401 });
  await touchAgent(token, record);

  const job = await queuePopBlocking(`jobs:${token}`, POLL_WAIT_SECONDS);
  return NextResponse.json({ job: job ?? null }, { headers: { "Cache-Control": "no-store" } });
}
