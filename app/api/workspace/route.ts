import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { workspaceFor } from "@/lib/local-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const IGNORE = new Set(["node_modules", ".git", ".next", ".cache"]);

interface FileNode {
  name: string;
  path: string; // relative to workspace
  type: "file" | "dir";
  size?: number;
}

async function walk(dir: string, rel = "", depth = 0): Promise<FileNode[]> {
  if (depth > 20) return [];
  let entries: any[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: FileNode[] = [];
  for (const e of entries) {
    if (IGNORE.has(e.name) || e.name.startsWith(".")) continue;
    const rpath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push({ name: e.name, path: rpath, type: "dir" });
      out.push(...(await walk(path.join(dir, e.name), rpath, depth + 1)));
    } else {
      let size = 0;
      try {
        size = (await fs.stat(path.join(dir, e.name))).size;
      } catch {}
      out.push({ name: e.name, path: rpath, type: "file", size });
    }
  }
  return out;
}

// Find the best HTML entry point to preview (shallowest index.html, else any html).
function findEntry(files: FileNode[]): string | null {
  const htmls = files.filter(
    (f) => f.type === "file" && /\.html?$/i.test(f.name),
  );
  if (!htmls.length) return null;
  const built = htmls.find((f) => /^(dist|build|out)\/index\.html?$/i.test(f.path));
  if (built) return built.path;
  const indexes = htmls.filter((f) => /index\.html?$/i.test(f.name));
  const pool = indexes.length ? indexes : htmls;
  pool.sort((a, b) => a.path.split("/").length - b.path.split("/").length);
  return pool[0].path;
}

export async function GET(req: NextRequest) {
  const workspace = workspaceFor(req.nextUrl.searchParams.get("session") ?? undefined);
  try {
    await fs.mkdir(workspace, { recursive: true });
  } catch {}
  const requestedFile = req.nextUrl.searchParams.get("file");
  if (requestedFile) {
    try {
      const root = path.resolve(workspace);
      const target = path.resolve(root, requestedFile);
      if (target === root || !target.startsWith(root + path.sep)) {
        return NextResponse.json({ error: "Invalid project path" }, { status: 400 });
      }
      const stat = await fs.stat(target);
      if (!stat.isFile()) return NextResponse.json({ error: "Not a file" }, { status: 400 });
      if (stat.size > 512 * 1024) {
        return NextResponse.json({ error: "File is larger than the 512 KB viewer limit" }, { status: 413 });
      }
      const content = await fs.readFile(target, "utf8");
      if (content.includes("\0")) return NextResponse.json({ error: "Binary files cannot be displayed" }, { status: 415 });
      return NextResponse.json({ path: requestedFile, content, size: stat.size });
    } catch {
      return NextResponse.json({ error: "Project file not found" }, { status: 404 });
    }
  }
  const files = await walk(workspace);
  const entry = findEntry(files);
  return NextResponse.json({ files, entry, count: files.length });
}
