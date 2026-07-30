import { createHash } from "crypto";
import type { AgentCapabilities } from "./agent-protocol";

export const DEVICE_PAIR_TTL_SECONDS = 15 * 60;
export const DEVICE_POLL_INTERVAL_SECONDS = 3;

export interface DevicePairing {
  status: "pending" | "approved";
  createdAt: number;
  expiresAt: number;
  agent: AgentCapabilities;
  accountId?: string;
  token?: string;
  approvedAt?: number;
}

export function normalizeDeviceCode(value: unknown) {
  const raw = String(value || "").trim().toUpperCase().replace(/[^A-Z2-9]/g, "");
  return raw.length === 8 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : "";
}

export function deviceSecretFingerprint(secret: string) {
  return createHash("sha256").update(secret).digest("hex");
}
