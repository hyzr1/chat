import { promises as fs } from "fs";
import path from "path";
import { workspaceFor } from "./workspace";

export type NativeExecutionResult = {
  handled: boolean;
  success: boolean;
  kind?: "static-hello" | "preview-readiness";
  title?: string;
  summary?: string;
  evidence?: string[];
  changedFiles?: string[];
};

const HELLO_WORLD = /\b(?:create|make|build)\b[\s\S]{0,80}\b(?:bare|basic|simple)?\s*hello[\s_-]*world\b[\s\S]{0,80}\bindex\.html\b/i;
const NO_SCRIPT_OR_STYLE = /\b(?:no|without|zero)\s+(?:styling|styles?|css)\b/i;
const NO_JAVASCRIPT = /\b(?:no|without|zero)\s+(?:javascript|js)\b/i;
const SERVER_OPERATION = /\b(?:start|stop|restart|reopen|verify|check)\b[\s\S]{0,64}\b(?:server|dev server|port|process|localhost)\b/i;

async function firstPreviewEntry(root: string) {
  for (const relative of ["dist/index.html", "build/index.html", "out/index.html", "index.html"]) {
    try {
      await fs.access(path.join(root, relative));
      return relative.replace(/\\/g, "/");
    } catch {}
  }
  return undefined;
}

/**
 * Executes a deliberately tiny allow-list of mechanical tasks without paying
 * an agent to rediscover deterministic steps. Ambiguous edits always fall
 * through to normal model routing.
 */
export async function tryNativeExecution(prompt: string, workspaceId: string): Promise<NativeExecutionResult> {
  const root = workspaceFor(workspaceId);
  await fs.mkdir(root, { recursive: true });

  if (prompt.length <= 500 && HELLO_WORLD.test(prompt) && NO_SCRIPT_OR_STYLE.test(prompt) && NO_JAVASCRIPT.test(prompt)) {
    const html = "<!doctype html>\n<html lang=\"en\">\n<head>\n  <meta charset=\"utf-8\">\n  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n  <title>Hello world</title>\n</head>\n<body>\n  <h1>Hello world</h1>\n</body>\n</html>\n";
    await fs.writeFile(path.join(root, "index.html"), html, "utf8");
    return {
      handled: true,
      success: true,
      kind: "static-hello",
      title: "Create a bare Hello World page",
      summary: "Created a complete dependency-free index.html using Hyzr Chat's deterministic fast path.",
      evidence: ["index.html created", "No CSS, JavaScript, packages, or model call used"],
      changedFiles: ["index.html"],
    };
  }

  if (prompt.length <= 500 && SERVER_OPERATION.test(prompt)) {
    const entry = await firstPreviewEntry(root);
    if (!entry) {
      return {
        handled: true,
        success: false,
        kind: "preview-readiness",
        title: "Check project preview readiness",
        summary: "There is no built preview entry in this workspace, so there is no project server to restart yet.",
        evidence: ["Checked dist/, build/, out/, and the workspace root", "No model call used"],
        changedFiles: [],
      };
    }
    return {
      handled: true,
      success: true,
      kind: "preview-readiness",
      title: "Verify project preview readiness",
      summary: `Verified ${entry}. Hyzr Chat can serve it through the managed project preview without launching a coding model.`,
      evidence: [`Found ${entry}`, "Managed preview can bind it to the next available LAN-accessible port", "No model call used"],
      changedFiles: [],
    };
  }

  return { handled: false, success: false };
}
