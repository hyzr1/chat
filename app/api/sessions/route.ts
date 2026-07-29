import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { STATE_DIRECTORY } from "@/lib/product-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface SharedSession { id: string; updatedAt?: number; createdAt?: number; [key: string]: unknown; }
interface SharedState { sessions: SharedSession[]; tombstones: Record<string, number>; revision: number; }

const directory = STATE_DIRECTORY;
const stateFile = path.join(directory, "shared-sessions.json");
let writeQueue: Promise<unknown> = Promise.resolve();

function sanitizeSession(session: SharedSession): SharedSession {
  const normalized = Array.isArray(session.messages) ? session.messages.map((raw: any) => {
    if (!raw || typeof raw !== "object") return raw;
    const steps = Array.isArray(raw.steps) ? Array.from(new Map(raw.steps.map((step: any) => [String(step?.label ?? ""), step])).values()).slice(-24) : raw.steps;
    const filteredContent = String(raw.content ?? "")
      .split(/\r?\n/)
      .filter((line) => !/codex_core::shell_snapshot|shell snapshot not supported yet for powershell/i.test(line))
      .join("\n")
      .trim();
    const lines = filteredContent.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const unique = Array.from(new Set(lines));
    const corrupt = lines.length > 80 && unique.length * 3 < lines.length;
    return { ...raw, content: corrupt ? unique.join("\n\n") : filteredContent, steps, usage: corrupt ? undefined : raw.usage };
  }) : session.messages;
  const messages = Array.isArray(normalized) ? normalized.reduce((cleaned: any[], current: any) => {
    const previous = cleaned[cleaned.length - 1];
    const content = String(current?.content ?? "").trim();
    if (previous && previous.role === current?.role && String(previous.content ?? "").trim() === content && content) return cleaned;
    if (
      current?.role === "assistant" && cleaned.length >= 3 &&
      cleaned[cleaned.length - 1]?.role === "user" && cleaned[cleaned.length - 2]?.role === "assistant" && cleaned[cleaned.length - 3]?.role === "user" &&
      String(cleaned[cleaned.length - 1].content ?? "").trim() === String(cleaned[cleaned.length - 3].content ?? "").trim() &&
      content === String(cleaned[cleaned.length - 2].content ?? "").trim()
    ) {
      cleaned.pop();
      return cleaned;
    }
    cleaned.push(current);
    return cleaned;
  }, []) : normalized;
  return { ...session, messages };
}

async function readState(): Promise<SharedState> {
  try {
    const parsed = JSON.parse(await fs.readFile(stateFile, "utf8"));
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions.map(sanitizeSession) : [],
      tombstones: parsed.tombstones && typeof parsed.tombstones === "object" ? parsed.tombstones : {},
      revision: Number(parsed.revision) || 0,
    };
  } catch {
    return { sessions: [], tombstones: {}, revision: 0 };
  }
}

async function writeState(state: SharedState) {
  await fs.mkdir(directory, { recursive: true });
  const temporary = `${stateFile}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(state), "utf8");
  await fs.rename(temporary, stateFile);
}

function timestamp(session: SharedSession) {
  return Number(session.updatedAt) || Number(session.createdAt) || 0;
}

export async function GET(req: NextRequest) {
  const state = await readState();
  const since = Number(req.nextUrl.searchParams.get("since") ?? -1);
  if (since >= 0 && since === state.revision) return new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const incoming = Array.isArray(body.sessions) ? body.sessions.filter((session: any) => session && typeof session.id === "string") as SharedSession[] : [];
  const deleted = body.tombstones && typeof body.tombstones === "object" ? body.tombstones as Record<string, number> : {};

  const operation = writeQueue.then(async () => {
    const state = await readState();
    const tombstones = { ...state.tombstones };
    for (const [id, deletedAt] of Object.entries(deleted)) {
      const time = Number(deletedAt) || Date.now();
      if (time > (tombstones[id] || 0)) tombstones[id] = time;
    }

    const sessions = new Map(state.sessions.map((session) => [session.id, session]));
    for (const session of incoming) {
      if ((tombstones[session.id] || 0) >= timestamp(session)) continue;
      const existing = sessions.get(session.id);
      if (!existing || timestamp(session) >= timestamp(existing)) sessions.set(session.id, session);
    }
    for (const [id, deletedAt] of Object.entries(tombstones)) {
      const session = sessions.get(id);
      if (session && deletedAt >= timestamp(session)) sessions.delete(id);
    }

    // Tombstones only need to outlive offline clients for a month.
    const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
    for (const [id, deletedAt] of Object.entries(tombstones)) if (deletedAt < cutoff) delete tombstones[id];
    const next: SharedState = { sessions: [...sessions.values()].sort((a, b) => timestamp(b) - timestamp(a)), tombstones, revision: state.revision + 1 };
    await writeState(next);
    return next;
  });
  writeQueue = operation.catch(() => {});
  try {
    const next = await operation;
    return NextResponse.json({ revision: next.revision, tombstones: next.tombstones }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Could not synchronize chats" }, { status: 500 });
  }
}
