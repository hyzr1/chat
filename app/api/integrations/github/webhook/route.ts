import { NextRequest, NextResponse } from "next/server";
import { enqueueDurableJob, rememberWebhook, setWebhookStatus } from "@/lib/durable-jobs";
import { wakeDurableWorker } from "@/lib/durable-worker";
import { beginRun } from "@/lib/run-registry";
import { recordHumanEdits, verifyGithubWebhook, webhookPayloadHash, type GitHubDeliverySource } from "@/lib/github-app";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const raw = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifyGithubWebhook(raw, signature)) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  const deliveryId = request.headers.get("x-github-delivery") || webhookPayloadHash(raw);
  if (!rememberWebhook("github", deliveryId, webhookPayloadHash(raw))) return NextResponse.json({ accepted: true, duplicate: true });
  const event = request.headers.get("x-github-event") || "unknown";
  const payload = JSON.parse(raw);
  try {
    if (event === "issues" && ["opened", "labeled", "assigned", "reopened"].includes(payload.action)) {
      const labels = (payload.issue?.labels || []).map((label: any) => String(label.name || "").toLowerCase());
      const assignedToChat = (payload.issue?.assignees || []).some((assignee: any) => /hyzr-chat|vmx/i.test(String(assignee.login || "")));
      if (labels.includes("hyzr-chat") || labels.includes("chat") || labels.includes("vmx") || labels.includes("agent") || assignedToChat) {
        const source: GitHubDeliverySource = {
          installationId: Number(payload.installation?.id), owner: payload.repository.owner.login,
          repo: payload.repository.name, issueNumber: Number(payload.issue.number), issueTitle: payload.issue.title,
          baseBranch: payload.repository.default_branch,
        };
        const runId = `gh-${source.owner}-${source.repo}-${source.issueNumber}-${deliveryId.slice(0, 8)}`.replace(/[^a-zA-Z0-9_-]/g, "-");
        beginRun(runId, runId);
        enqueueDurableJob(runId, runId, {
          runId, sessionId: runId, mode: "local", plan: true, keys: {}, delivery: { github: source },
          messages: [{ role: "user", content: `Resolve GitHub issue #${source.issueNumber} in ${source.owner}/${source.repo}.\n\nTitle: ${payload.issue.title}\n\n${payload.issue.body || "No additional description."}` }],
        });
        wakeDurableWorker();
      }
    } else if (event === "pull_request" && ["synchronize", "closed"].includes(payload.action)) {
      await recordHumanEdits(payload.repository.owner.login, payload.repository.name, Number(payload.pull_request.number), Number(payload.installation?.id), Boolean(payload.pull_request.merged));
      if (payload.action === "closed" && payload.pull_request.merged && payload.pull_request.merge_commit_sha) {
        const source: GitHubDeliverySource = {
          installationId: Number(payload.installation?.id), owner: payload.repository.owner.login,
          repo: payload.repository.name, issueNumber: Number(payload.pull_request.number), issueTitle: payload.pull_request.title,
          baseBranch: payload.repository.default_branch, targetSha: payload.pull_request.merge_commit_sha, postMerge: true,
        };
        const runId = `regression-${source.owner}-${source.repo}-${source.issueNumber}-${deliveryId.slice(0, 8)}`.replace(/[^a-zA-Z0-9_-]/g, "-");
        beginRun(runId, runId);
        enqueueDurableJob(runId, runId, { runId, sessionId: runId, mode: "local", keys: {}, verificationOnly: true, delivery: { github: source }, messages: [{ role: "user", content: `Verify merged pull request #${source.issueNumber} for regressions.` }] });
        wakeDurableWorker();
      }
    }
    setWebhookStatus("github", deliveryId, "processed");
    return NextResponse.json({ accepted: true });
  } catch (error: any) {
    setWebhookStatus("github", deliveryId, "failed");
    return NextResponse.json({ accepted: false, error: String(error?.message || error) }, { status: 500 });
  }
}
