import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { BENCHMARK_DATASET, BENCHMARK_DATASET_NAME, benchmarkTokenCeiling, wakeBenchmarkWorker } from "@/lib/benchmark-engine";
import { createBenchmarkJob, listBenchmarkJobs } from "@/lib/durable-jobs";
import { productEnv } from "@/lib/product";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    dataset: BENCHMARK_DATASET_NAME,
    cases: BENCHMARK_DATASET.length,
    tokenCeiling: benchmarkTokenCeiling(),
    jobs: listBenchmarkJobs(30),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { mode?: string; confirmPaidRuns?: boolean; premiumModelId?: string; trials?: number };
  const mode = body.mode === "live" ? "live" : "dry";
  if (mode === "live" && body.confirmPaidRuns !== true) {
    return NextResponse.json({
      error: "Live evaluation requires explicit confirmation because it executes both Hyzr Chat and premium-only arms and may consume paid model usage.",
    }, { status: 400 });
  }
  const premiumModelId = body.premiumModelId || productEnv("HYZR_CHAT_BENCHMARK_PREMIUM_MODEL", "VMX_BENCHMARK_PREMIUM_MODEL") || "gpt-5.6-sol";
  const trials = mode === "dry" ? 1 : Math.max(1, Math.min(5, Math.floor(Number(body.trials) || 1)));
  const id = `evaluation-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const job = createBenchmarkJob(id, mode, BENCHMARK_DATASET_NAME, premiumModelId, BENCHMARK_DATASET.length * 2 * trials, {
    id,
    createdAt: new Date().toISOString(),
    live: mode === "live",
    premiumModelId,
    dataset: BENCHMARK_DATASET_NAME,
    trials,
    tokenCeiling: benchmarkTokenCeiling(),
    results: [],
  });
  wakeBenchmarkWorker();
  return NextResponse.json({ job }, { status: 202, headers: { "Cache-Control": "no-store" } });
}
