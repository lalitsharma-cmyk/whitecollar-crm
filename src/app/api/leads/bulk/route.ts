import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole, requireUser } from "@/lib/auth";
import { assignLeadTo } from "@/lib/leadIngest";
import { audit, reqMeta } from "@/lib/audit";
import { leadScopeWhere } from "@/lib/leadScope";
import { LeadStatus, LeadSource, ActivityType, ActivityStatus } from "@prisma/client";
import { crossTeamWarning, normalizeTeam } from "@/lib/teamRouting";
import { parseBudget } from "@/lib/budgetParse";

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
      select: { id: true, forwardedTeam: true, ownerId: true },
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
        // Audit history — capture the owner From → To (assignment history).
        if (lead.ownerId !== userId) {
          prisma.leadFieldHistory.create({ data: { leadId: lead.id, field: "ownerId", oldValue: lead.ownerId, newValue: userId, changedById: me.id, source: "reassign" } }).catch(() => {});
        }
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
    // SOFT delete, Super-Admin (Lalit) ONLY — mirrors the single Delete Lead
    // (/api/leads/[id]/delete). Leads are archived (deletedAt set), hidden via
    // leadScopeWhere, and fully restorable. We NEVER hard-delete in bulk: the
    // previous deleteMany() permanently cascaded child records — far too risky
    // for a one-click button.
    if (!me.isSuperAdmin) {
      return NextResponse.json({ error: "Only the Super Admin can delete leads." }, { status: 403 });
    }
    const now = new Date();
    const rows = await prisma.lead.findMany({ where: { id: { in: ids }, ...scope }, select: { id: true, name: true } });
    const targetIds = rows.map((x) => x.id);
    const r = await prisma.lead.updateMany({ where: { id: { in: targetIds } }, data: { deletedAt: now, deletedById: me.id } });
    await audit({ userId: me.id, action: "lead.bulk.delete", entity: "Lead",
      meta: { count: r.count, soft: true, leadIds: targetIds.slice(0, 50), leadNames: rows.map((x) => x.name).slice(0, 50) }, request: reqMeta(req) });
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
    const beforeFu = await prisma.lead.findMany({ where: { id: { in: ids }, ...scope }, select: { id: true, followupDate: true } });
    const r = await prisma.lead.updateMany({
      where: { id: { in: ids }, ...scope },
      data: {
        followupDate: followupDate,
        lastTouchedAt: new Date(),
      },
    });
    // Audit history — old→new follow-up date per changed lead.
    {
      const newIso = followupDate ? followupDate.toISOString() : null;
      const hist = beforeFu
        .filter((b) => (b.followupDate ? b.followupDate.toISOString() : null) !== newIso)
        .map((b) => ({ leadId: b.id, field: "followupDate", oldValue: b.followupDate ? b.followupDate.toISOString() : null, newValue: newIso, changedById: me.id, source: "bulk" }));
      if (hist.length) prisma.leadFieldHistory.createMany({ data: hist }).catch(() => {});
    }
    await audit({
      userId: me.id, action: "lead.bulk.followup", entity: "Lead",
      meta: { count: r.count, followupDate: dateStr, leadIds: ids.slice(0, 50) },
      request: reqMeta(req),
    });
    return NextResponse.json({ ok: true, updated: r.count });
  }

  if (action === "set_fields") {
    // ADMIN-only bulk edit of Source / Budget / Project. Each is optional — set
    // only the fields provided. Scoped through leadScopeWhere like every action.
    if (me.role !== "ADMIN") {
      return NextResponse.json({ error: "Only an admin can bulk-edit source, budget, or project." }, { status: 403 });
    }
    const data: Record<string, unknown> = {};
    if (typeof body.source === "string" && body.source) {
      if (!(Object.values(LeadSource) as string[]).includes(body.source)) {
        return NextResponse.json({ error: "Invalid source" }, { status: 400 });
      }
      data.source = body.source;
    }
    if (typeof body.budget === "string" && body.budget.trim()) {
      const n = parseBudget(body.budget);
      if (n == null) return NextResponse.json({ error: "Couldn't parse budget — try 2.5M, 30L, 3Cr, or digits." }, { status: 400 });
      data.budgetMin = n;
      data.budgetMax = null; // single uniform value, no garbage range
    }
    // Resolve the visible (scoped) lead ids once.
    const visible = await prisma.lead.findMany({ where: { id: { in: ids }, ...scope }, select: { id: true } });
    const visibleIds = visible.map(v => v.id);
    let updated = 0;
    if (Object.keys(data).length) {
      data.lastTouchedAt = new Date();
      const r = await prisma.lead.updateMany({ where: { id: { in: visibleIds } }, data });
      updated = r.count;
    }
    // Project — link the leads to a Project (matched by name) via LeadProject.
    let projectLinked = 0;
    if (typeof body.project === "string" && body.project.trim()) {
      const proj = await prisma.project.findFirst({
        where: { name: { equals: body.project.trim(), mode: "insensitive" } },
        select: { id: true },
      });
      if (!proj) return NextResponse.json({ error: `Project "${body.project}" not found.` }, { status: 400 });
      const res = await prisma.leadProject.createMany({
        data: visibleIds.map((leadId) => ({ leadId, projectId: proj.id, sourceType: "MANUAL" })),
        skipDuplicates: true,
      });
      projectLinked = res.count;
    }
    if (!updated && !projectLinked) {
      return NextResponse.json({ error: "Nothing to update — pick at least one field." }, { status: 400 });
    }
    await audit({ userId: me.id, action: "lead.bulk.fields", entity: "Lead",
      meta: { count: visibleIds.length, fields: Object.keys(data), projectLinked, leadIds: visibleIds.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, updated: Math.max(updated, projectLinked, visibleIds.length) });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
