# Hyzr Chat architecture

Hyzr Chat is a local-first, server-owned execution system. The browser is a supervisor, not the worker.

## Execution boundary

Prompts are encrypted and committed to SQLite before execution. A worker claims a lease, renews it while running, checkpoints specialist completion, and persists an append-only event stream. Disconnecting a browser does not cancel work. Expired normal jobs return to the queue; expired paid benchmark jobs stop and require fresh authorization.

Development hot reload assigns workers a new module generation. A stale generation is drained before its replacement claims work, preventing old execution logic and duplicate consumers from operating behind a newly rendered UI.

## Routing and cost controls

The local planner classifies capability, complexity, modality, tool needs, and explicit provider constraints. User-configured capability priorities restrict the eligible pool. Adaptive routing can change the default only when rated evidence exists.

Cost controls are layered:

1. Exact deterministic operations use Hyzr Chat Native and make zero provider calls.
2. Conversation, repository, skill, handoff, and memory packets have independent size bounds.
3. Runtime, activity, retry, and token ceilings scale with justified complexity.
4. A specialist cannot start after the delivery token budget is exhausted.
5. Paid evaluation has a separate global token ceiling and explicit confirmation.

## Repository intelligence

Each workspace has a compact architecture map: languages, frameworks, manifests, entry points, validation commands, documentation, and a fingerprint. Specialists receive task-focused subsets plus deterministic artifact diffs rather than the full transcript. Project constraints and recent artifacts are stored per workspace.

GitHub deliveries use a mirror plus isolated worktree and branch. The delivery adapter can publish a PR and Check Run, record human edits after the delivery SHA, and run post-merge verification. Linear issues can enqueue the same durable delivery and receive lifecycle comments and state changes.

## Verification

The verifier chooses the narrowest available scripts, audits production dependencies, scans for high-confidence credentials, and requires a repository mutation for implementation requests. Static web projects are exercised in Chromium at desktop and mobile viewports. Evidence includes screenshots, browser errors, failed requests, horizontal overflow, and serious or critical axe violations.

Verification is independent of the implementing model. A task that produced output but failed its delivery contract ends in `needs_attention`, not success.

## Shared state and mobile

Chats, run events, projects, active project selection, workspaces, and delivery evidence are server-owned. The phone and desktop observe the same state. Preview URLs are rewritten for the requesting device so localhost stays on the host while LAN clients receive a reachable host address.

LAN access can be protected with `HYZR_CHAT_ACCESS_TOKEN`. Pairing sets a strict HttpOnly cookie; cross-origin mutations are rejected. This is an operator-machine pilot boundary, not a substitute for hosted identity, tenant isolation, or a zero-trust edge.

## Hosted evolution

The current SQLite job-store interface is intentionally replaceable. A hosted deployment should move leases and event storage to Postgres or Temporal, use object storage for evidence, put workspaces in isolated sandboxes, and add organization identity, RBAC, audit export, quotas, and fleet observability without changing the execution/event contracts.
