import { NextResponse } from "next/server";
import { createLinearOAuthState, linearAuthorizeUrl, linearOAuthConfigured } from "@/lib/linear-integration";

export async function GET() {
  if (!linearOAuthConfigured()) return NextResponse.json({ error: "Linear OAuth is not configured." }, { status: 503 });
  const state = createLinearOAuthState();
  const response = NextResponse.redirect(linearAuthorizeUrl(state));
  response.cookies.set("hyzr_chat_linear_oauth", state, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/" });
  return response;
}
