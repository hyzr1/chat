// Relay store for the hosted Pair bridge.
//
// On Vercel there is no persistent disk and functions are stateless, so the
// pairing handshake and job queue live in Upstash Redis (reached over its HTTPS
// REST API — no long-lived socket, which is exactly what serverless needs).
//
// For local development, or any deploy without Upstash configured, this falls
// back to an in-process Map so the whole flow is testable on one machine. The
// fallback is single-instance only; production must set the Upstash env vars.

const URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
export const relayBackedByRedis = Boolean(URL && TOKEN);

type Entry = { value: string; expiresAt: number };
type ListEntry = { items: string[]; expiresAt: number };

// Module-level maps survive across requests within a single Node process.
const g = globalThis as unknown as { __hyzrKV?: Map<string, Entry>; __hyzrLists?: Map<string, ListEntry> };
const kv = (g.__hyzrKV ??= new Map());
const lists = (g.__hyzrLists ??= new Map());

const now = () => Date.now();
function alive(expiresAt: number) { return expiresAt === 0 || expiresAt > now(); }

async function redis(command: (string | number)[]): Promise<any> {
  const res = await fetch(URL as string, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const json = await res.json();
  return json.result;
}

export async function kvSet(key: string, value: unknown, ttlSeconds = 0): Promise<void> {
  const payload = JSON.stringify(value);
  if (relayBackedByRedis) {
    await redis(ttlSeconds ? ["SET", key, payload, "EX", ttlSeconds] : ["SET", key, payload]);
    return;
  }
  kv.set(key, { value: payload, expiresAt: ttlSeconds ? now() + ttlSeconds * 1000 : 0 });
}

export async function kvGet<T = unknown>(key: string): Promise<T | null> {
  if (relayBackedByRedis) {
    const raw = await redis(["GET", key]);
    return raw == null ? null : (JSON.parse(raw as string) as T);
  }
  const entry = kv.get(key);
  if (!entry) return null;
  if (!alive(entry.expiresAt)) { kv.delete(key); return null; }
  return JSON.parse(entry.value) as T;
}

export async function kvDel(key: string): Promise<void> {
  if (relayBackedByRedis) { await redis(["DEL", key]); return; }
  kv.delete(key);
}

// Push a job onto a per-agent queue with a bounded TTL.
export async function queuePush(key: string, value: unknown, ttlSeconds = 3600): Promise<void> {
  const payload = JSON.stringify(value);
  if (relayBackedByRedis) {
    await redis(["RPUSH", key, payload]);
    await redis(["EXPIRE", key, ttlSeconds]);
    return;
  }
  const list = lists.get(key) ?? { items: [], expiresAt: 0 };
  list.items.push(payload);
  list.expiresAt = now() + ttlSeconds * 1000;
  lists.set(key, list);
}

// Pop the oldest job (FIFO). Returns null when empty.
export async function queuePop<T = unknown>(key: string): Promise<T | null> {
  if (relayBackedByRedis) {
    const raw = await redis(["LPOP", key]);
    return raw == null ? null : (JSON.parse(raw as string) as T);
  }
  const list = lists.get(key);
  if (!list || !alive(list.expiresAt) || list.items.length === 0) return null;
  const raw = list.items.shift() as string;
  return JSON.parse(raw) as T;
}

// Read the whole queue without consuming (for a UI to poll results).
export async function queueRange<T = unknown>(key: string): Promise<T[]> {
  if (relayBackedByRedis) {
    const raw = (await redis(["LRANGE", key, 0, -1])) as string[] | null;
    return (raw ?? []).map((r: string) => JSON.parse(r) as T);
  }
  const list = lists.get(key);
  if (!list || !alive(list.expiresAt)) return [];
  return list.items.map((r: string) => JSON.parse(r) as T);
}

export function newCode(length = 6) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] & 31];
  return out;
}

export function newToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
