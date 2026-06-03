import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, requireUser } from "@/lib/auth";
import { assignLeadTo } from "@/lib/leadIngest";
import { audit, reqMeta } from "@/lib/audit";
import { leadScopeWhere } from "@/lib/leadScope";
import { LeadStatus, ActivityType, ActivityStatus } from "@prisma/client";
import { crossTeamWarning, normalizeTeam } from "@/lib/teamRouting";

// Allow-list mirrors /api/leads/[id]/reject — keep these in sync.
const REJECT_REASONS = new Set([
  "NOT_INTERESTED", "JUST_SEARCHING", "BY_MISTAKE_INQUIRY", "DROP_THE_PLAN",
  "LOW_BUDGET", "FUND_ISSUE", "OTHER_LOCATION", "BROKER", "ALREADY_BOUGHT",
  "LEASING_REQUIREMENT", "COMMERCIAL_REQUIREMENT", "INVALID_NUMBER",
  "NUMBER_CHANGED", "NEVER_RESPONDED", "PASSED_AWAY", "WAR_FEAR",
  "WAITING_FOR_PROPERTY_SALE", "NOT_ABLE_TO_BUY", "OTHER",
  // Legacy
  "LOOK_AFTER_2_YEARS", "TRANSFER_TO_INDIA_TEAM", "TRANSFER_TO_DUBAI_TEAM",
]);

