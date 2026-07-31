import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "agent", "src", "core.mjs");
const downloads = path.join(root, "public", "downloads");
const coreRaw = await readFile(source, "utf8");

// The runtime ships as a SINGLE downloaded file, so the agent's local ESM
// imports (./routing.mjs) must be inlined. Wrap routing in a namespaced IIFE so
// its top-level names can't collide with core.mjs, and rewrite core's import to
// destructure from that namespace. routing.mjs is self-contained (no imports).
const routing = await readFile(path.join(root, "agent", "src", "routing.mjs"), "utf8");
const routingInlined = `const __hyzrRouting = (() => {\n${routing.replace(/^export\s+/gm, "")}\nreturn { planForAgent, routerModelFor, buildRouterPrompt, parseRouterPlan, availableModelIds, chatModelFor };\n})();\n`;
const core = coreRaw.replace(
  /import\s*\{[^}]*\}\s*from\s*["']\.\/routing\.mjs["'];?/,
  "const { planForAgent, routerModelFor, buildRouterPrompt, parseRouterPlan, chatModelFor } = __hyzrRouting;",
);
const launcher = `

runAgentCli().catch((error) => {
  console.error("\\n  Hyzr stopped —", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
`;

await mkdir(downloads, { recursive: true });
// routingInlined MUST come first so __hyzrRouting is defined before core's
// destructure. ESM hoists core's node: imports regardless of position.
const runtime = `${routingInlined}${core.trimEnd()}${launcher}`;
const runtimeHash = createHash("sha256").update(runtime).digest("hex");
const version = core.match(/const VERSION = "([^"]+)"/)?.[1] || "unknown";
await writeFile(path.join(downloads, "hyzr-agent.mjs"), runtime, "utf8");
await writeFile(path.join(downloads, "hyzr-agent.sha256"), `${runtimeHash}  hyzr-agent.mjs\n`, "utf8");
await writeFile(path.join(downloads, "hyzr-agent.json"), JSON.stringify({
  version,
  sha256: runtimeHash,
  minimumNode: 18,
  publishedAt: new Date().toISOString(),
}, null, 2), "utf8");
await copyFile(path.join(root, "agent", "bin", "hyzr.cmd"), path.join(downloads, "hyzr.cmd"));
await copyFile(path.join(root, "agent", "bin", "hyzr"), path.join(downloads, "hyzr"));
await chmod(path.join(downloads, "hyzr"), 0o755);

console.log("Built lightweight Hyzr terminal downloads.");
