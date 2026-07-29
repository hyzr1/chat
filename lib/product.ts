export const PRODUCT = {
  family: "Hyzr",
  name: "Hyzr Chat",
  shortName: "Chat",
  slug: "chat",
  repository: "hyzr1/chat",
  domain: "chat.hyzr.ai",
  version: "0.9.0",
} as const;

/** Read a Hyzr Chat setting while accepting the former VMX name during migration. */
export function productEnv(name: string, legacyName?: string) {
  return process.env[name]?.trim() || (legacyName ? process.env[legacyName]?.trim() : undefined);
}
