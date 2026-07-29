import { promises as fs } from "fs";
import path from "path";
import { workspaceFor } from "./local-runner";
import { STATE_DIRECTORY } from "./product-paths";

export interface RepositoryIntelligence {
  workspaceId: string;
  generatedAt: number;
  root: string;
  files: number;
  directories: number;
  languages: Record<string, number>;
  frameworks: string[];
  entrypoints: string[];
  manifests: string[];
  validationCommands: string[];
  importantDocs: string[];
  structure: string[];
  fingerprint: string;
}

const IGNORE = new Set(["node_modules", ".git", ".next", "dist", "build", "coverage", ".cache", ".turbo", ".hyzr", ".vmx"]);
const EXTENSIONS: Record<string, string> = {
  ".ts": "TypeScript", ".tsx": "TypeScript", ".js": "JavaScript", ".jsx": "JavaScript",
  ".py": "Python", ".go": "Go", ".rs": "Rust", ".java": "Java", ".cs": "C#",
  ".html": "HTML", ".css": "CSS", ".scss": "SCSS", ".sql": "SQL", ".md": "Markdown",
};
const ENTRY_NAMES = /^(?:index|main|app|server|page|route|cli)\.(?:tsx?|jsx?|py|go|rs|html)$/i;
const DOC_NAMES = /^(?:readme|agents|architecture|contributing|design|product|security|reliability)(?:\.[^.]+)?$/i;

async function safeJson(file: string) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); } catch { return null; }
}

function compactTree(paths: string[]) {
  return paths.sort().slice(0, 180);
}

export async function buildRepositoryIntelligence(workspaceId?: string): Promise<RepositoryIntelligence> {
  const id = (workspaceId || "legacy").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "legacy";
  const root = workspaceFor(id);
  await fs.mkdir(root, { recursive: true });
  const languages: Record<string, number> = {};
  const structure: string[] = [];
  const entrypoints: string[] = [];
  const manifests: string[] = [];
  const importantDocs: string[] = [];
  let directories = 0;
  let files = 0;
  let newest = 0;

  async function walk(directory: string, depth: number) {
    if (depth > 6 || files > 2500) return;
    let entries: import("fs").Dirent[] = [];
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        directories++;
        if (depth < 3) structure.push(`${relative}/`);
        await walk(absolute, depth + 1);
      } else if (entry.isFile()) {
        files++;
        structure.push(relative);
        const language = EXTENSIONS[path.extname(entry.name).toLowerCase()];
        if (language) languages[language] = (languages[language] || 0) + 1;
        if (ENTRY_NAMES.test(entry.name) && entrypoints.length < 30) entrypoints.push(relative);
        if (/^(?:package\.json|pyproject\.toml|requirements\.txt|cargo\.toml|go\.mod|pom\.xml|dockerfile|compose\.ya?ml)$/i.test(entry.name)) manifests.push(relative);
        if (DOC_NAMES.test(entry.name) && importantDocs.length < 30) importantDocs.push(relative);
        try { newest = Math.max(newest, (await fs.stat(absolute)).mtimeMs); } catch {}
      }
    }
  }
  await walk(root, 0);

  const frameworks = new Set<string>();
  const validationCommands: string[] = [];
  const pkg = await safeJson(path.join(root, "package.json"));
  if (pkg) {
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (deps.next) frameworks.add("Next.js");
    if (deps.react) frameworks.add("React");
    if (deps.vue) frameworks.add("Vue");
    if (deps.svelte) frameworks.add("Svelte");
    if (deps.express) frameworks.add("Express");
    for (const name of ["test", "lint", "typecheck", "build"]) if (pkg.scripts?.[name]) validationCommands.push(`npm run ${name}`);
  }
  if (manifests.some((file) => /pyproject\.toml|requirements\.txt/i.test(file))) frameworks.add("Python");
  if (manifests.some((file) => /cargo\.toml/i.test(file))) frameworks.add("Rust");
  if (manifests.some((file) => /go\.mod/i.test(file))) frameworks.add("Go");
  const fingerprint = `${files}:${directories}:${Math.floor(newest)}:${Object.entries(languages).sort().join(",")}`;
  const intelligence: RepositoryIntelligence = {
    workspaceId: id,
    generatedAt: Date.now(),
    root,
    files,
    directories,
    languages,
    frameworks: [...frameworks],
    entrypoints,
    manifests,
    validationCommands,
    importantDocs,
    structure: compactTree(structure),
    fingerprint,
  };
  const directory = path.join(STATE_DIRECTORY, "repositories");
  await fs.mkdir(directory, { recursive: true });
  const target = path.join(directory, `${id}.json`);
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(intelligence, null, 2), "utf8");
  await fs.rename(temporary, target);
  return intelligence;
}

