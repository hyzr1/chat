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
and gets a 6-character code. They then, on their own machine:

1. **Download one file** — `hyzr-agent.mjs`, served from the site itself
   (`/hyzr-agent.mjs`). Only Node is required.
2. **Run it with the code** (the site shows the exact command):
   ```bash
   node hyzr-agent.mjs --url=https://chat.hyzr.ai --code=ABC123
   ```

The agent is self-contained: it detects the user's Claude and Codex, pairs, then
runs each task the site sends on the best-fit CLI in an isolated per-task
workspace, streaming output back. No separate app, no other install — identical
on every machine.

> Two levels of routing exist:
>
> - **Self-contained agent** (`hyzr-agent.mjs`, one file, Node only): routes each
>   task to Claude or Codex, using both across the workload. Simplest to run.
> - **Full-engine pairing** (run the Hyzr app locally, `POST /api/agent/connect`
>   with `{url, code}`): every hosted Agent task runs through this machine's real
>   planner + capability routing across *all* models (Fable 5 for design, Opus for
>   APIs, Sonnet for math, a small GPT for image-gen, …), with each subtask's
>   routing decision streamed back to the hosted UI. Each task lands in its own
>   isolated workspace folder on disk. This is the same pipeline the app runs
>   locally — no special-casing any machine.

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
