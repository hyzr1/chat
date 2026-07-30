import { NextRequest, NextResponse } from "next/server";
import { authCookie, createAuthSession, verifyUser } from "@/lib/auth";
import { takeRateLimit } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    const rate = await takeRateLimit(request, "auth-login", 10, 10 * 60);
    if (!rate.allowed) return NextResponse.json({ error: "Too many sign-in attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
    const body = await request.json();
    const user = await verifyUser(body.email, body.password);
    const token = await createAuthSession(user);
    const response = NextResponse.json({ user });
    const cookie = authCookie(token);
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "Could not sign in." }, { status: Number(error?.status) || 500 });
  }
}
