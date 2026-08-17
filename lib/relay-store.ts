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

// Several commands over one HTTPS round trip. Each request to Upstash costs a
// TLS handshake and a JSON encode/decode on our side, and that overhead — not
// Redis itself — is what shows up as active CPU. Anywhere we previously issued
// two or three sequential commands, this collapses them into one trip.
async function pipeline(commands: (string | number)[][]): Promise<any[]> {
  if (commands.length === 0) return [];
  if (commands.length === 1) return [await redis(commands[0])];
  const res = await fetch(`${URL}/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  const json = (await res.json()) as { result?: unknown; error?: string }[];
  return json.map((entry) => {
    if (entry?.error) throw new Error(`Upstash pipeline: ${entry.error}`);
    return entry?.result;
  });
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
  return queuePushMany(key, [value], ttlSeconds);
}

// Append many values at once. RPUSH is variadic, so a batch of streamed events
// costs a single command instead of one per event, and the TTL refresh rides
// along in the same pipeline. This is the difference between ~2 round trips per
// token and ~2 per flush.
export async function queuePushMany(key: string, values: unknown[], ttlSeconds = 3600): Promise<void> {
  if (values.length === 0) return;
  const payloads = values.map((v) => JSON.stringify(v));
  if (relayBackedByRedis) {
    await pipeline([
      ["RPUSH", key, ...payloads],
      ["EXPIRE", key, ttlSeconds],
    ]);
    return;
  }
  const list = lists.get(key) ?? { items: [], expiresAt: 0 };
  list.items.push(...payloads);
  list.expiresAt = now() + ttlSeconds * 1000;
  lists.set(key, list);
}

// Read several keys in one trip. Used by the result route, which needs both the
// agent record and the job's owner before it can accept a batch.
export async function kvGetMany<T = unknown>(keys: string[]): Promise<(T | null)[]> {
  if (keys.length === 0) return [];
  if (relayBackedByRedis) {
    const raw = await pipeline(keys.map((k) => ["GET", k]));
    return raw.map((r) => (r == null ? null : (JSON.parse(r as string) as T)));
  }
  return keys.map((k) => {
    const entry = kv.get(k);
    if (!entry || !alive(entry.expiresAt)) return null;
    return JSON.parse(entry.value) as T;
  });
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

// Blocking pop. Redis parks the connection server-side and answers the instant
// a job lands, so one HTTPS round trip covers the whole wait window. The old
// approach — LPOP on a 700 ms timer — spent ~11 round trips per long-poll and
// billed every one of them as active CPU, which is what pinned this project at
// the top of the usage report. Blocking here is idle wait, not compute.
export async function queuePopBlocking<T = unknown>(key: string, timeoutSeconds: number): Promise<T | null> {
  if (relayBackedByRedis) {
    // BLPOP answers [key, value] on success and null when the timeout expires.
    const raw = (await redis(["BLPOP", key, timeoutSeconds])) as [string, string] | null;
    if (!raw) return null;
    return JSON.parse(raw[1]) as T;
  }
  // In-process fallback keeps the local dev path working without Upstash.
  const deadline = now() + timeoutSeconds * 1000;
  for (;;) {
    const popped = await queuePop<T>(key);
    if (popped !== null) return popped;
    if (now() >= deadline) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
}

// Read the queue without consuming it (for a UI to poll results). `start` lets
// a caller fetch only what it has not seen; re-reading from 0 each time made a
// streaming response cost O(n^2) in transfer and JSON parsing as it grew.
export async function queueRange<T = unknown>(key: string, start = 0): Promise<T[]> {
  if (relayBackedByRedis) {
    const raw = (await redis(["LRANGE", key, start, -1])) as string[] | null;
    return (raw ?? []).map((r: string) => JSON.parse(r) as T);
  }
  const list = lists.get(key);
  if (!list || !alive(list.expiresAt)) return [];
  return list.items.slice(start).map((r: string) => JSON.parse(r) as T);
}

// Current queue length, so a poller can detect new entries without pulling them.
export async function queueLength(key: string): Promise<number> {
  if (relayBackedByRedis) {
    return Number((await redis(["LLEN", key])) ?? 0);
  }
  const list = lists.get(key);
  if (!list || !alive(list.expiresAt)) return 0;
  return list.items.length;
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
