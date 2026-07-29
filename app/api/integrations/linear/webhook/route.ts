import { NextRequest, NextResponse } from "next/server";
import { enqueueDurableJob, rememberWebhook, setWebhookStatus } from "@/lib/durable-jobs";
import { wakeDurableWorker } from "@/lib/durable-worker";
import { beginRun } from "@/lib/run-registry";
import { linearWebhookHash, verifyLinearWebhook, type LinearDeliverySource } from "@/lib/linear-integration";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const raw = await request.text();
  if (!verifyLinearWebhook(raw, request.headers.get("linear-signature"))) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  const deliveryId = request.headers.get("linear-delivery") || linearWebhookHash(raw);
  if (!rememberWebhook("linear", deliveryId, linearWebhookHash(raw))) return NextResponse.json({ accepted: true, duplicate: true });
  const payload = JSON.parse(raw);
  try {
    const timestamp = Date.parse(payload.webhookTimestamp || payload.createdAt || "");
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 60_000) throw new Error("The Linear webhook timestamp is stale.");
    if (payload.type === "Issue" && ["create", "update"].includes(payload.action)) {
      const labels = (payload.data?.labels || []).map((label: any) => String(label.name || "").toLowerCase());
      if (labels.includes("hyzr-chat") || labels.includes("chat") || labels.includes("vmx") || labels.includes("agent")) {
        const accountId = String(payload.organizationId || payload.data?.organization?.id || "");
        const source: LinearDeliverySource = { issueId: payload.data.id, issueIdentifier: payload.data.identifier, issueTitle: payload.data.title, accountId };
        const runId = `linear-${source.issueIdentifier}-${deliveryId.slice(0, 8)}`.replace(/[^a-zA-Z0-9_-]/g, "-");
        beginRun(runId, runId);
        enqueueDurableJob(runId, runId, {
          runId, sessionId: runId, mode: "local", plan: true, keys: {}, delivery: { linear: source },
          messages: [{ role: "user", content: `Complete Linear issue ${source.issueIdentifier}.\n\nTitle: ${source.issueTitle}\n\n${payload.data.description || "No additional description."}` }],
        });
        wakeDurableWorker();
      }
    }
    setWebhookStatus("linear", deliveryId, "processed");
    return NextResponse.json({ accepted: true });
  } catch (error: any) {
    setWebhookStatus("linear", deliveryId, "failed");
    return NextResponse.json({ accepted: false, error: String(error?.message || error) }, { status: 500 });
  }
}
