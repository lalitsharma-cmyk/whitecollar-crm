// Append-only audit log helper.
//
// We log security-sensitive actions so a leak can be traced back to a user
// + timestamp. Hooked into:
//   - CSV exports
//   - Bulk reassign / delete
//   - Single lead deletion
//   - User role changes
//   - Login (success + failure)
//   - Admin actions (set Acefone id, etc.)
//
// Best-effort: any audit failure is swallowed so we never block the user's
// request because the log table is down.

import { prisma } from "@/lib/prisma";

export interface AuditEntry {
  userId?: string | null;
  action: string;       // dot.notation: "lead.export" / "user.role-change" / "auth.login.fail"
  entity: string;       // "Lead" / "User" / "System"
  entityId?: string | null;
  meta?: Record<string, unknown>;
  /** Optional IP/UA — included in meta when given. */
  request?: { ip?: string | null; userAgent?: string | null };
}

export async function audit(e: AuditEntry): Promise<void> {
  try {
    const meta = { ...(e.meta ?? {}) } as Record<string, unknown>;
    if (e.request?.ip) meta.ip = e.request.ip;
    if (e.request?.userAgent) meta.ua = e.request.userAgent.slice(0, 200);
    await prisma.auditLog.create({
      data: {
        userId: e.userId ?? null,
        action: e.action,
        entity: e.entity,
        entityId: e.entityId ?? null,
        meta: Object.keys(meta).length ? JSON.stringify(meta) : null,
      },
    });
  } catch {
    // Never throw from audit — surfacing this would degrade UX without protecting anything.
  }
}

/** Pulls best-effort IP + UA from a Next request. */
export function reqMeta(req: { headers: Headers } | Request): { ip: string | null; userAgent: string | null } {
  const h = req.headers;
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    null;
  return { ip, userAgent: h.get("user-agent") };
}
