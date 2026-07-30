import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const RELEASES = "https://github.com/hyzr1/chat/releases/latest";
const WINDOWS_INSTALLER = `${RELEASES}/download/Hyzr-Agent-1.0.5-win-x64.exe`;

export function GET(request: NextRequest) {
  const platform = request.nextUrl.searchParams.get("platform");
  if (platform === "windows") return NextResponse.redirect(WINDOWS_INSTALLER, 307);
  const fragment = platform === "windows" ? "#windows" : platform === "mac" ? "#macos" : platform === "linux" ? "#linux" : "";
  return NextResponse.redirect(`${RELEASES}${fragment}`, 307);
}