export async function POST(req: NextRequest) {
  // Most actions are agent-safe (scoped to leads they own). Reassign is the
  // only action restricted to ADMIN/MANAGER — gated inside its branch.
  const me = await requireUser();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  // Accept either `ids` (existing callers) or `leadIds` (new spec) for the
  // selection list — both map to the same array of lead ids.
  const rawIds = Array.isArray(body.ids)
    ? body.ids
    : Array.isArray(body.leadIds)
    ? body.leadIds
    : [];
  const ids: string[] = rawIds.filter((x: unknown) => typeof x === "string");
  if (ids.length === 0) return NextResponse.json({ error: "No leads selected" }, { status: 400 });

  // Scope every action through leadScopeWhere so agents can only touch leads
  // they own. We intersect the caller-supplied ids with the visible set.
  const scope = await leadScopeWhere(me);

  if (action === "reassign") {
    // Reassign is admin/manager only — agents can't hand off their leads.
    if (me.role !== "ADMIN" && me.role !== "MANAGER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const userId = String(body.assignToUserId ?? body.ownerId ?? body.userId ?? "");
    if (!userId) return NextResponse.json({ error: "assignToUserId required" }, { status: 400 });
    // For MANAGER: verify target user exists and shares the same team as the
    // manager — prevents cross-team reassigns being silently allowed at the
    // API layer (the frontend only soft-warns, but we hard-block here).
    if (me.role === "MANAGER") {
      const targetUser = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, team: true, active: true } });
      if (!targetUser || !targetUser.active) {
        return NextResponse.json({ error: "Target user not found" }, { status: 404 });
      }
      const meTeam = normalizeTeam(me.team);
      const targetTeam = normalizeTeam(targetUser.team);
      if (meTeam && targetTeam && meTeam !== targetTeam) {
        return NextResponse.json({ error: "Managers can only reassign leads to agents on their own team" }, { status: 403 });
      }
    }
    // Restrict to leads the caller is allowed to touch (scope applies even
    // for ADMIN — scope is {} for admin so they get the full set).
    const visible = await prisma.lead.findMany({
      where: { id: { in: ids }, ...scope },
      select: { id: true, forwardedTeam: true },
    });
    const visibleIds = visible.map(v => v.id);
    let done = 0;
    let crossTeamCount = 0;
    for (const lead of visible) {
      try {
        // Write routingMethod = "manual" on the lead if not yet set.
        if (!normalizeTeam(lead.forwardedTeam) || !lead.forwardedTeam) {
          // No team yet — mark provenance as manual so it's traceable.
          await prisma.lead.update({ where: { id: lead.id }, data: { routingMethod: "manual" } });
        }
        // Track cross-team warnings (soft — assignment still proceeds).
        const w = crossTeamWarning(me.team, lead.forwardedTeam);
        if (w) crossTeamCount++;
        await assignLeadTo(lead.id, userId, "bulk reassign");
        done++;
      }
      catch {}
    }
    await audit({ userId: me.id, action: "lead.bulk.reassign", entity: "Lead",
      meta: { count: done, toUserId: userId, crossTeamWarnings: crossTeamCount, leadIds: visibleIds.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({
      ok: true,
      reassigned: done,
      updated: done,
      ...(crossTeamCount > 0 ? { crossTeamWarnings: crossTeamCount, crossTeamWarningMessage: `${crossTeamCount} lead${crossTeamCount === 1 ? "" : "s"} were assigned across teams. Please confirm this was intentional.` } : {}),
    });
  }

  if (action === "delete") {
    // Delete stays admin/manager only — preserves the pre-existing contract.
    await requireRole("ADMIN", "MANAGER");
    // Cascade delete via Prisma onDelete: Cascade on Lead-child relations
    const r = await prisma.lead.deleteMany({ where: { id: { in: ids }, ...scope } });
    await audit({ userId: me.id, action: "lead.bulk.delete", entity: "Lead",
      meta: { count: r.count, leadIds: ids.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, deleted: r.count });
  }

  if (action === "change_stage") {
    await requireRole("ADMIN", "MANAGER");
    const status = String(body.status ?? "");
    const r = await prisma.lead.updateMany({ where: { id: { in: ids }, ...scope }, data: { status: status as LeadStatus } });
    await audit({ userId: me.id, action: "lead.bulk.stage", entity: "Lead",
      meta: { count: r.count, status, leadIds: ids.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, updated: r.count });
  }

  if (action === "tag") {
    // Add one or more tags to each selected lead. Tags column is a
    // comma-separated string (legacy SQLite shape), so we read-modify-write
    // per row to merge + dedupe. Agents can tag their own leads.
    const addTags: string[] = Array.isArray(body.addTags)
      ? body.addTags.filter((t: unknown) => typeof t === "string" && t.trim().length > 0).map((t: string) => t.trim())
      : [];
    if (addTags.length === 0) {
      return NextResponse.json({ error: "addTags required" }, { status: 400 });
    }
    const rows = await prisma.lead.findMany({
      where: { id: { in: ids }, ...scope },
      select: { id: true, tags: true },
    });
    let updated = 0;
    for (const row of rows) {
      const existing = (row.tags ?? "")
        .split(",")
        .map(t => t.trim())
        .filter(t => t.length > 0);
      const merged = Array.from(new Set([...existing, ...addTags]));
      // Skip writes when nothing actually changed — saves Postgres trips on
      // re-tagging an already-tagged batch.
      if (merged.length === existing.length && merged.every(m => existing.includes(m))) continue;
      await prisma.lead.update({
        where: { id: row.id },
        data: { tags: merged.join(",") },
      });
      updated++;
    }
    await audit({ userId: me.id, action: "lead.bulk.tag", entity: "Lead",
      meta: { count: updated, addTags, leadIds: rows.map(r => r.id).slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, updated });
  }

  if (action === "reject") {
    // Bulk-mark leads LOST with a structured reason — same allow-list as the
    // single-lead reject endpoint. Agents can reject their own leads.
    const reason = String(body.reason ?? "").toUpperCase();
    const note = String(body.note ?? "").trim();
    if (!REJECT_REASONS.has(reason)) {
      return NextResponse.json({ error: "Invalid reason" }, { status: 400 });
    }
    const rows = await prisma.lead.findMany({
      where: { id: { in: ids }, ...scope },
      select: { id: true },
    });
    const visibleIds = rows.map(r => r.id);
    const now = new Date();
    const r = await prisma.lead.updateMany({
      where: { id: { in: visibleIds } },
      data: {
        status: LeadStatus.LOST,
        rejectionReason: reason,
        rejectionNote: note || null,
        rejectedAt: now,
        rejectedById: me.id,
        followupDate: null,
        followupReminderSentAt: null,
        lastTouchedAt: now,
      },
    });
    // Best-effort timeline entries — failures don't block the bulk update.
    for (const id of visibleIds) {
      try {
        await prisma.activity.create({
          data: {
            leadId: id,
            userId: me.id,
            type: ActivityType.NOTE,
            status: ActivityStatus.DONE,
            title: `❌ Rejected · ${reason.replaceAll("_", " ")}`,
            description: note || null,
            completedAt: now,
          },
        });
      } catch {}
    }
    await audit({ userId: me.id, action: "lead.bulk.reject", entity: "Lead",
      meta: { count: r.count, reason, leadIds: visibleIds.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, updated: r.count });
  }

  if (action === "set_status") {
    // Set status is admin/manager only — agents can't bulk-move pipeline stages.
    if (me.role !== "ADMIN" && me.role !== "MANAGER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const statusValue = String(body.status ?? "").trim();
    if (!statusValue || !(Object.values(LeadStatus) as string[]).includes(statusValue)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    const r = await prisma.lead.updateMany({
      where: { id: { in: ids }, ...scope },
      data: { status: statusValue as LeadStatus, lastTouchedAt: new Date() },
    });
    await audit({
      userId: me.id, action: "lead.bulk.status", entity: "Lead",
      meta: { count: r.count, status: statusValue, leadIds: ids.slice(0, 50) },
      request: reqMeta(req),
    });
    return NextResponse.json({ ok: true, updated: r.count });
  }

  if (action === "set_followup") {
    const dateStr = String(body.followupDate ?? "").trim();
    const followupDate = dateStr ? new Date(dateStr) : null;
    if (dateStr && isNaN(followupDate!.getTime())) {
      return NextResponse.json({ error: "Invalid followupDate" }, { status: 400 });
    }
    const r = await prisma.lead.updateMany({
      where: { id: { in: ids }, ...scope },
      data: {
        followupDate: followupDate,
        lastTouchedAt: new Date(),
      },
    });
    await audit({
      userId: me.id, action: "lead.bulk.followup", entity: "Lead",
      meta: { count: r.count, followupDate: dateStr, leadIds: ids.slice(0, 50) },
      request: reqMeta(req),
    });
    return NextResponse.json({ ok: true, updated: r.count });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
