# Hyzr Chat launch checklist

Deployment and DNS should happen only after every blocking item is complete.

## Repository

- [ ] `hyzr1/chat` exists as a private repository with clean history.
- [ ] Default branch is `main`; branch protection requires the verification workflow.
- [ ] Repository description and topics match the product, without unsupported claims.
- [ ] Secret scanning and Dependabot alerts are enabled.

## Product quality

- [ ] Type checks, core tests, browser tests, production build, and production dependency audit pass.
- [ ] Desktop and mobile screenshots have no overflow, console errors, failed requests, or serious accessibility findings.
- [ ] Local CLI mode and direct API mode each complete one representative project.
- [ ] Refresh, reconnect, cancel, resume, and process-restart flows preserve durable runs.
- [ ] Existing VMX-era projects, encrypted state, preferences, and paired-device behavior have been migration-tested.

## Hosted architecture decision

The current local pilot is not ready to be exposed as a public multi-tenant service. Before a public Vercel launch, choose one of these boundaries:

1. **Private product site plus local app download:** Vercel hosts a marketing page; execution stays on the user’s machine.
2. **Authenticated single-operator control plane:** Vercel provides the UI and identity while a private worker owns durable execution.
3. **Hosted multi-tenant product:** replace local SQLite and filesystem assumptions with tenant-isolated storage, queues, workers, secrets, rate limits, audit logs, and a zero-trust edge.

Do not deploy the current local execution server directly to a public Vercel URL.

## Domain plan

- [ ] Add `chat.hyzr.ai` to the selected Vercel project.
- [ ] In the DNS provider for `hyzr.ai`, add the exact record Vercel requests.
- [ ] Keep the existing `hyzr.ai` site unchanged while Chat is validated.
- [ ] Verify HTTPS, canonical metadata, redirects, and health checks.
- [ ] Move the portfolio to `about.hyzr.ai` only as a separate, reversible launch.
- [ ] Replace root `hyzr.ai` only after the product-family home is built and reviewed.

## Release

- [ ] Configure production secrets in the hosting platform, never in Git.
- [ ] Run the full verification suite against the release commit.
- [ ] Tag the release and record rollback instructions.
- [ ] Monitor errors, latency, queue health, and failed integrations after launch.
