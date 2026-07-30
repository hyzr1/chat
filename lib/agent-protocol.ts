export const AGENT_PROTOCOL_VERSION = 2;

export type AgentEngine = "claude" | "codex";
export type AgentPermissionMode = "workspace" | "full-access";

export interface AgentCapabilities {
  protocol: number;
  host: string;
  platform: string;
  arch?: string;
  version?: string;
  node: string;
  claude: boolean;
  codex: boolean;
  git: boolean;
  gh: boolean;
  engine: "" | "claude" | "codex" | "claude+codex";
  workspaceRoot?: string;
  permissionMode?: AgentPermissionMode;
}

export interface AgentRunJob {
  kind: "run";
  id: string;
  runId: string;
  conversationId: string;
  workspaceId: string;
  projectId?: string;
  prompt: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  model?: string | null;
  effort?: string;
  plan?: boolean;
  enqueuedAt: number;
}

export type AgentRpcMethod =
  | "system.status"
  | "github.status"
  | "github.repos"
  | "github.tree"
  | "github.file"
  | "github.issues"
  | "github.issue"
  | "workspace.list"
  | "workspace.read"
  | "workspace.asset"
  | "preview.start"
  | "preview.http";

export interface AgentRpcJob {
  kind: "rpc";
  id: string;
  method: AgentRpcMethod;
  params: Record<string, unknown>;
  enqueuedAt: number;
}

export type AgentJob = AgentRunJob | AgentRpcJob;

export interface AgentResultEvent {
  type: "status" | "text" | "tool" | "usage" | "result" | "done" | "error";
  text?: string;
  data?: unknown;
  at: number;
}

export function isHostedRuntime() {
  return (
    process.env.VERCEL === "1" ||
    process.env.HYZR_HOSTED === "1" ||
    process.env.AWS_LAMBDA_FUNCTION_NAME != null ||
    process.env.NEXT_RUNTIME === "edge"
  );
}

export function cleanWorkspaceId(value: unknown) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
}
