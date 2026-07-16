// ADMIN-only: view + force-logout a user's device sessions (Force Logout feature).
//
//   GET    /api/admin/users/[id]/sessions  → active sessions + last-5 revoked tail
//   DELETE /api/admin/users/[id]/sessions  → body {sessionId} = revoke ONE session
//                                            body {}          = FORCE LOGOUT ALL devices
//
// FORCE LOGOUT ALL is the proven "total kill" (Yasir Khan hard reset, 2026-07-17):
//   (a) revoke every active UserSession row — DB-backed (sid) cookies die on their
//       very next request because getCurrentUser verifies the row per-request, AND
//   (b) stamp user.passwordChangedAt = now WITHOUT touching the password hash —
//       auth rejects any LEGACY no-sid cookie once the password epoch is set
//       (pre-device-security logins, e.g. old iPhone-PWA installs, carry NO session
//       row, so revoking rows alone cannot log them out), and any sid session
//       created before the stamp dies via the same epoch check. Intended side
//       effect: total kill. The user keeps their SAME password and simply signs
//       in again.
// Device rows are left intact on purpose — device approval is a separate system
// (/admin/devices). Per-session revoke sets revokedAt/revokedReason on that one
// row ONLY and never bumps the epoch (that would kill all devices, not one).
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";
import { parseUserAgent, osLabel } from "@/lib/device";
import { verifySession, SESSION_COOKIE } from "@/lib/session";

// HR-only admins live in the HR workspace (/hr) and must not wield sales-CRM
// session controls — same exclusion the (app) layout applies for pages.
function isHrOnly(me: unknown): boolean {
  return Boolean((me as { hrOnly?: boolean }).hrOnly);
}

/** The CALLING admin's own session id (sid) — so the UI can warn on self-logout. */
async function callerSid(req: NextRequest): Promise<string | null> {
  try {
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    const secret = process.env.NEXTAUTH_SECRET;
    if (!token || !secret) return null;
    const payload = await verifySession(token, secret);
    return payload?.sid ?? null;
  } catch {
    return null;
  }
}

const SESSION_SELECT = {
  id: true,
  ip: true,
  city: true,
  country: true,
  userAgent: true,
  createdAt: true,
  lastActiveAt: true,
  revokedAt: true,
  revokedReason: true,
  device: { select: { name: true, status: true } },
} as const;

type SessionRow = {
  id: string;
  ip: string | null;
  city: string | null;
  country: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastActiveAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
  device: { name: string; status: string } | null;
};

