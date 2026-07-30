import { NextRequest, NextResponse } from "next/server";
import { authUser } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const user = await authUser(request);
  return user ? NextResponse.json({ user }) : NextResponse.json({ user: null }, { status: 401 });
}

