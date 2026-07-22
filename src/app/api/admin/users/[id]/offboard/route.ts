// Admin → User Management → "Mark as Left Organization".
//   GET  → workload preview (counts to show BEFORE confirming).
//   POST → execute the offboarding (lock account + reassign workload + audit).
// ADMIN/Super-Admin only; the privilege-escalation guard blocks touching another
// admin/super-admin. Reuses the shared offboarding engine (lib/offboarding.ts).
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, userManagementDenial } from "@/lib/auth";
import { reqMeta, audit } from "@/lib/audit";
import { offboardingWorkloadPreview, offboardUser, statusLocksAccount } from "@/lib/offboarding";
import type { EmploymentStatus } from "@prisma/client";

const VALID_STATUSES: EmploymentStatus[] = ["ON_LEAVE", "TEMPORARILY_DISABLED", "SUSPENDED", "LEFT_ORGANIZATION"];

async function guard(id: string) {
  const me = await requireRole("ADMIN");
  if (id === me.id) return { error: NextResponse.json({ error: "You cannot offboard your own account." }, { status: 400 }) };
  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, name: true, isSuperAdmin: true, role: true } });
  if (!target) return { error: NextResponse.json({ error: "User not found" }, { status: 404 }) };
  const denied = userManagementDenial(me, target);
  if (denied) return { error: NextResponse.json({ error: denied.message }, { status: denied.code }) };
  return { me, target };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if (g.error) return g.error;
  const preview = await offboardingWorkloadPreview(id);
  return NextResponse.json({ ok: true, user: { id: g.target!.id, name: g.target!.name }, preview });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard(id);
  if (g.error) return g.error;
  const me = g.me!;

  const body = await req.json().catch(() => ({}));
  const status = String(body.status ?? "LEFT_ORGANIZATION") as EmploymentStatus;
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: "Invalid employment status." }, { status: 400 });
  }
  const reassignMode = body.reassignMode === "reassign_user" ? "reassign_user" : "admin_queue";
  const lwd = body.lastWorkingDate ? new Date(String(body.lastWorkingDate)) : null;

  const result = await offboardUser({
    targetUserId: id,
    actorId: me.id,
    status,
    lastWorkingDate: lwd && !isNaN(lwd.getTime()) ? lwd : null,
    reason: body.reason ? String(body.reason).slice(0, 500) : null,
    note: body.note ? String(body.note).slice(0, 2000) : null,
    reassignMode,
    reassignToUserId: body.reassignToUserId ? String(body.reassignToUserId) : null,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  const { ok: _ok, error: _e, ...detail } = result;

  // Security audit of WHO offboarded WHOM (the offboard engine also audits the
  // detail; this records the request context).
  await audit({
    userId: me.id, action: "user.offboard.request", entity: "User", entityId: id,
    meta: { status, reassignMode, ...detail }, request: reqMeta(req),
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    message: statusLocksAccount(status)
      ? `${g.target!.name} marked ${status.replace(/_/g, " ").toLowerCase()} — access revoked, ${result.leadsMoved} lead(s)${result.buyersMoved ? ` + ${result.buyersMoved} buyer(s)` : ""} reassigned.`
      : `${g.target!.name} set to ${status.replace(/_/g, " ").toLowerCase()}.`,
    ...detail,
  });
}
