import type { AgentCapabilities } from "./agent-protocol";
import { kvGet, kvSet } from "./relay-store";

export const AGENT_RECORD_TTL_SECONDS = 60 * 60 * 24 * 90;

export interface AgentRecord {
  token: string;
  accountId?: string;
  agent: AgentCapabilities;
  pairedAt: number;
  lastSeen: number;
  linkCheckedAt?: number;
}

export function sanitizeAgentCapabilities(agent: any): AgentCapabilities {
  const claude = Boolean(agent?.claude);
  const codex = Boolean(agent?.codex);
  const requestedEngine = String(agent?.engine || "");
  return {
    protocol: Math.max(1, Number(agent?.protocol) || 1),
    host: String(agent?.host || "your machine").slice(0, 120),
    platform: String(agent?.platform || "").slice(0, 40),
    arch: String(agent?.arch || "").slice(0, 40),
    version: String(agent?.version || "").slice(0, 40),
    claude,
    codex,
    git: Boolean(agent?.git),
    gh: Boolean(agent?.gh),
    node: String(agent?.node || "").slice(0, 40),
    workspaceRoot: String(agent?.workspaceRoot || "").slice(0, 500),
    permissionMode: agent?.permissionMode === "full-access" ? "full-access" : "workspace",
    engine: ["claude", "codex", "claude+codex"].includes(requestedEngine)
      ? requestedEngine as AgentCapabilities["engine"]
      : claude && codex ? "claude+codex" : claude ? "claude" : codex ? "codex" : "",
  };
}

export async function registerAgent(token: string, accountId: string | undefined, agent: unknown) {
  const now = Date.now();
  const record: AgentRecord = {
    token,
    accountId,
    agent: sanitizeAgentCapabilities(agent),
    pairedAt: now,
    lastSeen: now,
    linkCheckedAt: now,
  };
  await kvSet(`agent:${token}`, record, AGENT_RECORD_TTL_SECONDS);
  if (accountId) await kvSet(`account-agent:${accountId}`, token, AGENT_RECORD_TTL_SECONDS);
  return record;
}

export async function getAgentRecord(token: string) {
  return await kvGet<AgentRecord>(`agent:${token}`);
}

// Every authenticated request repairs both sides of the pairing. This makes a
// Redis eviction, stale browser cookie, or interrupted deployment recover on
// the next heartbeat without asking the user to pair again.
export async function touchAgent(token: string, existing?: AgentRecord | null) {
  const record = existing ?? await getAgentRecord(token);
  if (!record) return null;
  const now = Date.now();
  const shouldCheckLink = Boolean(record.accountId) && now - Number(record.linkCheckedAt || 0) >= 30_000;
  const touched = { ...record, lastSeen: now, linkCheckedAt: shouldCheckLink ? now : record.linkCheckedAt };
  await kvSet(`agent:${token}`, touched, AGENT_RECORD_TTL_SECONDS);
  if (record.accountId && shouldCheckLink) {
    const accountToken = await kvGet<string>(`account-agent:${record.accountId}`);
    // Repair a missing link, but never let an older launcher steal the account
    // back after the user has approved a newer computer.
    if (!accountToken || accountToken === token) {
      await kvSet(`account-agent:${record.accountId}`, token, AGENT_RECORD_TTL_SECONDS);
    }
  }
  return touched;
}
