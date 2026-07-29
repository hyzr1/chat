import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { productEnv } from "@/lib/product";

export const runtime = "nodejs";

function equal(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
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
