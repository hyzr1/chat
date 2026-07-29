import { NextResponse } from "next/server";
import { abortBenchmarkJob } from "@/lib/benchmark-engine";
import { cancelBenchmarkJob, getBenchmarkJob } from "@/lib/durable-jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const job = getBenchmarkJob(id);
  return job
    ? NextResponse.json({ job }, { headers: { "Cache-Control": "no-store" } })
    : NextResponse.json({ error: "Evaluation not found" }, { status: 404 });
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!getBenchmarkJob(id)) return NextResponse.json({ error: "Evaluation not found" }, { status: 404 });
  abortBenchmarkJob(id);
  return NextResponse.json({ job: cancelBenchmarkJob(id) }, { headers: { "Cache-Control": "no-store" } });
}
