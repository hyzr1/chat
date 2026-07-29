# Security policy

Hyzr Chat is currently a local pilot product. It executes authenticated coding CLIs with command and file access inside isolated workspaces, so operators must treat it as privileged developer infrastructure.

## Supported deployment boundary

- Run Hyzr Chat on a trusted operator machine or private network.
- Set `HYZR_CHAT_ACCESS_TOKEN` before allowing another device on the LAN to connect.
- Do not expose `next dev` or the generated preview-port range directly to the public internet.
- Use repository-scoped GitHub App permissions instead of a personal access token.
- Keep `.env.local`, `~/.hyzr`, legacy `~/.vmx` data, provider credentials, workspaces, and evidence out of source control.
- Review independent verification and the final diff before merging generated work.

## Built-in controls

- AES-256-GCM authenticated encryption for durable job payloads and integration tokens.
- HttpOnly device-pairing cookie and same-host mutation checks when LAN access control is enabled.
- Signed GitHub and Linear webhooks with replay detection.
- Isolated per-chat workspaces and isolated Git worktrees for deliveries.
- Production dependency audit, high-confidence credential scan, browser-flow checks, and accessibility evidence.
- Explicit cancellation, leases, bounded retries, runtime/activity limits, and measured token ceilings.

## Reporting a vulnerability

Do not open a public issue containing credentials, private repository content, or an exploitable proof. Send the maintainer a private report with the affected version, impact, reproduction steps, and suggested mitigation. The maintainer should acknowledge the report, preserve evidence, rotate any affected secret, and publish a remediation note before wider deployment.

## Current non-goals

The local pilot does not yet claim enterprise SSO, role-based access control, tenant isolation, public-edge hardening, compliance certification, or sandboxing against a malicious repository. Those controls are required before a multi-tenant hosted launch.
