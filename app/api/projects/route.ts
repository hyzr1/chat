import { NextRequest, NextResponse } from "next/server";
import { activeProjectId, listProjects, removeProject, saveProject, setActiveProject } from "@/lib/project-store";
import type { SharedProject } from "@/lib/project-store";
import { authUser } from "@/lib/auth";
import { isHostedRuntime } from "@/lib/agent-protocol";
import { kvGet, kvSet } from "@/lib/relay-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HostedProjects {
  projects: SharedProject[];
  activeProjectId: string | null;
}

const noStore = { "Cache-Control": "no-store" };
const clean = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";

async function hostedState(request: NextRequest) {
  const user = await authUser(request);
  if (!user) throw Object.assign(new Error("Sign in to use projects."), { status: 401 });
  const key = `projects:${user.id}`;
  const state = await kvGet<HostedProjects>(key) || { projects: [], activeProjectId: null };
  return { key, state };
}

async function respond(request: NextRequest) {
  if (!isHostedRuntime()) {
    return NextResponse.json({ projects: listProjects(), activeProjectId: activeProjectId() }, { headers: noStore });
  }
  const { state } = await hostedState(request);
  return NextResponse.json(state, { headers: noStore });
}

function projectFrom(body: any, existing?: SharedProject): SharedProject {
  const id = clean(body?.id, 80).replace(/[^a-zA-Z0-9_-]/g, "");
  const name = clean(body?.name, 100);
  if (!id || !name) throw new Error("A project id and name are required.");
  const now = Date.now();
  return {
    id,
    name,
    repo: clean(body?.repo, 240) || undefined,
    instructions: clean(body?.instructions, 12_000),
    createdAt: existing?.createdAt || Number(body?.createdAt) || now,
    updatedAt: now,
  };
}

export async function GET(request: NextRequest) {
  try {
    return await respond(request);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not load projects." }, { status: error?.status || 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (isHostedRuntime()) {
      const { key, state } = await hostedState(request);
      const project = projectFrom(body, state.projects.find((item) => item.id === body?.id));
      state.projects = [project, ...state.projects.filter((item) => item.id !== project.id)]
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 100);
      await kvSet(key, state, 60 * 60 * 24 * 365);
      return NextResponse.json(state, { headers: noStore });
    }
    saveProject(body);
    return respond(request);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not save project." }, { status: error?.status || 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    if (isHostedRuntime()) {
      const { key, state } = await hostedState(request);
      if (Object.prototype.hasOwnProperty.call(body, "activeProjectId")) {
        const nextId = body.activeProjectId ? clean(body.activeProjectId, 80) : null;
        if (nextId && !state.projects.some((project) => project.id === nextId)) throw new Error("Project not found.");
        state.activeProjectId = nextId;
      } else {
        const project = projectFrom(body, state.projects.find((item) => item.id === body?.id));
        state.projects = [project, ...state.projects.filter((item) => item.id !== project.id)]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, 100);
      }
      await kvSet(key, state, 60 * 60 * 24 * 365);
      return NextResponse.json(state, { headers: noStore });
    }
    if (Object.prototype.hasOwnProperty.call(body, "activeProjectId")) setActiveProject(body.activeProjectId || null);
    else saveProject(body);
    return respond(request);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not update project." }, { status: error?.status || 400 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const id = clean(request.nextUrl.searchParams.get("id"), 80);
    if (!id) return NextResponse.json({ error: "Missing project id." }, { status: 400 });
    if (isHostedRuntime()) {
      const { key, state } = await hostedState(request);
      state.projects = state.projects.filter((project) => project.id !== id);
      if (state.activeProjectId === id) state.activeProjectId = null;
      await kvSet(key, state, 60 * 60 * 24 * 365);
      return NextResponse.json(state, { headers: noStore });
    }
    removeProject(id);
    return respond(request);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not remove project." }, { status: error?.status || 400 });
  }
}
