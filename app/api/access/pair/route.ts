import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import os from "os";
import { productEnv } from "@/lib/product";

export const runtime = "nodejs";

function equal(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function isLocalHost(host: string) {
  const name = host.replace(/^\[/, "").replace(/\](:\d+)?$/, "").replace(/:\d+$/, "").toLowerCase();
  return name === "localhost" || name === "127.0.0.1" || name === "::1";
}

function lanAddress(port: string) {
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const net of iface || []) {
      // Prefer a routable IPv4 on the local network.
      if (net.family === "IPv4" && !net.internal) return `http://${net.address}:${port}`;
    }
  }
  return "";
}

// Pairing info for the host UI: the LAN URL to open on a phone and, only when
// asked from the host machine itself, the access code to enter there.
export async function GET(request: NextRequest) {
  const required = productEnv("HYZR_CHAT_ACCESS_TOKEN", "VMX_ACCESS_TOKEN");
  const host = request.headers.get("host") || request.nextUrl.host || "";
  const local = isLocalHost(host);
  const port = host.split(":")[1] || request.nextUrl.port || "3000";
  return NextResponse.json({
    lanUrl: lanAddress(port),
    port,
    protected: Boolean(required),
    code: local && required ? required : undefined,
    host: os.hostname(),
  });
}

export async function POST(request: NextRequest) {
  const required = productEnv("HYZR_CHAT_ACCESS_TOKEN", "VMX_ACCESS_TOKEN");
  if (!required) return NextResponse.json({ paired: true, protection: "disabled" });
  const body = await request.json().catch(() => ({}));
  if (!equal(String(body.accessToken || ""), required)) return NextResponse.json({ error: "That access key is not valid." }, { status: 401 });
  const response = NextResponse.json({ paired: true });
  response.cookies.set("hyzr_chat_access", required, { httpOnly: true, sameSite: "strict", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return response;
}
