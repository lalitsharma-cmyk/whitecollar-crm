import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { assignLeadTo } from "@/lib/leadIngest";
import { audit, reqMeta } from "@/lib/audit";
import { leadScopeWhere } from "@/lib/leadScope";
import { LeadStatus, LeadSource, ActivityType, ActivityStatus } from "@prisma/client";
import { isStatusValidForTeam, NEEDS_REVIEW, statusesForTeam } from "@/lib/lead-statuses";
import { crossTeamWarning, normalizeTeam } from "@/lib/teamRouting";
import { parseBudget } from "@/lib/budgetParse";
import { resolveBudgetCurrency } from "@/lib/budgetCurrency";
import { inferCountryFromCity } from "@/lib/cityCountry";
// SINGLE SOURCE OF TRUTH for reject reasons — shared with the modal + single-lead
// reject route, so the bulk path can never drift (it previously had a stale,
// divergent allow-list that didn't include the new reasons).
import { REJECT_REASON_VALUES, rejectionStatusFor } from "@/lib/reject-reasons";

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
    if (!REJECT_REASON_VALUES.has(reason)) {
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
        // Mirror the single-lead reject: the reason's classification status is
        // applied here too, so bulk-rejected leads aren't left on a stale status.
        currentStatus: rejectionStatusFor(reason),
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

  if (action === "recalc_currency") {
    // ADMIN-only. Re-derive budgetCurrency for the selected leads against the
    // CURRENT market rules / project mappings — without touching budgetRaw or the
    // numeric values. Lets currency improve over time (fix UNKNOWN, or correct a
    // currency after a project→market mapping is added). Only applies a CONFIDENT
    // result that differs from the stored one; never downgrades a set currency to
    // UNKNOWN. Every change is recorded in LeadFieldHistory.
    if (me.role !== "ADMIN") {
      return NextResponse.json({ error: "Only an admin can recalculate currency." }, { status: 403 });
    }
    const leads = await prisma.lead.findMany({
      where: { id: { in: ids }, ...scope },
      select: { id: true, budgetRaw: true, budgetCurrency: true, country: true, city: true, sourceDetail: true, forwardedTeam: true },
    });
    let updated = 0;
    const hist: { leadId: string; field: string; oldValue: string | null; newValue: string | null; changedById: string; source: string }[] = [];
    for (const l of leads) {
      const ccy = resolveBudgetCurrency({
        explicit: l.budgetRaw,                                  // ₹/AED/INR hint inside the verbatim text
        country: l.country ?? inferCountryFromCity(l.city),
        projectName: l.sourceDetail,
        team: l.forwardedTeam,
      });
      if (ccy !== "UNKNOWN" && ccy !== l.budgetCurrency) {
        await prisma.lead.update({ where: { id: l.id }, data: { budgetCurrency: ccy } });
        hist.push({ leadId: l.id, field: "budgetCurrency", oldValue: l.budgetCurrency, newValue: ccy, changedById: me.id, source: "recalc-currency" });
        updated++;
      }
    }
    if (hist.length) prisma.leadFieldHistory.createMany({ data: hist }).catch(() => {});
    await audit({
      userId: me.id, action: "lead.bulk.recalc_currency", entity: "Lead",
      meta: { count: updated, scanned: leads.length, leadIds: ids.slice(0, 50) },
      request: reqMeta(req),
    });
    return NextResponse.json({ ok: true, updated, scanned: leads.length });
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

  if (action === "set_current_status") {
    // Set the user-facing Excel/MIS status (currentStatus) in bulk. ADMIN/MANAGER
    // only. Team-strict: only applies to leads whose TEAM master includes the
    // status (never forces a Dubai status onto a Gurgaon lead). "Needs Review" is
    // allowed for any team. Mirrors /api/master-data/bulk set_status, but scoped
    // through leadScopeWhere so a manager only touches their own team. Writes
    // LeadFieldHistory (currentStatus old→new) per changed lead.
    if (me.role !== "ADMIN" && me.role !== "MANAGER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const status = String(body.status ?? "").trim();
    if (!status) return NextResponse.json({ error: "status required" }, { status: 400 });
    const before = await prisma.lead.findMany({
      where: { id: { in: ids }, ...scope },
      select: { id: true, currentStatus: true, forwardedTeam: true },
    });
    const eligible = before.filter((b) => status === NEEDS_REVIEW || (statusesForTeam(b.forwardedTeam) as readonly string[]).includes(status));
    const skipped = before.length - eligible.length;
    const changed = eligible.filter((b) => b.currentStatus !== status);
    if (changed.length) {
      await prisma.lead.updateMany({ where: { id: { in: changed.map((c) => c.id) } }, data: { currentStatus: status, lastTouchedAt: new Date() } });
      prisma.leadFieldHistory.createMany({
        data: changed.map((c) => ({ leadId: c.id, field: "currentStatus", oldValue: c.currentStatus, newValue: status, changedById: me.id, source: "bulk" })),
      }).catch(() => {});
    }
    await audit({ userId: me.id, action: "lead.bulk.current_status", entity: "Lead",
      meta: { status, updated: changed.length, skipped, leadIds: changed.map((c) => c.id).slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, updated: changed.length, skipped });
  }

  if (action === "set_team") {
    // Set forwardedTeam (Dubai / India) in bulk. ADMIN/MANAGER only. Scoped
    // through leadScopeWhere. Revalidates each lead's status against the NEW
    // team's master — a status that doesn't exist for the new team becomes
    // "Needs Review" (old value kept in history). Mirrors /api/master-data/bulk
    // change_team so the two paths can't drift.
    if (me.role !== "ADMIN" && me.role !== "MANAGER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const team = String(body.team ?? "").trim();
    if (team !== "Dubai" && team !== "India") {
      return NextResponse.json({ error: "team must be Dubai or India" }, { status: 400 });
    }
    // A team-scoped MANAGER cannot move leads OUT of their own team.
    if (me.role === "MANAGER") {
      const meTeam = normalizeTeam(me.team);
      if (meTeam && meTeam !== team) {
        return NextResponse.json({ error: "Managers can only set leads to their own team." }, { status: 403 });
      }
    }
    const before = await prisma.lead.findMany({
      where: { id: { in: ids }, ...scope },
      select: { id: true, forwardedTeam: true, currentStatus: true },
    });
    const changed = before.filter((b) => b.forwardedTeam !== team);
    let flagged = 0;
    if (changed.length) {
      await prisma.lead.updateMany({ where: { id: { in: changed.map((c) => c.id) } }, data: { forwardedTeam: team } });
      prisma.leadFieldHistory.createMany({
        data: changed.map((c) => ({ leadId: c.id, field: "forwardedTeam", oldValue: c.forwardedTeam, newValue: team, changedById: me.id, source: "bulk" })),
      }).catch(() => {});
      const toFlag = changed.filter((c) => !isStatusValidForTeam(c.currentStatus, team));
      if (toFlag.length) {
        await prisma.lead.updateMany({ where: { id: { in: toFlag.map((c) => c.id) } }, data: { currentStatus: NEEDS_REVIEW } });
        prisma.leadFieldHistory.createMany({
          data: toFlag.map((c) => ({ leadId: c.id, field: "currentStatus", oldValue: c.currentStatus, newValue: NEEDS_REVIEW, changedById: me.id, source: "team-change-revalidate" })),
        }).catch(() => {});
        flagged = toFlag.length;
      }
    }
    await audit({ userId: me.id, action: "lead.bulk.team", entity: "Lead",
      meta: { team, updated: changed.length, flaggedNeedsReview: flagged, leadIds: changed.map((c) => c.id).slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, updated: changed.length, flaggedNeedsReview: flagged });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
