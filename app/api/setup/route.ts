import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { access, mkdir, stat } from "fs/promises";
import { promisify } from "util";
import os from "os";
import { WORKSPACE_DIRECTORY } from "@/lib/product-paths";
import { isHostedRuntime } from "@/lib/agent-protocol";
import { pairedAgent } from "@/lib/paired-agent";

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

// True when the app is running on hosted/serverless infra (e.g. Vercel)
// rather than on the user's own machine. In that case the server can't see
// the user's local CLIs — they must run a local pairing agent instead.
export async function GET(request: NextRequest) {
  if (isHostedRuntime()) {
    const paired = await pairedAgent(request);
    // Detection here would describe the serverless box, not the user. Report
    // hosted mode so the client shows the "download the local agent" flow.
    return NextResponse.json({
      hosted: true,
      platform: paired?.agent.platform || "",
      host: paired?.agent.host,
      node: paired?.agent.node ? { available: true, version: paired.agent.node } : undefined,
      git: paired ? { available: paired.agent.git, version: null } : undefined,
      gh: paired ? { available: paired.agent.gh, version: null } : undefined,
      claude: paired ? { available: paired.agent.claude, version: null } : undefined,
      codex: paired ? { available: paired.agent.codex, version: null } : undefined,
      workspace: paired?.agent.workspaceRoot
        ? { path: paired.agent.workspaceRoot, exists: true, projects: 0 }
        : undefined,
      agentConnected: Boolean(paired?.online),
      agent: paired?.agent || null,
      ready: Boolean(paired?.online && (paired.agent.claude || paired.agent.codex)),
    }, { headers: { "Cache-Control": "no-store" } });
  }

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
    hosted: false,
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
  if (isHostedRuntime()) return NextResponse.json({ ok: false, error: "Not available on hosted Hyzr — pair a local agent." }, { status: 400 });
  try {
    await mkdir(WORKSPACE_DIRECTORY, { recursive: true });
    return NextResponse.json({ ok: true, path: WORKSPACE_DIRECTORY });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: String(error?.message || error) }, { status: 500 });
  }
}
