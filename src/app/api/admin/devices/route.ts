import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";
import { notify } from "@/lib/notify";
import { NotifKind } from "@prisma/client";

// Admin (incl. Super-Admin — requireRole("ADMIN") covers them) device controls.
//   approve | reject | block  → set device status (reject/block also kills its sessions)
//   remove                    → delete the device + revoke its sessions
//   logout_device             → revoke all sessions on one device (keeps it approved)
//   logout_all                → revoke ALL of a user's sessions (kill switch)
//   revoke_session            → revoke one session
export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const now = new Date();
  const meta = reqMeta(req);

  if (action === "approve" || action === "reject" || action === "block") {
    const id = String(body.deviceId ?? "");
    const device = await prisma.device.findUnique({ where: { id } });
    if (!device) return NextResponse.json({ error: "Device not found" }, { status: 404 });
    const status = action === "approve" ? "APPROVED" : "BLOCKED";
    await prisma.device.update({
      where: { id },
      data: { status, approvedById: me.id, approvedAt: action === "approve" ? now : null },
    });
    if (status === "BLOCKED") {
      await prisma.userSession.updateMany({ where: { deviceRef: id, revokedAt: null }, data: { revokedAt: now, revokedReason: action } });
    }
    await audit({ userId: me.id, action: `device.${action}`, entity: "Device", entityId: id, meta: { ownerId: device.userId, name: device.name }, request: meta });
    notify({
      userId: device.userId,
      kind: NotifKind.SYSTEM,
      severity: action === "approve" ? "INFO" : "WARNING",
      title: action === "approve" ? `✅ Device approved: ${device.name}` : `⛔ Device ${action}ed: ${device.name}`,
      body: action === "approve" ? "You can now sign in from this device." : "Access from this device has been blocked by an admin.",
    }).catch(() => {});
    return NextResponse.json({ ok: true });
  }

  if (action === "remove") {
    const id = String(body.deviceId ?? "");
    await prisma.userSession.updateMany({ where: { deviceRef: id, revokedAt: null }, data: { revokedAt: now, revokedReason: "device_removed" } });
    await prisma.device.delete({ where: { id } }).catch(() => {});
    await audit({ userId: me.id, action: "device.remove", entity: "Device", entityId: id, request: meta });
    return NextResponse.json({ ok: true });
  }

  if (action === "logout_device") {
    const id = String(body.deviceId ?? "");
    const r = await prisma.userSession.updateMany({ where: { deviceRef: id, revokedAt: null }, data: { revokedAt: now, revokedReason: "admin_logout_device" } });
    await audit({ userId: me.id, action: "device.logout_device", entity: "Device", entityId: id, meta: { count: r.count }, request: meta });
    return NextResponse.json({ ok: true, count: r.count });
  }

  if (action === "logout_all") {
    const userId = String(body.userId ?? "");
    const r = await prisma.userSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now, revokedReason: "admin_logout_all" } });
    await audit({ userId: me.id, action: "device.logout_all", entity: "User", entityId: userId, meta: { count: r.count }, request: meta });
    return NextResponse.json({ ok: true, count: r.count });
  }

  if (action === "logout_everyone") {
    // GLOBAL kill switch — revoke EVERY active session for EVERY user (rollout
    // step 1: force a clean re-login so each real device is re-captured). The
    // actor's own session is included; they simply log back in.
    const r = await prisma.userSession.updateMany({ where: { revokedAt: null }, data: { revokedAt: now, revokedReason: "admin_logout_everyone" } });
    await audit({ userId: me.id, action: "device.logout_everyone", entity: "User", meta: { count: r.count }, request: meta });
    return NextResponse.json({ ok: true, count: r.count });
  }

  if (action === "set_device_limit") {
    // Per-user EXTRA device allowance on top of the default 2 (so extra=1 → 3 max).
    // Clamped 0–3 (total 2–5) to keep it sane.
    const userId = String(body.userId ?? "");
    const extra = Math.max(0, Math.min(3, Math.round(Number(body.extra) || 0)));
    const u = await prisma.user.update({ where: { id: userId }, data: { deviceLimitExtra: extra }, select: { id: true, name: true } });
    await audit({ userId: me.id, action: "device.set_limit", entity: "User", entityId: userId, meta: { extra, totalAllowed: 2 + extra, name: u.name }, request: meta });
    return NextResponse.json({ ok: true, extra, totalAllowed: 2 + extra });
  }

  if (action === "revoke_session") {
    const id = String(body.sessionId ?? "");
    await prisma.userSession.update({ where: { id }, data: { revokedAt: now, revokedReason: "admin_revoke" } }).catch(() => {});
    await audit({ userId: me.id, action: "device.revoke_session", entity: "UserSession", entityId: id, request: meta });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
