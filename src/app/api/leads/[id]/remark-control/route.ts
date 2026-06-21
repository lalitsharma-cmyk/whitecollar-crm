import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { canTouchLead } from "@/lib/leadScope";

/**
 * Conversation moderation API — LALIT-ONLY (User.canControlConversations).
 *
 * POST /api/leads/[id]/remark-control
 *   body: { remarkKeys: string[] | remarkKey: string, action, targetUserId?, reason? }
 *   actions: DELETE | RESTORE | HIDE_ALL | UNHIDE_ALL | HIDE_AGENT | UNHIDE_AGENT
 *   Upserts a RemarkVisibility overlay per remark and appends a RemarkAuditLog.
 *   NEVER edits Lead.remarks — the original text is always retained.
 *
 * GET /api/leads/[id]/remark-control?remarkKey=...
 *   Returns the audit log for the lead (optionally one remark).
 */

type Action = "DELETE" | "RESTORE" | "HIDE_ALL" | "UNHIDE_ALL" | "HIDE_AGENT" | "UNHIDE_AGENT" | "HIDE_TEAM" | "UNHIDE_TEAM";
const ACTIONS = new Set<Action>(["DELETE", "RESTORE", "HIDE_ALL", "UNHIDE_ALL", "HIDE_AGENT", "UNHIDE_AGENT", "HIDE_TEAM", "UNHIDE_TEAM"]);

