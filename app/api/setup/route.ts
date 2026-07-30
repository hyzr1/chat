import { NextResponse } from "next/server";
import { execFile } from "child_process";
import { access, mkdir, stat } from "fs/promises";
import { promisify } from "util";
import os from "os";
import { WORKSPACE_DIRECTORY } from "@/lib/product-paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

// Detect a CLI on PATH and, when present, grab its version string.
async function detect(command: string, versionArgs = ["--version"]) {
  const locator = process.platform === "win32" ? "where.exe" : "which";
  try {
    await execFileAsync(locator, [command], { timeout: 2500, windowsHide: true });
  } catch {
    return { available: false as const, version: null as string | null };
  }
  let version: string | null = null;
  try {
    const { stdout } = await execFileAsync(command, versionArgs, { timeout: 3000, windowsHide: true, shell: process.platform === "win32" });
    version = stdout.trim().split(/\r?\n/)[0]?.slice(0, 60) || null;
  } catch {}
  return { available: true as const, version };
}

export async function GET() {
  const [git, claude, codex] = await Promise.all([
    detect("git"),
    detect("claude"),
    detect("codex"),
  ]);

  let workspaceExists = false;
  let projectCount = 0;
  try {
    await access(WORKSPACE_DIRECTORY);
    workspaceExists = (await stat(WORKSPACE_DIRECTORY)).isDirectory();
  } catch {}

  return NextResponse.json({
    platform: process.platform,
    host: os.hostname(),
    node: { available: true, version: process.version },
    git,
    claude,
    codex,
    workspace: { path: WORKSPACE_DIRECTORY, exists: workspaceExists, projects: projectCount },
    ready: Boolean(claude.available || codex.available),
  }, { headers: { "Cache-Control": "no-store" } });
}

// Create the isolated projects root if it does not exist yet.
export async function POST() {
  try {
    await mkdir(WORKSPACE_DIRECTORY, { recursive: true });
    return NextResponse.json({ ok: true, path: WORKSPACE_DIRECTORY });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: String(error?.message || error) }, { status: 500 });
  }
}
