import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "agent", "src", "core.mjs");
const downloads = path.join(root, "public", "downloads");
const core = await readFile(source, "utf8");
const launcher = `

runAgentCli().catch((error) => {
  console.error("\\n  Hyzr stopped —", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
`;

await mkdir(downloads, { recursive: true });
await writeFile(path.join(downloads, "hyzr-agent.mjs"), `${core.trimEnd()}${launcher}`, "utf8");
await copyFile(path.join(root, "agent", "bin", "hyzr.cmd"), path.join(downloads, "hyzr.cmd"));
await copyFile(path.join(root, "agent", "bin", "hyzr"), path.join(downloads, "hyzr"));
await chmod(path.join(downloads, "hyzr"), 0o755);

console.log("Built lightweight Hyzr terminal downloads.");
