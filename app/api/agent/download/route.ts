import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET(request: NextRequest) {
  const platform = request.nextUrl.searchParams.get("platform");
  const file = platform === "windows" ? "hyzr.cmd" : "hyzr";
  return NextResponse.redirect(new URL(`/downloads/${file}`, request.url), 307);
}
