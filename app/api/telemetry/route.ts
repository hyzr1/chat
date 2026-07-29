import { NextResponse } from "next/server";
import { durableDatabase } from "@/lib/durable-jobs";
import { runAnalytics } from "@/lib/run-registry";
import { resetRoutingFeedback, routingFeedbackSummary } from "@/lib/routing-feedback-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const database = durableDatabase();
  const jobs = database.prepare("SELECT status, COUNT(*) AS count FROM jobs GROUP BY status").all();
  const delivery = database.prepare(`SELECT COUNT(*) AS deliveries,
    COALESCE(SUM(human_additions + human_deletions), 0) AS human_edits,
    SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) AS verified
    FROM deliveries`).get();
  const latestBenchmarks = database.prepare("SELECT id, mode, dataset, result_json, created_at FROM benchmark_runs ORDER BY created_at DESC LIMIT 10").all()
    .map((row: any) => ({ id: row.id, mode: row.mode, dataset: row.dataset, createdAt: row.created_at, summary: JSON.parse(row.result_json).summary }));
  return NextResponse.json({ runs: runAnalytics(), routingLearning: routingFeedbackSummary(), jobs, delivery, latestBenchmarks }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE() {
  return NextResponse.json({ routingLearning: resetRoutingFeedback() }, { headers: { "Cache-Control": "no-store" } });
}
