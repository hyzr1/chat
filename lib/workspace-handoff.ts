import { promises as fs } from "fs";
import path from "path";
import { workspaceFor } from "./workspace";

type Snapshot = Map<string, { size: number; modified: number }>;
const IGNORE = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", ".cache"]);

export async function snapshotWorkspace(workspaceId: string): Promise<Snapshot> {
  const root = workspaceFor(workspaceId);
  const snapshot: Snapshot = new Map();
  async function walk(directory: string, depth: number) {
    if (depth > 7 || snapshot.size >= 3000) return;
    let entries: import("fs").Dirent[] = [];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute, depth + 1);
      else if (entry.isFile()) {
        try {
          const stat = await fs.stat(absolute);
          snapshot.set(path.relative(root, absolute).replace(/\\/g, "/"), { size: stat.size, modified: stat.mtimeMs });
        } catch {}
      }
    }
  }
  await walk(root, 0);
  return snapshot;
}

export function buildWorkspaceHandoff(before: Snapshot, after: Snapshot) {
  const created: string[] = [];
  const changed: string[] = [];
  const deleted: string[] = [];
  for (const [file, current] of after) {
    const previous = before.get(file);
    if (!previous) created.push(file);
    else if (previous.size !== current.size || previous.modified !== current.modified) changed.push(file);
  }
  for (const file of before.keys()) if (!after.has(file)) deleted.push(file);
  const compact = (items: string[]) => items.slice(0, 16).join(", ") || "none";
  return {
    created,
    changed,
    deleted,
    context: `PREVIOUS SPECIALIST HANDOFF\nCreated: ${compact(created)}\nChanged: ${compact(changed)}\nDeleted: ${compact(deleted)}\nTrust the workspace as source of truth; inspect only a listed file needed for your task.`,
  };
}
