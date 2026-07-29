import { NextRequest, NextResponse } from "next/server";
import { activeProjectId, listProjects, removeProject, saveProject, setActiveProject } from "@/lib/project-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = () => NextResponse.json({ projects: listProjects(), activeProjectId: activeProjectId() }, { headers: { "Cache-Control": "no-store" } });

export async function GET() { return response(); }

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    saveProject(body);
    return response();
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not save project." }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    if (Object.prototype.hasOwnProperty.call(body, "activeProjectId")) setActiveProject(body.activeProjectId || null);
    else saveProject(body);
    return response();
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not update project." }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing project id." }, { status: 400 });
  removeProject(id);
  return response();
}
