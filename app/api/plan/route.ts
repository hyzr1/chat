import { NextRequest, NextResponse } from "next/server";
import { analyze } from "@/lib/planner";
import { LOCAL_MODELS } from "@/lib/local-models";
import { getRun } from "@/lib/run-registry";
import { buildRoutingContext } from "@/lib/local-runner";
import { readRoutingFeedbackSamples } from "@/lib/routing-feedback-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const enabled = (Array.isArray(body.enabledModelIds) && body.enabledModelIds.length
      ? body.enabledModelIds
      : Object.keys(LOCAL_MODELS)).filter((id: string) => LOCAL_MODELS[id]);
    const context = buildRoutingContext(messages.map((message: any) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: String(message.content ?? ""),
    })));
    const plan = await analyze(
      `Use only this current chat as context. Route the final user request in light of the project established earlier in this chat:\n\n${context}`,
      enabled,
      body.runId ? getRun(String(body.runId))?.abort.signal : undefined,
      body.routingRules,
      body.preferences?.adaptiveRouting === false ? [] : readRoutingFeedbackSamples(),
    );
    const effortWeight: Record<string, number> = { low: .7, medium: 1, high: 1.25, xhigh: 1.55, max: 1.9, ultra: 2.3 };
    const tierMinutes: Record<string, number> = { trivial: .6, standard: 2.2, hard: 4.5 };
    const weight = effortWeight[body.effort] ?? 1.25;
    const minutes = plan.subtasks.reduce((sum, task) => sum + (tierMinutes[task.tier] ?? 2), 0) * weight;
    const computeUnits = plan.subtasks.reduce((sum, task) => sum + ({ trivial: 1, standard: 3, hard: 6 }[task.tier] ?? 3), 0) * weight;
    return NextResponse.json({ plan: { ...plan, estimate: { minutes: Math.max(1, Math.round(minutes)), computeUnits: Math.round(computeUnits), models: new Set(plan.subtasks.map((task) => task.modelId)).size } } });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? "Planning failed" }, { status: 500 });
  }
}
