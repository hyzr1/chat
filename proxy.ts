import { NextRequest, NextResponse } from "next/server";
import { productEnv } from "./lib/product";

function localHost(host: string) {
  const name = host.replace(/^\[/, "").replace(/\](:\d+)?$/, "").replace(/:\d+$/, "").toLowerCase();
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") || request.nextUrl.host;
  const origin = request.headers.get("origin");
  if (origin && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    try {
      if (new URL(origin).host !== host) return NextResponse.json({ error: "Cross-origin mutation rejected." }, { status: 403 });
    } catch { return NextResponse.json({ error: "Invalid request origin." }, { status: 403 }); }
  }

  const required = productEnv("HYZR_CHAT_ACCESS_TOKEN", "VMX_ACCESS_TOKEN");
  if (!required || localHost(host)) return NextResponse.next();
  if (request.nextUrl.pathname === "/pair" || request.nextUrl.pathname === "/api/access/pair") return NextResponse.next();
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const cookie = request.cookies.get("hyzr_chat_access")?.value || request.cookies.get("vmx_access")?.value;
  if (bearer === required || cookie === required) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) return NextResponse.json({ error: "This device is not paired with Hyzr Chat." }, { status: 401 });
  return NextResponse.redirect(new URL("/pair", request.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
