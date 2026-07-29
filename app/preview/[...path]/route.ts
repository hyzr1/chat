import { NextRequest } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { workspaceFor } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves files from the agent workspace so a built app can render in an iframe.
// Relative assets (css/js/img) resolve against /preview/<dir>/ automatically.

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const parts = (await params).path ?? [];
  const scoped = parts[0] === "_s" && parts.length >= 3;
  const sessionId = scoped ? parts[1] : req.nextUrl.searchParams.get("session") ?? undefined;
  const rel = (scoped ? parts.slice(2) : parts).join("/") || "index.html";
  if (rel.includes("..")) return new Response("bad path", { status: 400 });
  const workspace = workspaceFor(sessionId);
  const full = path.join(/* turbopackIgnore: true */ workspace, rel);
  if (!full.startsWith(workspace)) return new Response("bad path", { status: 400 });
  try {
    const data = await fs.readFile(full);
    const ext = path.extname(full).toLowerCase();
    const scope = `/preview/_s/${encodeURIComponent(sessionId ?? "legacy")}/`;
    const top = rel.split("/")[0]?.toLowerCase();
    const siteRoot = ["dist", "build", "out"].includes(top) ? `${scope}${top}/` : scope;
    let body: BodyInit = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    if (ext === ".html" || ext === ".htm") {
      let html = data.toString("utf8");
      const base = `${scope}${rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : ""}`;
      const baseTag = `<base href="${base}">`;
      html = /<head[^>]*>/i.test(html)
        ? html.replace(/<head([^>]*)>/i, `<head$1>${baseTag}`)
        : `${baseTag}${html}`;
      // Generated apps often use root-relative assets. Scope those paths back
      // into this chat instead of letting them hit the Hyzr Chat application root.
      html = html.replace(/((?:src|href|poster|action)\s*=\s*["'])\/(?!\/|preview\/|_next\/)/gi, `$1${siteRoot}`);
      html = html.replace(/url\(\s*(["']?)\/(?!\/|preview\/|_next\/)/gi, `url($1${siteRoot}`);
      body = html;
    } else if (ext === ".css") {
      body = data.toString("utf8").replace(
        /url\(\s*(["']?)\/(?!\/|preview\/|_next\/)/gi,
        `url($1${siteRoot}`,
      );
    } else if (ext === ".js" || ext === ".mjs") {
      body = data.toString("utf8")
        .replace(/(from\s*["'])\/(?!\/)/g, `$1${siteRoot}`)
        .replace(/(import\s*["'])\/(?!\/)/g, `$1${siteRoot}`);
    }
    return new Response(body, {
      headers: {
        "Content-Type": TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
