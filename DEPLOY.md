# Deploying Hyzr Chat on Vercel

Hyzr has two execution boundaries:

- Local development runs the Next.js server and coding CLIs on one trusted computer.
- Vercel hosts identity, synchronized chat state, orchestration, and the web UI.
  The tiny Hyzr terminal launcher creates an outbound authenticated connection
  from the user's computer for CLI, Git, filesystem, and preview work.

Vercel never executes a command against the user's filesystem.

## Required Vercel services

Create an Upstash Redis database and configure:

```text
UPSTASH_REDIS_REST_URL=https://<database>.upstash.io
UPSTASH_REDIS_REST_TOKEN=<secret>
HYZR_CHAT_ENCRYPTION_KEY=<32 random bytes encoded as base64>
```

Upstash stores account sessions, one-time pairing codes, device presence,
synchronized conversations, queued work, local RPC requests, and result events.
The in-memory fallback is only for a single local development process.

Do not expose a hosted deployment without persistent Redis. Vercel functions
are stateless and their writable filesystem is temporary.

## Connecting a computer

On the hosted site, a signed-in user opens **Connect your computer** and receives
a one-use six-character code:

1. Download `hyzr.cmd` on Windows or `hyzr` on macOS/Linux.
2. Open it and enter the code.
3. Leave the terminal open while using the web app.

The launcher is under 1 KB. It downloads the current relay runtime (roughly tens
of kilobytes) into `~/.hyzr/agent`, creates `~/Hyzr`, and reconnects with its
saved pairing on later launches. No Electron app, installer, shortcut, protocol
handler, or background tray process is involved.

The relay detects Claude Code, Codex, Git, GitHub CLI, and npm independently. It
stores native Claude/Codex session IDs per web conversation and pins every
conversation to one stable workspace directory.

## Building the terminal downloads

```powershell
cd agent
npm ci
npm test
npm run build
```

`scripts/build-agent-cli.mjs` creates:

- `public/downloads/hyzr.cmd`
- `public/downloads/hyzr`
- `public/downloads/hyzr-agent.mjs`

Tagging `agent-v*` runs `.github/workflows/agent-release.yml`, tests the relay,
and attaches the same three lightweight files to a GitHub release.

## Hosted local-tool protocol

The v2 bridge supports two job classes:

- `run`: a durable conversation turn with stable conversation/workspace IDs,
  bounded history fallback, model hint, effort, and native CLI session resume.
- `rpc`: an allowlisted operation for environment status, GitHub CLI, project
  file viewing, and proxied local previews.

There is deliberately no arbitrary remote-shell RPC method. Coding commands run
inside Claude Code or Codex. Result reads are account/device scoped and job
ownership is verified.

Main relay endpoints:

```text
POST /api/agent/code
POST /api/agent/pair
GET  /api/agent/status
POST /api/agent/enqueue
GET  /api/agent/poll
POST /api/agent/result
GET  /api/agent/events
```

The agent token is sent as a bearer credential when polling; it is never placed
in a browser URL.

## Local previews through Vercel

`POST /api/preview-server` asks the paired relay to start the project's `dev` or
`start` script locally. Browser requests under `/preview/_dev/<conversation>/`
are relayed to the local loopback server over the existing outbound bridge.
This requires no inbound port, router change, or public development server.

The proxy supports HTTP assets and page refreshes. WebSocket HMR is not
tunneled; the user refreshes the preview after a change.
