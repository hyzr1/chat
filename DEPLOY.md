# Deploying Hyzr Chat on Vercel

The app runs in two situations, and behaves correctly in both:

- **Local (your own machine):** the server IS your PC, so Agent runs directly
  on your local Claude/Codex CLIs. Nothing extra needed.
- **Hosted (Vercel):** the server is remote, so it can't touch a user's files.
  Users **pair** by running the small local agent, which bridges their machine
  to the hosted app through Upstash Redis.

## 1. Provision Upstash Redis (required for hosted)

Vercel functions are stateless with no disk, so the pairing handshake and job
queue live in Upstash Redis (reached over HTTPS — serverless-friendly).

1. Create a free database at https://upstash.com (Redis).
2. Copy its **REST URL** and **REST token**.
3. In your Vercel project → Settings → Environment Variables, add:

   ```
   UPSTASH_REDIS_REST_URL   = https://<your-db>.upstash.io
   UPSTASH_REDIS_REST_TOKEN = <your-token>
   ```

`VERCEL` is set automatically, which flips the app into hosted mode
(`/api/setup` reports `hosted: true` and the Pair sheet shows the agent flow).
Without the Upstash vars the relay falls back to in-memory (single instance,
dev only).

Optional: set `HYZR_CHAT_ACCESS_TOKEN` only for a private/self-hosted instance.

## 2. How a user connects their environment

On the hosted site, a signed-in user opens **Download → Pair your environment**
and gets a 6-character code. On their PC they run:

```bash
npx @hyzr/agent --url=https://chat.hyzr.ai --code=ABC123
# or, from a checkout:
node agent/index.mjs --url=https://chat.hyzr.ai --code=ABC123
```

The agent detects their Claude/Codex, pairs, and long-polls for tasks. Agent
tasks from the hosted site then run on **their** machine and stream back.

## 3. What still uses which path

| Mode  | Hosted on Vercel | Needs |
| ----- | ---------------- | ----- |
| Chat (guest) | ✅ | a free model wired to `/api/chat` (TODO) |
| API (BYOK)   | ✅ | user's API keys |
| Agent (Pair) | ✅ | user runs the local agent (this relay) |

## Relay endpoints (reference)

`POST /api/agent/code` · `POST /api/agent/pair` · `GET /api/agent/status`
`POST /api/agent/enqueue` · `GET /api/agent/poll` · `POST /api/agent/result`
`GET /api/agent/events`
