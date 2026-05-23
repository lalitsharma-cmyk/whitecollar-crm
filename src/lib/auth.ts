import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signSession, verifySession, SESSION_COOKIE, SESSION_TTL_SECS } from "@/lib/session";
import type { Role } from "@prisma/client";

function secret() {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set");
  return s;
}

export const getCurrentUser = cache(async () => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const payload = await verifySession(token, secret());
  if (!payload) return null;
  const user = await prisma.user.findUnique({ where: { id: payload.uid } });
  if (!user || !user.active) return null;
  return user;
});

export async function requireUser() {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireRole(...roles: Role[]) {
  const u = await requireUser();
  if (!roles.includes(u.role)) redirect("/dashboard");
  return u;
}

export async function loginWithCredentials(email: string, password: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || !user.active) return { ok: false as const, error: "Invalid credentials" };
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return { ok: false as const, error: "Invalid credentials" };

  const token = await signSession(
    { uid: user.id, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECS },
    secret()
  );
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECS,
  });
  return { ok: true as const, user };
}

export async function logout() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}
