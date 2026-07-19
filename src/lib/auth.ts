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
  if (!user || !user.active) return null;          // disabled account → out immediately
  // Role/permissions are read LIVE from `user` on every request, so a role change
  // takes effect on the user's very next request (no stale-permission window).

  // New (DB-backed) sessions carry a `sid` — verify the session row + its device on
  // EVERY request so revocation / force-logout / device-block / password-reset all
  // take effect server-side, not just at login. Super-admin (Lalit) is exempt from
  // the DEVICE checks only (safety hatch — can never be device-locked-out).
  if (payload.sid) {
    const s = await prisma.userSession.findUnique({
      where: { id: payload.sid },
      select: {
        userId: true, revokedAt: true, expiresAt: true, lastActiveAt: true, createdAt: true,
        deviceRef: true, device: { select: { status: true, deviceId: true } },
      },
    });
    const now = new Date();
    if (!s || s.userId !== user.id || s.revokedAt || s.expiresAt < now) return null;

    // ── Password epoch ── any session created BEFORE the user's last password change
    // is dead → forces re-login on ALL devices after an admin reset or self-change.
    if (user.passwordChangedAt && s.createdAt < user.passwordChangedAt) return null;

    // ── Per-request DEVICE binding (super-admin exempt) ──
    if (!user.isSuperAdmin && s.deviceRef) {
      // Session tied to a device that is no longer APPROVED (revoked/blocked/removed/
      // pending) loses access immediately.
      if (!s.device || s.device.status !== "APPROVED") return null;
      // Copied-cookie guard — HARD DENY (Lalit, max security): the wcr_did cookie must
      // be PRESENT and MATCH the session's device. Missing OR mismatched → reject and
      // force fresh auth. A copied/restored wcr_session used in another browser carries
      // that browser's own (different or absent) wcr_did, so it can't reopen access.
      // Super-admin is exempt via the outer `!user.isSuperAdmin` guard (lockout backstop).
      const did = (jar.get("wcr_did")?.value ?? "").trim();
      if (!did || (s.device.deviceId && did !== s.device.deviceId)) return null;
    }

    // Throttled "last active" update — best-effort, never blocks the request.
    if (now.getTime() - s.lastActiveAt.getTime() > 60_000) {
      prisma.userSession.update({ where: { id: payload.sid }, data: { lastActiveAt: now } }).catch(() => {});
    }
  } else if (user.passwordChangedAt && !user.isSuperAdmin) {
    // ── Password epoch for LEGACY cookies ── no-sid cookies carry no issue-time, so
    // they can't be compared against passwordChangedAt like DB sessions are. But every
    // login since the UserSession rollout issues a sid — a surviving no-sid cookie
    // necessarily predates it. Rule: once a user's password epoch is set (admin reset
    // or hard force-logout), legacy cookies are dead → fresh, device-bound login.
    // Without this, an admin password reset did NOT log out pre-rollout devices
    // (found during the Yasir Khan hard session reset, 2026-07-17).
    return null;
  } else if (enforcementOn() && !user.isSuperAdmin) {
    // Under enforcement a session MUST be device-bound (carry a sid). Legacy no-sid
    // cookies (pre-device-security) are no longer trusted — force a fresh, device-
    // bound login. (Everyone was force-logged-out at rollout, so no real user relies
    // on a legacy cookie.) Super-admin exempt.
    return null;
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

/**
 * User-management authorization guard (Lalit security audit, 2026-07-17).
 *
 * A privilege-escalation hole existed: EVERY `admin/users/[id]/*` mutation
 * (password reset, role change, deactivate, invite) was gated only by
 * `requireRole("ADMIN")` — so ANY non-super admin (e.g. Sameer, leadOpsOnly)
 * could reset the SUPER-ADMIN's password and take over the owner account,
 * defeating the whole export/wipe/force-logout boundary that keys on
 * `isSuperAdmin`. Two independent audit agents found this identically.
 *
 * Rule (matches the sessions route's existing guard):
 *   • hr-only admins may never manage CRM users.
 *   • Only a super-admin may act on a super-admin (or an ADMIN-role) target.
 *   • Creating/promoting an ADMIN is a super-admin-only act.
 * Returns null when allowed, or a 403 `{code,message}` the caller returns as JSON.
 */
/**
 * SELF-SERVICE PASSWORD CHANGE — blocked for AGENTs (Lalit, 2026-07-20).
 *
 * Policy decision, not a security control in itself: an agent's password is set
 * and rotated by an admin only. Managers, admins and super-admins keep
 * self-service.
 *
 * ⚠️ CONSEQUENCE, recorded here deliberately so it is not rediscovered the hard
 * way: an agent CANNOT rotate a compromised password. Whatever password the
 * admin set — and however it was delivered to them — stands until an admin
 * changes it. If an agent's phone or chat history is exposed, the only remedy is
 * Admin → User Management → reset password (which stamps passwordChangedAt,
 * bumps sessionEpoch and revokes every session, so the reset is a true lockout).
 * Lalit was shown this trade-off and chose it knowingly; do not "fix" it by
 * re-enabling self-service without asking him.
 *
 * The UI hides the form for agents, but THIS is the enforcement point — a hidden
 * form is not a permission.
 */
export function selfPasswordChangeDenial(me: { role?: string | null }):
  | { code: 403; message: string }
  | null {
  if (me.role === "AGENT") {
    return {
      code: 403,
      message:
        "Password changes for agent accounts are handled by an admin. Please ask your administrator to reset it for you.",
    };
  }
  return null;
}

export type ManageUserTarget = { isSuperAdmin?: boolean | null; role?: string | null };
export function userManagementDenial(
  me: { isSuperAdmin?: boolean | null; hrOnly?: boolean | null },
  target: ManageUserTarget,
): { code: 403; message: string } | null {
  if (me.hrOnly) return { code: 403, message: "HR-only admins cannot manage CRM users." };
  const targetIsPrivileged = !!target.isSuperAdmin || target.role === "ADMIN";
  if (targetIsPrivileged && !me.isSuperAdmin) {
    return { code: 403, message: "Only a super-admin can manage another admin or super-admin account." };
  }
  return null;
}

export async function loginWithCredentials(
  email: string,
  password: string,
  deviceCtx?: { deviceId: string; meta: RequestMeta; pwa?: boolean },
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
      pwa: deviceCtx.pwa,
    });
    if (!decision.ok) {
      if (decision.reason === "blocked") {
        return { ok: false as const, error: "This device is not approved for CRM access.", blocked: true as const };
      }
      return { ok: false as const, error: "Device registration is pending administrator approval.", pending: true as const };
    }
    sid = await createSession(user.id, decision.deviceRowId, deviceCtx.meta);
  } else if (enforcementOn() && !user.isSuperAdmin) {
    // Defensive only: the /api/login route now ALWAYS resolves a device id
    // (client localStorage → wcr_did cookie → server-generated UUID), so this
    // branch is effectively unreachable. If it ever is hit, fail with a neutral,
    // device-agnostic message — NEVER desktop-only instructions. Super-admins exempt.
    return { ok: false as const, error: "Device verification failed. Please try again.", blocked: true as const };
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
