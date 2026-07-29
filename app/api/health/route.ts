import { NextResponse } from "next/server";
import { operationalHealth } from "@/lib/operational-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await operationalHealth();
    return NextResponse.json(health, {
      status: health.status === "unavailable" ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error: any) {
    return NextResponse.json({ status: "unavailable", error: String(error?.message || error), checkedAt: Date.now() }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
