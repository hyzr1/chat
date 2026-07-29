# Hyzr Chat pilot runbook

This runbook is for a design partner evaluating Hyzr Chat on a real engineering backlog. The pilot should measure accepted outcomes, not demo activity.

## 1. Secure the operator machine

Copy `.env.example` to `.env.local` and set at least:

```text
HYZR_CHAT_ACCESS_TOKEN=<long random value>
HYZR_CHAT_BENCHMARK_TOKEN_CEILING=120000
```

`localhost` stays directly accessible. A phone or another LAN device is redirected to `/pair`, where the access token is exchanged for a strict HttpOnly cookie. Do not expose the development server directly to the public internet. Use a private network or an authenticated tunnel for a remote pilot.

Authenticate at least one local provider CLI (`codex` or `claude`). Add model pricing only when the operator has a defensible per-million-token value; Hyzr Chat deliberately leaves monetary savings blank otherwise.

## 2. Connect the delivery loop

For GitHub, create a repository-scoped GitHub App with contents, issues, pull requests, checks, and metadata permissions. Configure the signed webhook at `/api/integrations/github/webhook`.

For Linear, create an OAuth application and a signed organization webhook at `/api/integrations/linear/webhook`. Add the `hyzr-chat` or `agent` label to a pilot issue to start a durable delivery.

The target workflow is:

```text
Issue -> isolated worktree -> routed execution -> verification -> PR + Check -> human review -> merge regression
```

## 3. Establish a baseline before making claims

1. Open **Proof** and run the free routing audit.
2. Complete at least 20 representative tasks and record accept/reject feedback.
3. Verify that repository mutations, tests, screenshots, and accessibility evidence are attached.
4. Only then run a one-trial paid comparison against the chosen premium baseline.
5. Review partial evidence before increasing trials or the token ceiling.

Paid comparisons never silently resume after a Hyzr Chat restart. The complete evaluation has a measured token ceiling. A single provider call can finish above the boundary because local CLIs report usage after completion.

## 4. Pilot scorecard

Collect these values weekly:

- Accepted task rate, with the exact acceptance definition.
- Tokens and cost per accepted task, excluding rejected work from the denominator.
- Median and p95 time to verified pull request.
- Human additions and deletions after the Hyzr Chat delivery commit.
- Retry, interruption, and needs-attention rate.
- Verification pass rate and post-merge regression rate.
- Percentage of work completed with zero model calls.
- Operator interventions per accepted task.

Do not present the historical `$8.70 / 84%` target as measured Hyzr Chat performance until a matched live evaluation reproduces it.

## 5. Demo sequence

Use one real repository and one issue that can finish during the meeting:

1. Show the issue and its explicit delivery contract.
2. Start it from the phone, then leave the page.
3. Show the routing plan before execution and explain the selected specialists.
4. Reopen the same task on desktop and steer it while the server-owned job continues.
5. Inspect the live preview and file tree.
6. Finish on the pull request, GitHub Check, verification screenshots, and measured token evidence.
7. Open **Proof** and export the diligence packet.

Keep a deterministic zero-model task ready as a fast reliability proof, but make the main demo a realistic accepted engineering outcome.

## 6. Go/no-go checklist

Before an external pilot:

- `npm run lint`, `npm run build`, and all test scripts pass.
- `npm audit --omit=dev` reports no production vulnerability.
- Proof reports durable persistence and LAN access control as ready.
- A phone can pair, open the same task, and reach the preview through the LAN address.
- Cancelling, disconnecting, refreshing, and restarting Hyzr Chat have been exercised.
- The repository has a recovery path and no production secret is stored in source.
- The operator can explain every metric and its denominator.
