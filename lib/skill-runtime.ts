import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { Engine } from "./local-models";
import { workspaceFor } from "./workspace";

export interface RuntimeSkill {
  name: string;
  description: string;
  source: "builtin" | "codex" | "claude" | "workspace";
  path?: string;
  instructions?: string;
  score: number;
}

const BUILTINS: Array<Omit<RuntimeSkill, "score"> & { match: RegExp }> = [
  {
    name: "server-operation",
    description: "Start, stop, restart, or verify a local development server or port with minimal exploration.",
    source: "builtin",
    match: /\b(start|stop|restart|reopen|verify|check)\b.{0,48}\b(server|dev server|port|process|localhost)\b/i,
    instructions: "Do not scan the repository. Identify the manifest or existing command, perform the single server operation, verify once with an HTTP request, report the reachable URL, then stop.",
  },
  {
    name: "scoped-change",
    description: "Make a small UI, copy, style, animation, rename, formatting, or configuration change without broad repository exploration.",
    source: "builtin",
    match: /\b(tweak|adjust|rename|small|quick|simple|copy|spacing|color|timing|duration|easing|one[- ]line|single)\b/i,
    instructions: "Use the repository map to open only the likely entry or style file. Make the smallest coherent edit, run the narrowest relevant check once, summarize evidence, then stop. Do not redesign or refactor unrelated code.",
  },
  {
    name: "systematic-debugging",
    description: "Diagnose a reproducible bug, error, crash, regression, or broken behavior using evidence before editing.",
    source: "builtin",
    match: /\b(debug|bug|broken|crash|regression|root cause|doesn['’]?t work|error)\b/i,
    instructions: "Reproduce or inspect the exact failure, form one concrete hypothesis, read only the implicated files, patch the root cause, and run one focused regression check. Avoid speculative rewrites.",
  },
  {
    name: "frontend-delivery",
    description: "Build or substantially redesign a responsive web interface with concise implementation and visual verification.",
    source: "builtin",
    match: /\b(frontend|website|web app|landing page|responsive|mobile ui|design system|webgl|gsap)\b/i,
    instructions: "Inspect the existing entrypoint and styles before creating files. Reuse the current stack, implement the requested flow, then verify one desktop and one mobile viewport. Do not repeatedly reopen previews or narrate routine tool calls.",
  },
  {
    name: "minimal-greenfield",
    description: "Create a new small application in an empty workspace using the least complex viable stack.",
    source: "builtin",
    match: /\b(build|create|make|scaffold)\b.{0,64}\b(app|application|site|website|tool)\b/i,
    instructions: "If the workspace is empty, choose the simplest dependency-free implementation that satisfies the request. Create only required files, implement in one pass, run one syntax/build check, and stop after evidence.",
  },
];

const STOP = new Set("the a an and or to for from with in on of is are be this that use using skill app code project task".split(" "));
let cached: { at: number; skills: RuntimeSkill[] } | undefined;

function frontmatter(markdown: string) {
  const block = markdown.match(/^---\s*([\s\S]*?)\s*---/)?.[1] ?? markdown.slice(0, 1000);
  const read = (key: string) => block.match(new RegExp(`^${key}\\s*:\\s*["']?([^\\r\\n"']+)`, "im"))?.[1]?.trim();
  return { name: read("name"), description: read("description") };
}

async function discover(root: string, source: RuntimeSkill["source"], depth = 0): Promise<RuntimeSkill[]> {
  if (depth > 4) return [];
  let entries: import("fs").Dirent[] = [];
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch { return []; }
  const found: RuntimeSkill[] = [];
  for (const entry of entries.slice(0, 200)) {
    if (!entry.isDirectory()) continue;
    const directory = path.join(root, entry.name);
    const file = path.join(directory, "SKILL.md");
    try {
      const markdown = await fs.readFile(file, "utf8");
      const meta = frontmatter(markdown);
      found.push({ name: meta.name || entry.name, description: meta.description || "", source, path: file, score: 0 });
    } catch {
      found.push(...await discover(directory, source, depth + 1));
    }
  }
  return found;
}

async function installedSkills(workspaceId?: string) {
  if (cached && Date.now() - cached.at < 30_000) return cached.skills;
  const workspace = workspaceId ? workspaceFor(workspaceId) : "";
  const groups = await Promise.all([
    discover(path.join(os.homedir(), ".codex", "skills"), "codex"),
    discover(path.join(os.homedir(), ".claude", "skills"), "claude"),
    ...(workspace ? [discover(path.join(workspace, ".agents", "skills"), "workspace"), discover(path.join(workspace, ".claude", "skills"), "workspace")] : []),
  ]);
  const skills = groups.flat();
  cached = { at: Date.now(), skills };
  return skills;
}

function relevance(prompt: string, skill: RuntimeSkill) {
  const text = prompt.toLowerCase();
  if (new RegExp(`\\b(?:use|with|apply)\\s+(?:the\\s+)?${skill.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(prompt)) return 100;
  const words = `${skill.name} ${skill.description}`.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) ?? [];
  return words.filter((word) => !STOP.has(word) && text.includes(word)).length;
}

export async function resolveRuntimeSkills(prompt: string, engine: Engine, workspaceId?: string): Promise<RuntimeSkill[]> {
  const builtin = BUILTINS.find((skill) => skill.match.test(prompt));
  const external = (await installedSkills(workspaceId))
    .filter((skill) => skill.source === "workspace" || skill.source === engine)
    .map((skill) => ({ ...skill, score: relevance(prompt, skill) }))
    .filter((skill) => skill.score >= 2 || skill.score >= 100)
    .sort((a, b) => b.score - a.score)[0];
  return [
    ...(builtin ? [{ ...builtin, score: 50 }] : []),
    ...(external ? [external] : []),
  ].slice(0, 2);
}

export function runtimeSkillContext(skills: RuntimeSkill[]) {
  if (!skills.length) return "";
  return [
    "ACTIVE SKILLS (progressively disclosed)",
    ...skills.map((skill) => skill.instructions
      ? `- ${skill.name}: ${skill.instructions}`
      : `- ${skill.name}: ${skill.description} Skill file: ${skill.path}. Read only this SKILL.md if its procedure is needed; do not preload its references or unrelated skills.`),
  ].join("\n");
}

export async function hydratedRuntimeSkillContext(skills: RuntimeSkill[]) {
  const sections: string[] = [];
  for (const skill of skills.slice(0, 2)) {
    if (skill.instructions) {
      sections.push(`- ${skill.name}: ${skill.instructions}`);
      continue;
    }
    if (!skill.path) continue;
    try {
      const markdown = await fs.readFile(skill.path, "utf8");
      const body = markdown.replace(/^---\s*[\s\S]*?\s*---\s*/, "").trim().slice(0, 3_500);
      sections.push(`- ${skill.name} (${skill.source}; activated instructions only):\n${body || skill.description}`);
    } catch {
      sections.push(`- ${skill.name}: ${skill.description}`);
    }
  }
  const context = sections.length ? `ACTIVE SKILLS (bounded progressive disclosure; references not loaded)\n${sections.join("\n\n")}`.slice(0, 5_000) : "";
  return { context, instructionCharacters: context.length, referencesLoaded: 0 };
}