function csvAdd(cur: string | null, id: string): string {
  const set = new Set((cur ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  set.add(id);
  return [...set].join(",");
}
function csvRemove(cur: string | null, id: string): string | null {
  const set = new Set((cur ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  set.delete(id);
  return [...set].join(",") || null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params;
  const me = await requireUser();

  // Lalit-only — explicit permission, NOT the ADMIN role.
  if (!me.canControlConversations) {
    return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  }
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, ownerId: true, forwardedTeam: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (!(await canTouchLead(me, lead))) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const action = String(body.action ?? "") as Action;
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : "";
  const targetUserId = typeof body.targetUserId === "string" && body.targetUserId ? body.targetUserId : null;
  const targetTeam = typeof body.targetTeam === "string" && body.targetTeam ? body.targetTeam : null;
  const remarkKeys: string[] = Array.isArray(body.remarkKeys)
    ? (body.remarkKeys as unknown[]).filter((k): k is string => typeof k === "string" && k.length > 0)
    : typeof body.remarkKey === "string" && body.remarkKey
      ? [body.remarkKey]
      : [];

  if (!ACTIONS.has(action)) return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  if (!remarkKeys.length) return NextResponse.json({ error: "No remarks specified" }, { status: 400 });
  if ((action === "HIDE_AGENT" || action === "UNHIDE_AGENT") && !targetUserId) {
    return NextResponse.json({ error: "Agent required for this action" }, { status: 400 });
  }
  if ((action === "HIDE_TEAM" || action === "UNHIDE_TEAM") && !targetTeam) {
    return NextResponse.json({ error: "Team required for this action" }, { status: 400 });
  }

  // Resolve the target name once (denormalized into the audit log).
  let targetName: string | null = targetTeam ? `${targetTeam} team` : null;
  if (targetUserId) {
    const u = await prisma.user.findUnique({ where: { id: targetUserId }, select: { name: true } });
    targetName = u?.name ?? null;
  }

  for (const remarkKey of remarkKeys) {
    const existing = await prisma.remarkVisibility.findUnique({
      where: { leadId_remarkKey: { leadId, remarkKey } },
    });
    const before = {
      deletedFromView: existing?.deletedFromView ?? false,
      hiddenFromAll: existing?.hiddenFromAll ?? false,
      hiddenFromUserIds: existing?.hiddenFromUserIds ?? null,
      hiddenFromTeams: existing?.hiddenFromTeams ?? null,
    };
    const next = { ...before };
    switch (action) {
      case "DELETE":       next.deletedFromView = true; break;
      case "RESTORE":      next.deletedFromView = false; next.hiddenFromAll = false; next.hiddenFromUserIds = null; next.hiddenFromTeams = null; break;
      case "HIDE_ALL":     next.hiddenFromAll = true; break;
      case "UNHIDE_ALL":   next.hiddenFromAll = false; break;
      case "HIDE_AGENT":   next.hiddenFromUserIds = csvAdd(next.hiddenFromUserIds, targetUserId!); break;
      case "UNHIDE_AGENT": next.hiddenFromUserIds = csvRemove(next.hiddenFromUserIds, targetUserId!); break;
      case "HIDE_TEAM":    next.hiddenFromTeams = csvAdd(next.hiddenFromTeams, targetTeam!); break;
      case "UNHIDE_TEAM":  next.hiddenFromTeams = csvRemove(next.hiddenFromTeams, targetTeam!); break;
    }

    await prisma.remarkVisibility.upsert({
      where: { leadId_remarkKey: { leadId, remarkKey } },
      create: { leadId, remarkKey, ...next, reason: reason || null, updatedById: me.id },
      update: { ...next, reason: reason || null, updatedById: me.id },
    });

    await prisma.remarkAuditLog.create({
      data: {
        leadId,
        remarkKey,
        action,
        actorId: me.id,
        actorName: me.name,
        targetUserId,
        targetName,
        oldState: JSON.stringify(before),
        newState: JSON.stringify(next),
        reason: reason || null,
      },
    });
  }

  return NextResponse.json({ ok: true, count: remarkKeys.length });
}

/**
 * PATCH /api/leads/[id]/remark-control   body: { text: string, reason?: string }
 *
 * Lalit-ONLY (canControlConversations) edit of the Raw History text (Lead.rawRemarks
 * + the display mirror Lead.remarks). The ENTIRE previous text is preserved verbatim
 * in RemarkAuditLog (action EDIT_RAW, oldState) — raw history is NEVER hard-deleted.
 * Smart Timeline re-derives from the corrected text, and the assigned agent sees the
 * corrected version (it's the same field everyone reads). An "Edited by Lalit" badge
 * is shown to Admin/Super-Admin only, derived from this audit row.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params;
  const me = await requireUser();
  // Imported Raw History has no per-line author/date, so an agent has no "own +
  // same-day" signal — editing the raw / Smart-Timeline source stays ADMIN-only
  // (Lalit, Samir, any ADMIN). Looser than the previous Lalit-only lock.
  if (me.role !== "ADMIN") {
    return NextResponse.json({ error: "Only an admin can edit Raw History / Smart Timeline." }, { status: 403 });
  }
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    select: { id: true, ownerId: true, forwardedTeam: true, rawRemarks: true, remarks: true },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (!(await canTouchLead(me, lead))) return NextResponse.json({ error: "Lead not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const text = typeof body.text === "string" ? body.text.trim() : null;
  if (text == null) return NextResponse.json({ error: "Missing text" }, { status: 400 });
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 500) : null;
  const oldRaw = lead.rawRemarks ?? lead.remarks ?? "";
  if (oldRaw === text) return NextResponse.json({ ok: true, unchanged: true });

  // Preserve the FULL original verbatim before overwriting (audit backup).
  await prisma.remarkAuditLog.create({
    data: {
      leadId, remarkKey: "__raw__", action: "EDIT_RAW",
      actorId: me.id, actorName: me.name,
      oldState: oldRaw, newState: text, reason,
    },
  });
  await prisma.lead.update({ where: { id: leadId }, data: { rawRemarks: text, remarks: text } });
  return NextResponse.json({ ok: true });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params;
  const me = await requireUser();
  if (!me.canControlConversations) {
    return NextResponse.json({ error: "Not permitted" }, { status: 403 });
  }
  const remarkKey = new URL(req.url).searchParams.get("remarkKey");
  const logs = await prisma.remarkAuditLog.findMany({
    where: { leadId, ...(remarkKey ? { remarkKey } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return NextResponse.json({ logs });
}
