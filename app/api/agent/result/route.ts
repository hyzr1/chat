import { NextRequest, NextResponse } from "next/server";
import { kvGetMany, queuePushMany } from "@/lib/relay-store";
import { tokenFingerprint } from "@/lib/paired-agent";
import { touchAgent, type AgentRecord } from "@/lib/agent-record";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set([
  "status", "text", "tool", "usage", "result",
  "done", "error", "plan", "task_start", "task_done", "route",
]);

// Guard against a runaway launcher pushing an unbounded batch.
const MAX_EVENTS = 256;

type Incoming = { jobId?: string; type?: string; text?: unknown; data?: unknown };

// The agent streams a job's output back, ending with a done/error event. The
// hosted UI reads these via /api/agent/events.
//
// Newer launchers send { events: [...] } so a burst of model tokens costs one
// request instead of one per token; older ones send a single flat event and are
// still accepted. Everything a batch needs is fetched in one pipelined read,
// and each job's events are appended with a single variadic RPUSH.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({} as any));
  const token: string = body?.token;
  if (!token) return NextResponse.json({ error: "Missing fields." }, { status: 400 });

  const incoming: Incoming[] = Array.isArray(body?.events)
    ? body.events
    : [{ jobId: body?.jobId, type: body?.type, text: body?.text, data: body?.data }];

  if (incoming.length === 0) {
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }
  if (incoming.length > MAX_EVENTS) {
    return NextResponse.json({ error: "Too many events." }, { status: 413 });
  }
  if (incoming.some((e) => !e?.jobId || !e?.type)) {
    return NextResponse.json({ error: "Missing fields." }, { status: 400 });
  }
  if (incoming.some((e) => !ALLOWED.has(String(e.type)))) {
    return NextResponse.json({ error: "Unknown result type." }, { status: 400 });
  }

  // One pipelined read covers the agent record plus every distinct job owner,
  // rather than a GET per event.
  const jobIds = [...new Set(incoming.map((e) => String(e.jobId)))];
  const [record, ...owners] = await kvGetMany<any>([
    `agent:${token}`,
    ...jobIds.map((id) => `job-owner:${id}`),
  ]);

  const agent = record as AgentRecord | null;
  if (!agent || agent.revokedAt) {
    return NextResponse.json({ error: "Expired agent session." }, { status: 401 });
  }

  const fingerprint = tokenFingerprint(token);
  const ownerByJob = new Map(jobIds.map((id, i) => [id, owners[i] as string | null]));
  if (jobIds.some((id) => ownerByJob.get(id) !== fingerprint)) {
    return NextResponse.json({ error: "Unknown job." }, { status: 404 });
  }

  // Result delivery is also proof that the launcher is alive. This keeps
  // launchers from older releases online during long model/tool operations.
  // touchAgent now rate-limits its own write, so this is usually free.
  await touchAgent(token, agent);

  const at = Date.now();
  const byJob = new Map<string, unknown[]>();
  for (const event of incoming) {
    const id = String(event.jobId);
    const list = byJob.get(id) ?? [];
    list.push({
      type: event.type,
      text: typeof event.text === "string" ? event.text.slice(0, 48_000) : undefined,
      data: event.data === undefined ? undefined : event.data,
      at,
    });
    byJob.set(id, list);
  }

  await Promise.all(
    [...byJob].map(([id, events]) => queuePushMany(`results:${id}`, events, 24 * 60 * 60)),
  );

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
