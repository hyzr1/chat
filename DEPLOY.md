# Deploying Hyzr Chat on Vercel

Hyzr has two execution boundaries:

- Local development runs the Next.js server and the coding CLIs on the same
  trusted computer.
- Vercel hosts identity, synchronized chat state, orchestration, and the web UI.
  The installable Hyzr Agent creates an outbound authenticated connection from
  the user's computer for CLI, Git, filesystem, and preview work.

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

## Pairing a computer

On the hosted site, a signed-in user opens **Download → Pair your environment**
and receives a one-use six-character code:

1. Download the Windows, macOS, or Linux installer.
2. Open Hyzr Agent and enter the pairing code.
3. Choose the projects directory.
4. Confirm **Full developer access** (the installer default) for normal local
   commands, Git metadata, and filesystem context. Users who prefer a stricter
   boundary can select **Projects folder only**; Codex's workspace-write sandbox
   intentionally protects `.git` metadata in that mode.

The agent starts on login, reconnects after sleep or network changes, and
detects Claude Code, Codex, Git, GitHub CLI, and npm independently. It stores
native Claude/Codex session IDs per web conversation and pins every conversation
to one stable workspace directory.

The old downloadable `hyzr-agent.mjs` protocol is retired and rejected. It
created a fresh folder on every turn, could not provide native conversation
continuity, and had no usable approval surface.

## Building installers

Installer source lives in `agent/`.

```powershell
cd agent
npm ci
npm test
npm run build -- --win
```

Tagging `agent-v*` runs `.github/workflows/agent-release.yml` and attaches the
Windows `.exe`, macOS `.dmg`, Linux `.AppImage`, and Debian package to a GitHub
release. The website installer buttons link to the latest release.

For public distribution, configure code-signing secrets before tagging:

- Windows Authenticode: `CSC_LINK`, `CSC_KEY_PASSWORD`
- Apple Developer ID and notarization credentials supported by electron-builder

Unsigned development installers work but can trigger operating-system warnings.

## Hosted local-tool protocol

The v2 bridge supports two job classes:

- `run`: a durable conversation turn with stable conversation/workspace IDs,
  bounded history fallback, model hint, effort, and native CLI session resume.
- `rpc`: an allowlisted operation for environment status, GitHub CLI, project
  file viewing, and proxied local previews.

There is deliberately no arbitrary remote-shell RPC method. Coding commands run
only inside Claude Code or Codex under the permission mode the user selected.
Result reads are account/device scoped and job ownership is verified.

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

`POST /api/preview-server` asks the paired agent to start the project's `dev` or
`start` script locally. Browser requests under `/preview/_dev/<conversation>/`
are relayed to the local loopback server over the existing outbound bridge.
This requires no inbound port, router change, or public development server.

The proxy currently supports HTTP assets and page refreshes. WebSocket HMR is
not tunneled; the user refreshes the preview after a change.
