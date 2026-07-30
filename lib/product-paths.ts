import { existsSync } from "fs";
import os from "os";
import path from "path";

// On Vercel (and any serverless host) the home directory is read-only and only
// /tmp is writable — and ephemeral. The durable SQLite store is a local-first
// feature that has no role in a hosted deploy (hosted execution runs on paired
// user machines), so we point it at a scratch dir there just to avoid crashing
// the session/task routes. Real hosted persistence lives in Upstash.
const hosted = process.env.VERCEL === "1" || process.env.HYZR_HOSTED === "1";
const home = hosted ? path.join(os.tmpdir(), "hyzr-home") : os.homedir();
export const HYZR_CHAT_STATE_DIRECTORY = path.join(/*turbopackIgnore: true*/ home, ".hyzr", "chat");
export const LEGACY_STATE_DIRECTORY = path.join(/*turbopackIgnore: true*/ home, ".vmx");
export const HYZR_CHAT_WORKSPACE_ROOT = path.join(/*turbopackIgnore: true*/ home, "hyzr-chat-workspaces");
export const LEGACY_WORKSPACE_ROOT = path.join(/*turbopackIgnore: true*/ home, "vmx-workspaces");

/**
 * Existing VMX installations keep using their original directory so encrypted
 * jobs, integration tokens, and project history remain available. Fresh
 * installs use the Hyzr Chat namespace.
 */
export const STATE_DIRECTORY = existsSync(LEGACY_STATE_DIRECTORY)
  ? LEGACY_STATE_DIRECTORY
  : HYZR_CHAT_STATE_DIRECTORY;

export const STATE_DATABASE = path.join(/*turbopackIgnore: true*/
  STATE_DIRECTORY,
  STATE_DIRECTORY === LEGACY_STATE_DIRECTORY ? "vmx.sqlite" : "chat.sqlite",
);

export const WORKSPACE_DIRECTORY = existsSync(LEGACY_WORKSPACE_ROOT)
  ? LEGACY_WORKSPACE_ROOT
  : HYZR_CHAT_WORKSPACE_ROOT;
