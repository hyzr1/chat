import { promises as fs } from "fs";
import path from "path";
import { STATE_DIRECTORY } from "./product-paths";

export interface ProjectMemory {
  workspaceId: string;
  updatedAt: number;
  constraints: string[];
  recentRequests: string[];
  artifacts: string[];
}

const directory = path.join(STATE_DIRECTORY, "project-memory");

function safeId(workspaceId: string) {
  return workspaceId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "legacy";
}

function fileFor(workspaceId: string) {
  return path.join(directory, `${safeId(workspaceId)}.json`);
}

function uniqueRecent(values: string[], limit: number) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of [...values].reverse()) {
    const clean = value.replace(/\s+/g, " ").trim().slice(0, 420);
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    result.unshift(clean);
    if (result.length >= limit) break;
  }
  return result;
}

function promptFacts(prompt: string) {
  const parts = prompt
    .replace(/^\[Space:[^\]]+\]\s*/i, "")
    .split(/(?:\r?\n|(?<=[.!?])\s+)/)
    .map((part) => part.replace(/^[-*]\s*/, "").trim())
    .filter((part) => part.length >= 5);
  return parts.filter((part) => /\b(?:must|should|only|always|never|don't|do not|make sure|prefer|want|need|keep|avoid|mobile|theme|model)\b/i.test(part)).slice(0, 8);
}

export async function readProjectMemory(workspaceId: string): Promise<ProjectMemory> {
  try {
    const parsed = JSON.parse(await fs.readFile(fileFor(workspaceId), "utf8"));
    return {
      workspaceId: safeId(workspaceId),
      updatedAt: Number(parsed.updatedAt) || 0,
      constraints: Array.isArray(parsed.constraints) ? parsed.constraints.slice(-12) : [],
      recentRequests: Array.isArray(parsed.recentRequests) ? parsed.recentRequests.slice(-6) : [],
      artifacts: Array.isArray(parsed.artifacts) ? parsed.artifacts.slice(-30) : [],
    };
  } catch {
    return { workspaceId: safeId(workspaceId), updatedAt: 0, constraints: [], recentRequests: [], artifacts: [] };
  }
}

export async function updateProjectMemory(workspaceId: string, values: { prompt?: string; artifacts?: string[] }) {
  const current = await readProjectMemory(workspaceId);
  const next: ProjectMemory = {
    workspaceId: safeId(workspaceId),
    updatedAt: Date.now(),
    constraints: uniqueRecent([...current.constraints, ...(values.prompt ? promptFacts(values.prompt) : [])], 12),
    recentRequests: uniqueRecent([...current.recentRequests, ...(values.prompt ? [values.prompt] : [])], 6),
    artifacts: uniqueRecent([...current.artifacts, ...(values.artifacts || [])], 30),
  };
  await fs.mkdir(directory, { recursive: true });
  const target = fileFor(workspaceId);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(temporary, target);
  return next;
}

export function projectMemoryContext(memory: ProjectMemory) {
  if (!memory.constraints.length && !memory.recentRequests.length && !memory.artifacts.length) return "";
  const context = [
    "CURRENT CHAT PROJECT MEMORY (deterministic and workspace-scoped)",
    memory.constraints.length ? `Standing user constraints: ${memory.constraints.join(" | ")}` : "",
    memory.recentRequests.length ? `Recent project requests: ${memory.recentRequests.slice(-3).join(" | ")}` : "",
    memory.artifacts.length ? `Known project artifacts: ${memory.artifacts.slice(-16).join(", ")}` : "",
    "Use this only for continuity inside this chat; the workspace remains the source of truth.",
  ].filter(Boolean).join("\n");
  return context.slice(0, 3_000);
}
