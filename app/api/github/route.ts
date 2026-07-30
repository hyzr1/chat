import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { isHostedRuntime, type AgentRpcMethod } from "@/lib/agent-protocol";
import { callPairedAgent } from "@/lib/paired-agent";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IS_WIN = process.platform === "win32";
// gh is a real binary; resolve its absolute path so we can run it WITHOUT a
// shell (a shell would mangle args with spaces/braces/pipes on Windows).
const GH =
  IS_WIN && process.env.ProgramFiles
    ? `${process.env.ProgramFiles}\\GitHub CLI\\gh.exe`
    : "gh";

function gh(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      GH,
      args,
      { maxBuffer: 1024 * 1024 * 12, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.toString().trim() || err.message));
        else resolve(stdout.toString());
      },
    );
  });
}

// Guard against path traversal / arg injection in repo + path params.
function safeRepo(r: string) {
  if (!/^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(r)) throw new Error("bad repo");
  return r;
}
function safePath(p: string) {
  if (p.includes("..")) throw new Error("bad path");
  return p.replace(/^\/+/, "");
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const action = sp.get("action");

  try {
    if (isHostedRuntime()) {
      const methods: Record<string, AgentRpcMethod> = {
        status: "github.status",
        repos: "github.repos",
        tree: "github.tree",
        file: "github.file",
        issues: "github.issues",
        issue: "github.issue",
      };
      const method = methods[action || ""];
      if (!method) return NextResponse.json({ error: "unknown action" }, { status: 400 });
      const data = await callPairedAgent(req, method, {
        repo: sp.get("repo") || "",
        path: sp.get("path") || "",
        state: sp.get("state") || "open",
        number: sp.get("number") || "",
      });
      return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
    }

    if (action === "status") {
      const user = JSON.parse(await gh(["api", "user"]));
      return NextResponse.json({ connected: true, login: user.login });
    }

    if (action === "repos") {
      const out = await gh([
        "repo",
        "list",
        "--json",
        "nameWithOwner,description,updatedAt,visibility,primaryLanguage,stargazerCount",
        "--limit",
        "60",
      ]);
      return NextResponse.json({ repos: JSON.parse(out) });
    }

    if (action === "tree") {
      const repo = safeRepo(sp.get("repo") || "");
      const path = safePath(sp.get("path") || "");
      const raw = JSON.parse(await gh(["api", `repos/${repo}/contents/${path}`]));
      const items = (Array.isArray(raw) ? raw : [raw]).map((it: any) => ({
        name: it.name,
        path: it.path,
        type: it.type,
        size: it.size,
      }));
      items.sort((a, b) =>
        a.type === b.type
          ? a.name.localeCompare(b.name)
          : a.type === "dir"
            ? -1
            : 1,
      );
      return NextResponse.json({ items });
    }

    if (action === "file") {
      const repo = safeRepo(sp.get("repo") || "");
      const path = safePath(sp.get("path") || "");
      const data = JSON.parse(await gh(["api", `repos/${repo}/contents/${path}`]));
      const content = Buffer.from(data.content ?? "", "base64").toString("utf8");
      return NextResponse.json({ content, path });
    }

    if (action === "issues") {
      const repo = safeRepo(sp.get("repo") || "");
      const state = sp.get("state") === "closed" ? "closed" : "open";
      const out = await gh([
        "issue", "list", "--repo", repo, "--state", state, "--limit", "50",
        "--json", "number,title,body,url,labels,assignees,updatedAt",
      ]);
      return NextResponse.json({ issues: JSON.parse(out) });
    }

    if (action === "issue") {
      const repo = safeRepo(sp.get("repo") || "");
      const number = Number(sp.get("number"));
      if (!Number.isInteger(number) || number < 1) throw new Error("bad issue number");
      const out = await gh([
        "issue", "view", String(number), "--repo", repo,
        "--json", "number,title,body,url,labels,assignees,state,comments",
      ]);
      return NextResponse.json({ issue: JSON.parse(out) });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message ?? "gh command failed", connected: false, reason: e?.reason },
      { status: Number(e?.status) || 500 },
    );
  }
}