function shapeSession(s: SessionRow, currentSid: string | null) {
  const ua = s.userAgent ?? "";
  const p = parseUserAgent(ua);
  // "possible PWA" heuristics:
  //  • device row named "… (App)" — login recorded standalone display-mode (definite)
  //  • iOS standalone: iPhone/iPad UA with AppleWebKit but NO "Safari/" token
  //  • Android WebView/TWA: UA carries the "wv" marker
  const installedApp = Boolean(s.device?.name && s.device.name.includes("(App)"));
  const iosStandalone =
    /iPhone|iPad|iPod/i.test(ua) &&
    /AppleWebKit/i.test(ua) &&
    !/Safari\//i.test(ua) &&
    !/CriOS|FxiOS|EdgiOS/i.test(ua);
  const androidWebView = /Android/i.test(ua) && /\bwv\b/i.test(ua);
  const possiblePwa = installedApp || iosStandalone || androidWebView;

  const browserLabel = p.browser === "Browser" && possiblePwa ? "App" : p.browser;
  const summary = ua ? `${browserLabel} on ${osLabel(p)}` : s.device?.name ?? "Unknown device";

  return {
    id: s.id,
    summary,
    os: ua ? p.os : "Device",
    browser: ua ? p.browser : "Browser",
    possiblePwa,
    deviceName: s.device?.name ?? null,
    ip: s.ip,
    city: s.city,
    country: s.country,
    createdAt: s.createdAt.toISOString(),
    lastActiveAt: s.lastActiveAt.toISOString(),
    // Is this the CALLING admin's own session? (UI warns before self force-logout.)
    current: currentSid !== null && s.id === currentSid,
    revokedAt: s.revokedAt ? s.revokedAt.toISOString() : null,
    revokedReason: s.revokedReason ?? null,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: targetId } = await params;
  const me = await requireRole("ADMIN");
  if (isHrOnly(me)) {
    return NextResponse.json({ error: "HR-only admins cannot manage CRM sessions" }, { status: 403 });
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, name: true, email: true, isSuperAdmin: true, passwordChangedAt: true },
  });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const now = new Date();
  const currentSid = await callerSid(req);
  const [active, recentRevoked] = await Promise.all([
    prisma.userSession.findMany({
      where: { userId: targetId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { lastActiveAt: "desc" },
      select: SESSION_SELECT,
    }),
    prisma.userSession.findMany({
      where: { userId: targetId, revokedAt: { not: null } },
      orderBy: { revokedAt: "desc" },
      take: 5,
      select: SESSION_SELECT,
    }),
  ]);

  return NextResponse.json({
    ok: true,
    user: { id: target.id, name: target.name, email: target.email, isSuperAdmin: target.isSuperAdmin },
    sessions: active.map((s) => shapeSession(s, currentSid)),
    recentRevoked: recentRevoked.map((s) => shapeSession(s, currentSid)),
    // No password epoch set yet → LEGACY no-sid cookies from before the device-
    // security rollout would still be alive (they never appear in the list above).
    // Lets the UI explain what "Force Logout All" will additionally kill.
    legacyCookieRisk: target.passwordChangedAt === null,
    // Only a super-admin may force-logout a super-admin.
    canForceLogout: !target.isSuperAdmin || Boolean(me.isSuperAdmin),
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: targetId } = await params;
  const me = await requireRole("ADMIN");
  if (isHrOnly(me)) {
    return NextResponse.json({ error: "HR-only admins cannot manage CRM sessions" }, { status: 403 });
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, name: true, email: true, isSuperAdmin: true },
  });
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (target.isSuperAdmin && !me.isSuperAdmin) {
    return NextResponse.json({ error: "Only a super-admin can force-logout a super-admin" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const sessionId = typeof body.sessionId === "string" && body.sessionId ? body.sessionId : null;
  const currentSid = await callerSid(req);
  const now = new Date();

  // ── Single-session revoke ── that row only. NEVER bump the password epoch here —
  // it would log the user out of every device, not just this one.
  if (sessionId) {
    const session = await prisma.userSession.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true, revokedAt: true },
    });
    if (!session || session.userId !== targetId) {
      return NextResponse.json({ error: "Session not found for this user" }, { status: 404 });
    }
    if (session.revokedAt) {
      return NextResponse.json({ ok: true, revoked: 0, epochBumped: false, selfLogout: false, alreadyRevoked: true });
    }
    await prisma.userSession.update({
      where: { id: sessionId },
      data: { revokedAt: now, revokedReason: `admin-revoke by ${me.name}` },
    });
    await audit({
      userId: me.id,
      action: "user.force-logout",
      entity: "User",
      entityId: targetId,
      meta: { target: target.email, sessionsRevoked: 1, mode: "single", sessionId },
      request: reqMeta(req),
    });
    return NextResponse.json({
      ok: true,
      revoked: 1,
      epochBumped: false,
      selfLogout: currentSid !== null && sessionId === currentSid,
    });
  }

  // ── FORCE LOGOUT ALL ── revoke every active session row + stamp the password
  // epoch (kills legacy no-sid cookies too). Password hash untouched. Device rows
  // untouched (approval is a separate system).
  const revoked = await prisma.userSession.updateMany({
    where: { userId: targetId, revokedAt: null },
    data: { revokedAt: now, revokedReason: `admin-force-logout by ${me.name}` },
  });
  await prisma.user.update({
    where: { id: targetId },
    data: { passwordChangedAt: now, sessionEpoch: { increment: 1 } },
  });

  // End live presence sessions (defensive: PresenceSession is a new feature and
  // prod schema can lag — a missing table must never block a force logout).
  let presenceEnded = 0;
  try {
    const r = await prisma.presenceSession.updateMany({
      where: { userId: targetId, endedAt: null },
      data: { endedAt: now },
    });
    presenceEnded = r.count;
  } catch {
    // best-effort only
  }

  await audit({
    userId: me.id,
    action: "user.force-logout",
    entity: "User",
    entityId: targetId,
    meta: { target: target.email, sessionsRevoked: revoked.count, mode: "all", presenceEnded },
    request: reqMeta(req),
  });

  return NextResponse.json({
    ok: true,
    revoked: revoked.count,
    epochBumped: true,
    presenceEnded,
    selfLogout: targetId === me.id,
  });
}
