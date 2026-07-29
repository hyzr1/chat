import { NextRequest, NextResponse } from "next/server";
import { githubAppConfigured } from "@/lib/github-app";

export async function GET(request: NextRequest) {
  if (!githubAppConfigured()) return NextResponse.json({ configured: false, error: "Configure the GitHub App environment variables first." }, { status: 503 });
  const slug = process.env.GITHUB_APP_SLUG;
  if (!slug) return NextResponse.json({ configured: true, error: "GITHUB_APP_SLUG is required for the installation link." }, { status: 503 });
  const state = request.nextUrl.searchParams.get("state");
  const url = new URL(`https://github.com/apps/${slug}/installations/new`);
  if (state) url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
