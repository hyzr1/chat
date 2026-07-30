import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { kvGet, kvSet, relayBackedByRedis } from "./relay-store";
import { isHostedRuntime } from "./agent-protocol";

export const AUTH_COOKIE = "hyzr_auth";
const SESSION_TTL = 60 * 60 * 24 * 30;

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  createdAt: number;
}

interface StoredUser extends AuthUser {
  salt: string;
  passwordHash: string;
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase().slice(0, 254);
}

function ensurePersistentHostedState() {
  if (isHostedRuntime() && !relayBackedByRedis) {
    throw Object.assign(new Error("This deployment is missing its persistent Redis configuration."), { status: 503 });
  }
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function passwordHash(password: string, salt: string) {
  return scryptSync(password, Buffer.from(salt, "base64"), 32).toString("base64");
}

function publicUser(user: StoredUser): AuthUser {
  return { id: user.id, email: user.email, name: user.name, createdAt: user.createdAt };
}

export async function createUser(emailInput: unknown, passwordInput: unknown) {
  ensurePersistentHostedState();
  const email = normalizeEmail(emailInput);
  const password = String(passwordInput || "");
  if (!validEmail(email)) throw Object.assign(new Error("Enter a valid email address."), { status: 400 });
  if (password.length < 10 || password.length > 200) throw Object.assign(new Error("Use a password with at least 10 characters."), { status: 400 });
  if (await kvGet(`auth:email:${email}`)) throw Object.assign(new Error("An account already exists for that email."), { status: 409 });
  const salt = randomBytes(16).toString("base64");
  const user: StoredUser = {
    id: randomUUID(),
    email,
    name: email.split("@")[0].slice(0, 80) || "Developer",
    createdAt: Date.now(),
    salt,
    passwordHash: passwordHash(password, salt),
  };
  await kvSet(`auth:user:${user.id}`, user);
  await kvSet(`auth:email:${email}`, user.id);
  return publicUser(user);
}

export async function verifyUser(emailInput: unknown, passwordInput: unknown) {
  ensurePersistentHostedState();
  const email = normalizeEmail(emailInput);
  const id = await kvGet<string>(`auth:email:${email}`);
  const user = id ? await kvGet<StoredUser>(`auth:user:${id}`) : null;
  if (!user) {
    passwordHash(String(passwordInput || ""), Buffer.alloc(16, 7).toString("base64"));
    throw Object.assign(new Error("Email or password is incorrect."), { status: 401 });
  }
  const supplied = Buffer.from(passwordHash(String(passwordInput || ""), user.salt), "base64");
  const expected = Buffer.from(user.passwordHash, "base64");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw Object.assign(new Error("Email or password is incorrect."), { status: 401 });
  }
  return publicUser(user);
}

export async function createAuthSession(user: AuthUser) {
  ensurePersistentHostedState();
  const token = randomBytes(32).toString("base64url");
  await kvSet(`auth:session:${token}`, { userId: user.id, createdAt: Date.now() }, SESSION_TTL);
  return token;
}

export async function authUser(request: NextRequest) {
  if (isHostedRuntime() && !relayBackedByRedis) return null;
  const token = request.cookies.get(AUTH_COOKIE)?.value;
  if (!token) return null;
  const session = await kvGet<{ userId: string }>(`auth:session:${token}`);
  if (!session?.userId) return null;
  const user = await kvGet<StoredUser>(`auth:user:${session.userId}`);
  return user ? publicUser(user) : null;
}

export function authCookie(token: string) {
  return {
    name: AUTH_COOKIE,
    value: token,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: isHostedRuntime(),
      path: "/",
      maxAge: SESSION_TTL,
    },
  };
}
