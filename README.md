# Hyzr Chat

**A multi-model engineering workspace that turns one request into a planned, routed, and verified delivery.**

Hyzr Chat breaks broad work into specialist tasks, selects a model for each capability, gives every project an isolated filesystem, and keeps execution alive if the browser disconnects. It can use authenticated Claude and Codex command-line sessions locally or connect through Anthropic and OpenAI APIs.

This is more than a chat interface. Hyzr Chat owns the workflow around each model call: planning, routing, budgets, durable execution, project memory, repository operations, verification, and delivery evidence.

## Product family

Hyzr Chat is the conversational workspace in the Hyzr product family.

| Product | Purpose | Address |
| --- | --- | --- |
| Hyzr | Product home | `hyzr.ai` |
| Hyzr Chat | Multi-model building and orchestration | `chat.hyzr.ai` |
| Hyzr Code | Programming and interview learning | `code.hyzr.ai` |
| Hyzr Shop | Visual storefront building | `shop.hyzr.ai` |
| Hyzr Trade | Disclosure research and market comparison | `trade.hyzr.ai` |
| Hyzr GL | Typed browser graphics | `gl.hyzr.ai` |
| Hyzr UI | React component foundation | `ui.hyzr.ai` |

The former VMX repository remains a private historical archive. This repository starts with clean history and keeps compatibility only where it protects existing local data and configuration.

## What makes it different

- **Capability routing:** each task is matched using model fit, complexity, provider constraints, prior outcomes, and user preferences.
- **Task decomposition:** broad prompts become specialist assignments with explicit inputs, outputs, dependencies, and acceptance criteria.
- **Durable runs:** encrypted SQLite jobs, leases, checkpoints, and recovery keep work running across refreshes, sleeping phones, and process restarts.
- **Real workspaces:** every chat gets a persistent, isolated filesystem; repository deliveries use separate Git worktrees and branches.
- **Local or API execution:** use existing Claude and Codex CLI sessions, direct APIs, or a constrained provider combination.
- **Independent verification:** type checks, tests, dependency audits, credential scans, desktop/mobile browser checks, screenshots, and accessibility scans produce reviewable evidence.
- **Phone control:** pair a device on the local network to start work and inspect progress without exposing the development server publicly.
- **GitHub and Linear delivery:** turn labeled issues into durable runs, pull requests, checks, comments, and post-merge regression verification.

## From request to delivery

```text
request
  → plan and acceptance criteria
  → specialist task graph
  → capability-aware model routing
  → isolated workspace execution
  → independent verification
  → evidence, files, and optional pull request
```

Every routing decision is inspectable. Hyzr Chat records the required capability, estimated complexity, provider constraint, default and selected models, evidence sample count, candidate performance, and whether measured outcomes changed the default.

## Run locally

Requirements: Node.js 24+, Git, and an authenticated `codex` or `claude` CLI for local-subscription mode.

```powershell
npm install
npm run dev
```

Copy `.env.example` to `.env.local` only when you need APIs, integrations, benchmarks, or LAN pairing. Never commit that file.

## Verify

```powershell
npm run test:core
npm run test:browser
npm run build
npm audit --omit=dev
```

`test:core` covers type safety, routing, efficiency, infrastructure, and the free benchmark dry run. Playwright starts the app and checks real Chromium flows at desktop and mobile sizes.

## Storage and migration

Fresh installations use:

- durable state: `~/.hyzr/chat`
- project workspaces: `~/hyzr-chat-workspaces`
- browser keys: `hyzr.chat.*`

If Hyzr Chat finds the former `~/.vmx` or `~/vmx-workspaces` directories, it continues using them. Browser settings and sessions also accept the former `vmx.*` keys. New environment variables use the `HYZR_CHAT_` prefix and accept their former `VMX_` equivalents as fallbacks. This compatibility is deliberate: rebranding must not strand encrypted jobs, projects, or preferences.

## Security boundary

Hyzr Chat is local-first developer infrastructure. It can execute coding tools with file and command access inside project workspaces. Run it on a trusted machine or private network, configure `HYZR_CHAT_ACCESS_TOKEN` before connecting another device, and review the evidence and final diff before merging generated work.

See [SECURITY.md](SECURITY.md) for the complete boundary.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Brand system](docs/BRAND.md)
- [Launch checklist](docs/LAUNCH.md)
- [Pilot runbook](docs/PILOT.md)
- [Technical diligence](docs/VC-DILIGENCE.md)

## Status

Private pre-launch build. `chat.hyzr.ai` is the reserved production address; deployment and DNS remain intentionally unconfigured until the release checklist passes.
