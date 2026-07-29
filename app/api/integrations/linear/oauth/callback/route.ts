import { NextRequest, NextResponse } from "next/server";
import { exchangeLinearCode } from "@/lib/linear-integration";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expected = request.cookies.get("hyzr_chat_linear_oauth")?.value || request.cookies.get("vmx_linear_oauth")?.value;
  if (!code || !state || !expected || state !== expected) return NextResponse.json({ error: "Invalid or expired Linear OAuth state." }, { status: 400 });
  try {
    const connection = await exchangeLinearCode(code);
    const target = new URL("/", request.nextUrl.origin);
    target.searchParams.set("linear", "connected");
    target.searchParams.set("account", connection.accountId);
    const response = NextResponse.redirect(target);
    response.cookies.delete("hyzr_chat_linear_oauth");
    response.cookies.delete("vmx_linear_oauth");
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: String(error?.message || error) }, { status: 502 });
  }
}
