import { NextRequest, NextResponse } from "next/server";
import { authCookie, createAuthSession, createUser } from "@/lib/auth";
import { takeRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const rate = await takeRateLimit(request, "auth-signup", process.env.HYZR_TEST === "1" ? 1_000 : 5, 60 * 60);
    if (!rate.allowed) return NextResponse.json({ error: "Too many account attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
    const body = await request.json();
    const user = await createUser(body.email, body.password);
    const token = await createAuthSession(user);
    const response = NextResponse.json({ user });
    const cookie = authCookie(token);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not create the account." }, { status: Number(error?.status) || 500 });
  }
}
