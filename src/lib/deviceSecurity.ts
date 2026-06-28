import "server-only";
import { prisma } from "@/lib/prisma";
import { parseUserAgent, deviceName, contextLabel, osLabel, locationLabel, type RequestMeta } from "@/lib/device";
import { notifyRoles } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { NotifKind } from "@prisma/client";
import { SESSION_TTL_SECS } from "@/lib/session";

// MONITOR (default): capture devices, alert admins, but NEVER block — so rolling
// this out can't lock anyone out. Flip DEVICE_SECURITY_ENFORCE=true to block
// unapproved devices (Phase B). "Admin" in alerts = ADMIN role, which includes
// Super-Admins (isSuperAdmin is a flag on an ADMIN).
export function enforcementOn(): boolean {
  return process.env.DEVICE_SECURITY_ENFORCE === "true";
}

// Default policy: 1 mobile + 1 desktop = 2, plus admin-granted extras (e.g. a tablet).
// This is the CAP on APPROVED devices (enforced at approval time), NOT an
// auto-approve threshold. Exported so the admin approve action shares the rule.
export function deviceLimit(extra: number): number {
  return 2 + Math.max(0, extra || 0);
}

export type DeviceDecision =
  | { ok: true; deviceRowId: string }
  | { ok: false; reason: "pending"; deviceRowId: string }
  | { ok: false; reason: "blocked" };

/**
 * Run after the password is verified. Registers/looks up the device, applies the
 * policy, and fires admin alerts. In MONITOR mode it always returns ok (and
 * auto-approves). In ENFORCE mode, a new device beyond the limit returns
 * { ok:false, reason:"pending" } and the caller must show "sent to admin".
 * Super-Admins are always allowed (safety hatch — Lalit can't lock himself out).
 */
export async function evaluateDevice(opts: {
  user: { id: string; name: string; deviceLimitExtra: number; isSuperAdmin: boolean };
  deviceId: string;
  meta: RequestMeta;
  // Browser context discriminator — on iOS an installed PWA has its OWN cookie +
  // localStorage jar (separate from Safari), so it already gets a separate deviceId
  // and Device row; this flag just LABELS it ("Safari · App") so the admin can tell
  // them apart. NOT a separate identity mechanism — storage isolation is.
  pwa?: boolean;
}): Promise<DeviceDecision> {
  const { user, deviceId, meta, pwa } = opts;
  const p = parseUserAgent(meta.ua);
  const name = deviceName(user.name, p, { pwa });
  const browser = contextLabel(p, pwa);   // "Safari" | "Chrome" | "Safari · App"
  const os = osLabel(p);                   // "iPhone 17.2" | "Windows 10/11" | "Mac 14.5"
  const now = new Date();

  let device = await prisma.device.findUnique({
    where: { userId_deviceId: { userId: user.id, deviceId } },
  });

  // Explicit block always denies — even in monitor mode.
  if (device?.status === "BLOCKED") {
    await audit({ userId: user.id, action: "auth.device.blocked_attempt", entity: "Device", entityId: device.id, meta: { ip: meta.ip, name } });
    return { ok: false, reason: "blocked" };
  }

  // Known + approved → touch last-seen and allow. Also refresh name/browser/os so
  // existing rows self-heal to the enriched labels (OS version + Safari/App context)
  // on next login — no migration needed.
  if (device?.status === "APPROVED") {
    await prisma.device.update({ where: { id: device.id }, data: { name, browser, os, type: p.type, lastSeenAt: now, lastIp: meta.ip, lastCity: meta.city ?? null, lastCountry: meta.country ?? null } });
    return { ok: true, deviceRowId: device.id };
  }

  // New or still-pending device. Under ENFORCEMENT every new device must be
  // ADMIN-APPROVED — the 2/3 limit is a CAP enforced at approval time, NOT an
  // auto-approve threshold. Auto-approve only in monitor mode or for a super-admin
  // (safety hatch — Lalit/admins can never be locked out).
  const autoApprove = !enforcementOn() || user.isSuperAdmin;

  if (!device) {
    device = await prisma.device.create({
      data: {
        userId: user.id, deviceId, name, type: p.type, browser, os,
        firstIp: meta.ip, lastIp: meta.ip, lastCity: meta.city ?? null, lastCountry: meta.country ?? null,
        status: autoApprove ? "APPROVED" : "PENDING",
        approvedAt: autoApprove ? now : null,
        lastSeenAt: now,
      },
    });
  } else {
    device = await prisma.device.update({
      where: { id: device.id },
      data: {
        name, type: p.type, browser, os, lastSeenAt: now,
        lastIp: meta.ip, lastCity: meta.city ?? null, lastCountry: meta.country ?? null,
        ...(autoApprove ? { status: "APPROVED", approvedAt: now } : {}),
      },
    });
  }

  const blocking = enforcementOn() && !autoApprove;
  // Alert admins (+ super-admins) on every new device.
  await notifyRoles(["ADMIN"], {
    kind: NotifKind.SYSTEM,
    severity: "WARNING",
    title: blocking ? `🔐 New device needs approval — ${user.name}` : `🔐 New device login — ${user.name}`,
    body: `${name} · ${p.os}/${p.browser} · IP ${meta.ip} · ${locationLabel(meta.city, meta.country)}${blocking ? " — open Devices to approve or reject." : ""}`,
    linkUrl: "/admin/devices",
  }).catch(() => {});
  await audit({
    userId: user.id,
    action: blocking ? "auth.device.pending" : "auth.device.new_autoapproved",
    entity: "Device", entityId: device.id,
    meta: { name, type: p.type, browser: p.browser, os: p.os, ip: meta.ip, city: meta.city, country: meta.country },
  });

  if (autoApprove) return { ok: true, deviceRowId: device.id };
  return { ok: false, reason: "pending", deviceRowId: device.id };
}

/** Create a DB-backed session row and return its id (goes into the cookie as `sid`). */
export async function createSession(userId: string, deviceRef: string | null, meta: RequestMeta): Promise<string> {
  const s = await prisma.userSession.create({
    data: {
      userId,
      deviceRef,
      ip: meta.ip,
      city: meta.city ?? null,
      country: meta.country ?? null,
      userAgent: meta.ua.slice(0, 400),
      expiresAt: new Date(Date.now() + SESSION_TTL_SECS * 1000),
    },
  });
  return s.id;
}
