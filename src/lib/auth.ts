import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { signSession, verifySession, SESSION_COOKIE, SESSION_TTL_SECS } from "@/lib/session";
import { evaluateDevice, createSession, enforcementOn } from "@/lib/deviceSecurity";
import type { RequestMeta } from "@/lib/device";
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

  // New (DB-backed) sessions carry a `sid` — verify the session row is still live
  // so revocation / force-logout / device-block all take effect here. Legacy
  // tokens (no sid) stay valid until they expire — back-compat so the rollout
  // logs nobody out.
  if (payload.sid) {
    const s = await prisma.userSession.findUnique({
      where: { id: payload.sid },
      select: { userId: true, revokedAt: true, expiresAt: true, lastActiveAt: true },
    });
    if (!s || s.userId !== user.id || s.revokedAt || s.expiresAt < new Date()) return null;
    // Throttled "last active" update — best-effort, never blocks the request.
    if (Date.now() - s.lastActiveAt.getTime() > 60_000) {
      prisma.userSession.update({ where: { id: payload.sid }, data: { lastActiveAt: new Date() } }).catch(() => {});
    }
  }
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

export async function loginWithCredentials(
  email: string,
  password: string,
  deviceCtx?: { deviceId: string; meta: RequestMeta },
) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });
  if (!user || !user.active) return { ok: false as const, error: "Invalid credentials" };
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return { ok: false as const, error: "Invalid credentials" };

  // ── Device-security gate ──
  let sid: string | undefined;
  if (deviceCtx?.deviceId) {
    const decision = await evaluateDevice({
      user: { id: user.id, name: user.name, deviceLimitExtra: user.deviceLimitExtra, isSuperAdmin: user.isSuperAdmin },
      deviceId: deviceCtx.deviceId,
      meta: deviceCtx.meta,
    });
    if (!decision.ok) {
      if (decision.reason === "blocked") {
        return { ok: false as const, error: "This device is not approved for CRM access.", blocked: true as const };
      }
      return { ok: false as const, error: "Device approval pending. Please contact Admin.", pending: true as const };
    }
    sid = await createSession(user.id, decision.deviceRowId, deviceCtx.meta);
  } else if (enforcementOn() && !user.isSuperAdmin) {
    // No device id from the client → the device can't be identified/registered.
    // Under enforcement this must NOT silently log in (that was the bypass that let
    // agents in without an approval request). Tell them to reload so the fresh login
    // page sends a device id. Super-admins are exempt (safety hatch).
    return { ok: false as const, error: "Couldn't verify this device. Please fully reload the page (Ctrl+Shift+R / clear cache) and sign in again.", blocked: true as const };
  }

  const token = await signSession(
    { uid: user.id, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECS, ...(sid ? { sid } : {}) },
    secret(),
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
  const token = jar.get(SESSION_COOKIE)?.value;
  const payload = token ? await verifySession(token, secret()).catch(() => null) : null;
  if (payload?.sid) {
    await prisma.userSession.update({ where: { id: payload.sid }, data: { revokedAt: new Date(), revokedReason: "logout" } }).catch(() => {});
  }
  jar.delete(SESSION_COOKIE);
}
