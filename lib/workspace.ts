import path from "path";
import { WORKSPACE_DIRECTORY } from "./product-paths";

export const WORKSPACE_ROOT = WORKSPACE_DIRECTORY;

export function workspaceFor(id?: string) {
  const safe = (id || "legacy").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "legacy";
  return path.join(/*turbopackIgnore: true*/ WORKSPACE_ROOT, safe);
}
