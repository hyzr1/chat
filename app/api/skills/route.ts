import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Skills stay on disk until a task matches. This endpoint exposes metadata
// only, so opening the library does not inject every instruction into context.
const SKILL_ROOTS = [
  { dir: path.join(os.homedir(), ".codex", "skills"), source: "codex" as const },
  { dir: path.join(os.homedir(), ".claude", "skills"), source: "claude" as const },
];

interface Skill {
  name: string;
  description: string;
  system: boolean;
  path: string;
  source: "codex" | "claude";
}

function parseFrontmatter(md: string): { name?: string; description?: string } {
  const m = md.match(/^---\s*([\s\S]*?)\s*---/);
  const body = m ? m[1] : md.slice(0, 600);
  const get = (key: string) => {
    const r = new RegExp(`^${key}\\s*:\\s*(.+)$`, "im").exec(body);
    return r ? r[1].trim().replace(/^["']|["']$/g, "") : undefined;
  };
  return { name: get("name"), description: get("description") };
}

async function collect(dir: string, system: boolean, source: Skill["source"], out: Skill[]) {
  let entries: any[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name === ".system") {
      await collect(path.join(dir, e.name), true, source, out);
      continue;
    }
    const skillMd = path.join(dir, e.name, "SKILL.md");
    try {
      const md = await fs.readFile(skillMd, "utf8");
      const fm = parseFrontmatter(md);
      out.push({
        name: fm.name || e.name,
        description: fm.description || "",
        system,
        path: `${e.name}`,
        source,
      });
    } catch {
      // not a skill dir
    }
  }
}

export async function GET() {
  const out: Skill[] = [];
  await Promise.all(SKILL_ROOTS.map((root) => collect(root.dir, false, root.source, out)));
  out.sort((a, b) => Number(a.system) - Number(b.system) || a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
  return NextResponse.json({ skills: out });
}
