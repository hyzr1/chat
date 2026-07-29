import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { durableDatabase, getIntegrationToken, saveIntegrationToken } from "./durable-jobs";

const graphqlEndpoint = "https://api.linear.app/graphql";

export interface LinearDeliverySource {
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  accountId: string;
}

type LinearTokens = { accessToken: string; refreshToken?: string; expiresAt?: number };

export function linearOAuthConfigured() {
  return Boolean(process.env.LINEAR_CLIENT_ID && process.env.LINEAR_CLIENT_SECRET && process.env.LINEAR_REDIRECT_URI);
}

export function createLinearOAuthState() { return randomBytes(24).toString("base64url"); }

export function linearAuthorizeUrl(state: string) {
  const clientId = process.env.LINEAR_CLIENT_ID;
  const redirectUri = process.env.LINEAR_REDIRECT_URI;
  if (!clientId || !redirectUri) throw new Error("Linear OAuth is not configured.");
  const url = new URL("https://linear.app/oauth/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "read,write");
  url.searchParams.set("actor", "app");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeLinearCode(code: string) {
  const response = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: process.env.LINEAR_CLIENT_ID || "",
      client_secret: process.env.LINEAR_CLIENT_SECRET || "",
      redirect_uri: process.env.LINEAR_REDIRECT_URI || "",
    }),
  });
  const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !result.access_token) throw new Error(result.error || `Linear OAuth failed (${response.status}).`);
  const profile = await rawLinearGraphql<{ viewer: { id: string; name: string; organization: { id: string; name: string } } }>(result.access_token, "query VmxViewer { viewer { id name organization { id name } } }");
  const accountId = profile.viewer.organization.id;
  saveIntegrationToken("linear", accountId, {
    accessToken: result.access_token,
    refreshToken: result.refresh_token,
    expiresAt: result.expires_in ? Date.now() + result.expires_in * 1000 : undefined,
  } satisfies LinearTokens, { organization: profile.viewer.organization, viewer: { id: profile.viewer.id, name: profile.viewer.name } });
  return { accountId, ...profile.viewer };
}

async function refreshLinearToken(accountId: string, tokens: LinearTokens) {
  if (!tokens.refreshToken) return tokens;
  const response = await fetch("https://api.linear.app/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token", refresh_token: tokens.refreshToken,
      client_id: process.env.LINEAR_CLIENT_ID || "", client_secret: process.env.LINEAR_CLIENT_SECRET || "",
    }),
  });
  const result = await response.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !result.access_token) throw new Error(result.error || "Linear token refresh failed.");
  const next = { accessToken: result.access_token, refreshToken: result.refresh_token || tokens.refreshToken, expiresAt: result.expires_in ? Date.now() + result.expires_in * 1000 : undefined };
  saveIntegrationToken("linear", accountId, next, getIntegrationToken("linear", accountId)?.metadata || {});
  return next;
}

async function accountToken(accountId: string) {
  const stored = getIntegrationToken<LinearTokens>("linear", accountId);
  if (!stored) throw new Error(`No Linear OAuth connection exists for account ${accountId}.`);
  return stored.token.expiresAt && stored.token.expiresAt < Date.now() + 60_000
    ? (await refreshLinearToken(accountId, stored.token)).accessToken
    : stored.token.accessToken;
}

async function rawLinearGraphql<T>(token: string, query: string, variables: Record<string, unknown> = {}) {
  const response = await fetch(graphqlEndpoint, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const result = await response.json() as { data?: T; errors?: Array<{ message: string }> };
  if (!response.ok || result.errors?.length || !result.data) throw new Error(result.errors?.map((error) => error.message).join("; ") || `Linear GraphQL failed (${response.status}).`);
  return result.data;
}

export async function linearGraphql<T>(accountId: string, query: string, variables: Record<string, unknown> = {}) {
  return rawLinearGraphql<T>(await accountToken(accountId), query, variables);
}

export async function commentOnLinearIssue(source: LinearDeliverySource, body: string) {
  return linearGraphql(source.accountId, `mutation VmxComment($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id url } } }`, { input: { issueId: source.issueId, body } });
}

export async function synchronizeLinearDelivery(source: LinearDeliverySource, status: "started" | "verified" | "failed", detail: string) {
  const existing = durableDatabase().prepare("SELECT status FROM deliveries WHERE provider='linear' AND external_id=?").get(source.issueId) as { status: string } | undefined;
  if (existing?.status === status) return;
  await commentOnLinearIssue(source, `**Hyzr Chat delivery ${status}**\n\n${detail}`);
  const stateId = status === "verified" ? process.env.LINEAR_DONE_STATE_ID : status === "started" ? process.env.LINEAR_STARTED_STATE_ID : undefined;
  if (stateId) {
    await linearGraphql(source.accountId, `mutation VmxIssueState($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`, { id: source.issueId, input: { stateId } });
  }
  durableDatabase().prepare(`INSERT INTO deliveries(provider, external_id, run_id, status, metadata_json, updated_at)
    VALUES ('linear', ?, ?, ?, ?, ?) ON CONFLICT(provider, external_id) DO UPDATE SET status=excluded.status, metadata_json=excluded.metadata_json, updated_at=excluded.updated_at`)
    .run(source.issueId, source.issueIdentifier, status, JSON.stringify({ title: source.issueTitle, accountId: source.accountId }), Date.now());
}

export function verifyLinearWebhook(rawBody: string, signature: string | null) {
  const secret = process.env.LINEAR_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const supplied = signature.replace(/^sha256=/, "");
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function linearWebhookHash(rawBody: string) { return createHash("sha256").update(rawBody).digest("hex"); }
