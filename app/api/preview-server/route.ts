import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import http from "http";
import path from "path";
// Keep the preview server's dependency graph filesystem-only. Importing this
// through local-runner also pulls in the agent CLI process runner and causes
// Next's server tracer to conservatively include the whole application.
import { workspaceFor } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ProjectServer = { port: number; root: string; server: http.Server; lastUsed: number };
const globalServers = globalThis as typeof globalThis & {
  __hyzrChatProjectServers?: Map<string, ProjectServer>;
  __hyzrChatProjectServerSweep?: ReturnType<typeof setInterval>;
};
const servers = globalServers.__hyzrChatProjectServers ??= new Map();
if (!globalServers.__hyzrChatProjectServerSweep) {
  globalServers.__hyzrChatProjectServerSweep = setInterval(() => {
    const cutoff = Date.now() - 2 * 60 * 60 * 1000;
    for (const [id, record] of servers) {
      if (record.lastUsed < cutoff) { record.server.close(); servers.delete(id); }
    }
  }, 10 * 60 * 1000);
  globalServers.__hyzrChatProjectServerSweep.unref?.();
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
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

async function projectRoot(workspace: string) {
  for (const dir of ["dist", "build", "out"]) {
    try {
      const candidate = path.join(/*turbopackIgnore: true*/ workspace, dir);
      await fs.access(path.join(/*turbopackIgnore: true*/ candidate, "index.html"));
      return candidate;
    } catch {}
  }
  await fs.access(path.join(/*turbopackIgnore: true*/ workspace, "index.html"));
  return workspace;
}

function handlerFor(record: ProjectServer) {
  return async (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname);
      const relative = pathname.replace(/^\/+/, "") || "index.html";
      let file = path.resolve(/*turbopackIgnore: true*/ record.root, relative);
      const root = path.resolve(/*turbopackIgnore: true*/ record.root);
      if (file !== root && !file.startsWith(root + path.sep)) {
        res.writeHead(400).end("Bad path");
        return;
      }
      try {
        const stat = await fs.stat(file);
        if (stat.isDirectory()) file = path.join(/*turbopackIgnore: true*/ file, "index.html");
        await fs.access(file);
      } catch {
        // Client-side routes fall back to the entry document; missing assets
        // return a real 404 instead of receiving HTML with the wrong MIME type.
        if (path.extname(relative)) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Project asset not found");
          return;
        }
        file = path.join(/*turbopackIgnore: true*/ root, "index.html");
      }
      const data = await fs.readFile(file);
      res.writeHead(200, {
        "Content-Type": TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      });
      res.end(data);
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Project file not found");
    }
  };
}

async function listen(server: http.Server): Promise<number> {
  for (let port = 3001; port < 3100; port++) {
    const accepted = await new Promise<boolean>((resolve) => {
      const onError = () => { server.off("listening", onListening); resolve(false); };
      const onListening = () => { server.off("error", onError); resolve(true); };
      server.once("error", onError);
      server.once("listening", onListening);
      // Listen on every interface so a phone opening Hyzr Chat through the PC's LAN
      // address can reach the generated project's dedicated port too.
      server.listen(port, "0.0.0.0");
    });
    if (accepted) return port;
  }
  throw new Error("No local preview ports are available between 3001 and 3099");
}

function publicHostname(req: NextRequest) {
  const raw = (req.headers.get("x-forwarded-host") || req.headers.get("host") || req.nextUrl.hostname || "localhost").split(",")[0].trim();
  const withoutPort = raw.startsWith("[") ? raw.slice(1, raw.indexOf("]")) : raw.replace(/:\d+$/, "");
  const safe = withoutPort.replace(/[^a-zA-Z0-9.:-]/g, "") || "localhost";
  const normalized = safe === "127.0.0.1" || safe === "::1" ? "localhost" : safe;
  return normalized.includes(":") ? `[${normalized}]` : normalized;
}

export async function POST(req: NextRequest) {
  try {
    const { sessionId } = await req.json();
    if (!sessionId || typeof sessionId !== "string") {
      return NextResponse.json({ error: "Missing session id" }, { status: 400 });
    }
    const workspace = workspaceFor(sessionId);
    const hostname = publicHostname(req);
    const root = await projectRoot(workspace);
    const existing = servers.get(sessionId);
    if (existing?.server.listening) {
      existing.root = root;
      existing.lastUsed = Date.now();
      return NextResponse.json({ url: `http://${hostname}:${existing.port}`, port: existing.port, hostname });
    }
    if (servers.size >= 20) {
      const oldest = [...servers.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
      if (oldest) { oldest[1].server.close(); servers.delete(oldest[0]); }
    }
    const record = { port: 0, root, server: null as unknown as http.Server, lastUsed: Date.now() };
    record.server = http.createServer(handlerFor(record));
    record.port = await listen(record.server);
    record.server.unref();
    servers.set(sessionId, record);
    return NextResponse.json({ url: `http://${hostname}:${record.port}`, port: record.port, hostname });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Could not start project server" }, { status: 500 });
  }
}