export function repositoryContext(map: RepositoryIntelligence) {
  if (!map.files) return "REPOSITORY MAP\nThe workspace is currently empty. Create only the files required by the delivery contract.";
  const languageSummary = Object.entries(map.languages).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => `${name} ${count}`).join(", ");
  return [
    "REPOSITORY MAP (generated, compact, and authoritative for navigation)",
    `Scale: ${map.files} files / ${map.directories} directories. Languages: ${languageSummary || "unknown"}.`,
    `Frameworks: ${map.frameworks.join(", ") || "not detected"}.`,
    `Manifests: ${map.manifests.join(", ") || "none"}.`,
    `Likely entrypoints: ${map.entrypoints.slice(0, 12).join(", ") || "none"}.`,
    `Important docs: ${map.importantDocs.slice(0, 10).join(", ") || "none"}.`,
    `Validation commands: ${map.validationCommands.join("; ") || "infer the narrowest relevant command"}.`,
    "Open only the files relevant to the assigned subtask; do not scan the entire repository unless the contract requires it.",
  ].join("\n");
}

const TASK_STOP_WORDS = new Set("the and for with from into this that app application project build create make update change implement task work user existing current".split(" "));

function taskTerms(task: string) {
  return Array.from(new Set((task.toLowerCase().match(/[a-z0-9][a-z0-9_-]{2,}/g) || [])
    .filter((term) => !TASK_STOP_WORDS.has(term))));
}

/** A deterministic navigation packet: filenames only, never arbitrary source. */
export function repositoryTaskContext(map: RepositoryIntelligence, task: string) {
  if (!map.files) return repositoryContext(map);
  const terms = taskTerms(task);
  const preferredExtensions = /(?:style|ui|frontend|mobile|responsive|design|animation)/i.test(task)
    ? new Set([".css", ".scss", ".tsx", ".jsx", ".html"])
    : /(?:api|server|backend|database|auth)/i.test(task)
      ? new Set([".ts", ".js", ".py", ".go", ".rs", ".sql"])
      : new Set<string>();
  const anchors = new Set([...map.entrypoints, ...map.manifests, ...map.importantDocs]);
  const relevant = map.structure
    .filter((file) => !file.endsWith("/"))
    .map((file) => {
      const lower = file.toLowerCase();
      let score = anchors.has(file) ? 2 : 0;
      for (const term of terms) if (lower.includes(term)) score += 5;
      if (preferredExtensions.has(path.extname(file).toLowerCase())) score += 1;
      return { file, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.file.length - b.file.length)
    .slice(0, 12)
    .map((candidate) => candidate.file);
  return [
    "TASK-AWARE REPOSITORY NAVIGATION",
    `Assignment: ${task.slice(0, 240)}`,
    `Likely relevant paths: ${relevant.join(", ") || map.entrypoints.slice(0, 6).join(", ") || "none identified"}.`,
    `Validation: ${map.validationCommands.slice(0, 3).join("; ") || "use the narrowest relevant check"}.`,
    "Start with these paths and expand only when evidence requires it; do not inventory the repository again.",
  ].join("\n");
}

export async function readRepositoryIntelligence(workspaceId: string) {
  const safe = workspaceId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "legacy";
  try {
    return JSON.parse(await fs.readFile(path.join(STATE_DIRECTORY, "repositories", `${safe}.json`), "utf8")) as RepositoryIntelligence;
  } catch {
    return buildRepositoryIntelligence(safe);
  }
}
