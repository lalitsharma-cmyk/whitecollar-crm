import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";
import { isStatusValidForTeam, NEEDS_REVIEW, statusesForTeam, isTerminalStatus, isFreshStatus } from "@/lib/lead-statuses";
import { validateMedium } from "@/lib/mediumManager";
import { teamToMarket } from "@/lib/market";
import { terminalStatusSideEffects, groupTerminalUpdates } from "@/lib/lostRejected";
import { assignLeadTo } from "@/lib/leadIngest";
import { snapshotLeads, logOperation } from "@/lib/operationLog";
import { ActivityType, ActivityStatus } from "@prisma/client";

// =====================================================================
// MASTER DATA — bulk actions (ADMIN only). Master Data is the complete
// repository, so these operate on the given lead ids directly (no owner
// scoping). Every move/assign/status writes LeadFieldHistory; everything here
// is REVERSIBLE — moves flip back, delete is soft (→ Archived), restore undoes.
//
//   move_to_leads    leadOrigin → ACTIVE  (appears in Leads/Dashboard/KPIs)
//   move_to_revival  leadOrigin → COLD    (appears only in Revival Engine)
//   assign           set owner (+ assignedAt)
//   set_status       set currentStatus
//   soft_delete      Super-Admin only — deletedAt set (recoverable)
//   restore          clear deletedAt
// =====================================================================

// `assign` reactivates + assigns one lead at a time (assignLeadTo writes the Assignment
// row and pushes a notification per lead, and previousStatus differs per row), so a full
// 50-record page is ~6 sequential round-trips × 50. The 10s default would clip that.
export const maxDuration = 60;

type HistRow = { leadId: string; field: string; oldValue: string | null; newValue: string | null; changedById: string; source: string };

export async function POST(req: NextRequest) {
  const me = await requireUser();
  if (me.role !== "ADMIN") {
    return NextResponse.json({ error: "Master Data actions are admin only." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const action = String(body.action ?? "");
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === "string") : [];
  if (ids.length === 0) return NextResponse.json({ error: "No records selected" }, { status: 400 });

  const writeHistory = (rows: HistRow[]) => {
    if (rows.length) prisma.leadFieldHistory.createMany({ data: rows }).catch(() => {});
  };

  // ── Move between sections (leadOrigin flip) ──────────────────────────
  if (action === "move_to_leads" || action === "move_to_revival") {
    const target = action === "move_to_leads" ? "ACTIVE_LEAD" : "REVIVAL";
    const before = await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, leadOrigin: true } });
    const changed = before.filter((b) => b.leadOrigin !== target);
    if (changed.length) {
      await prisma.lead.updateMany({
        where: { id: { in: changed.map((c) => c.id) } },
        data: { leadOrigin: target, isColdCall: target === "REVIVAL" },
      });
      writeHistory(changed.map((c) => ({ leadId: c.id, field: "leadOrigin", oldValue: c.leadOrigin, newValue: target, changedById: me.id, source: "master-data-bulk" })));
    }
    await audit({ userId: me.id, action: "masterdata.bulk.move", entity: "Lead", meta: { target, moved: changed.length, leadIds: ids.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, moved: changed.length });
  }

  // ── Assign owner — REACTIVATE a Master-Data record into a working lead ───────
  // Business rule (Lalit 2026-07-10): assigning a Master-Data record hands it to an
  // agent as a NORMAL working lead. It must LEAVE the Lost/Rejected state and land on
  // a workable status with a follow-up — otherwise it stays invisible on the Action
  // List (leadScope.activeBoardWhere requires rejectedAt:null + a non-terminal status,
  // and for a Master-Data-origin lead BOTH ownerId and followupDate). The whole batch
  // is wrapped in an OperationLog so an admin can undo it from Admin → Operations.
  if (action === "assign") {
    const userId = String(body.userId ?? "").trim();
    if (!userId) return NextResponse.json({ error: "userId required" }, { status: 400 });
    // hrOnly:false — never let leads be bulk-assigned to an HR/non-sales user
    // (the picker already excludes them; this hardens the server path too).
    const target = await prisma.user.findFirst({ where: { id: userId, active: true, hrOnly: false }, select: { id: true, name: true, email: true } });
    if (!target) return NextResponse.json({ error: "Target user not found" }, { status: 404 });

    // Status = caller value, else the MANDATORY default "Not Contacted" (a fresh,
    // not-yet-called landing state — the natural status for a freshly-handed record).
    const status = String(body.status ?? "").trim() || "Not Contacted";
    // HARD GUARD — never assign a record into a terminal (Lost/Rejected OR booked/sold)
    // status: an owner + a terminal status together would recreate the just-fixed bug
    // where a Lost/Rejected lead wrongly kept an owner and a follow-up (lostRejected.ts).
    if (isTerminalStatus(status)) {
      return NextResponse.json(
        { error: `Cannot assign a record into a terminal status (${status}). Assignment must put the record into a workable state.` },
        { status: 400 },
      );
    }

    // Follow-up = caller ISO datetime, else now + 15 minutes.
    const now = new Date();
    const rawFollowup = String(body.followupDate ?? "").trim();
    const followupDate = rawFollowup ? new Date(rawFollowup) : new Date(now.getTime() + 15 * 60 * 1000);
    if (rawFollowup && isNaN(followupDate.getTime())) {
      return NextResponse.json({ error: "Invalid followupDate" }, { status: 400 });
    }
    const followupIso = followupDate.toISOString();
    const followupHuman = followupDate.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

    // Pre-write state — for eligibility, previousStatus, per-field audit + the op-log snapshot.
    const beforeRows = await prisma.lead.findMany({
      where: { id: { in: ids } },
      select: { id: true, currentStatus: true, previousStatus: true, forwardedTeam: true, ownerId: true, followupDate: true },
    });
    // Team-strict eligibility (mirrors set_status): the status must belong to the lead's
    // team master. A FRESH status is ALWAYS allowed — the mandatory default "Not Contacted"
    // is in the India master but NOT the Dubai master (though Dubai AGENTS can set it), so
    // without this exception EVERY Dubai reactivation would be silently skipped. Fresh
    // statuses are team-agnostic reactivation states. Ineligible leads are skipped + counted
    // (isStatusValidForTeam also passes terminals + NEEDS_REVIEW, but terminals were 400'd).
    const eligible = beforeRows.filter((b) => isFreshStatus(status) || isStatusValidForTeam(status, b.forwardedTeam));
    let skipped = beforeRows.length - eligible.length;

    // Snapshot BEFORE any mutation — the revert source for the OperationLog entry below.
    const beforeSnap = await snapshotLeads(prisma, eligible.map((e) => e.id));

    const hist: HistRow[] = [];
    const assignedIds: string[] = [];
    for (const lead of eligible) {
      const statusChanged = lead.currentStatus !== status;
      try {
        // 1) Reactivate + set workable status/follow-up. Clearing rejectedAt is REQUIRED
        //    before assignLeadTo (which throws on a rejected lead) and so activeBoardWhere
        //    (rejectedAt:null) will surface the lead. previousOwnerId is deliberately NOT
        //    touched (Rule 4 — the previous owner stays preserved).
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            currentStatus: status,
            // previousStatus = the status held BEFORE this reactivation; REPLACE it each
            // time the status actually changes (only-set-on-change, so re-assigning at the
            // same status never overwrites a real prior status with itself).
            ...(statusChanged ? { previousStatus: lead.currentStatus } : {}),
            followupDate,
            status: "NEW",
            rejectedAt: null,
            rejectionReason: null,
            rejectionNote: null,
            rejectedById: null,
            lastTouchedAt: now,
          },
        });
        // 2) Assign — MUST run after rejectedAt is cleared. Sets ownerId/assignedAt/SLA,
        //    writes the Assignment row + fires the LEAD_ASSIGNED push to the agent.
        await assignLeadTo(lead.id, userId, "Assigned from Master Data");
        assignedIds.push(lead.id);

        // Per-field audit — only fields that actually changed.
        if (lead.ownerId !== userId) {
          hist.push({ leadId: lead.id, field: "ownerId", oldValue: lead.ownerId, newValue: userId, changedById: me.id, source: "master-data-assign" });
        }
        if (statusChanged) {
          hist.push({ leadId: lead.id, field: "currentStatus", oldValue: lead.currentStatus, newValue: status, changedById: me.id, source: "master-data-assign" });
          hist.push({ leadId: lead.id, field: "previousStatus", oldValue: lead.previousStatus, newValue: lead.currentStatus, changedById: me.id, source: "master-data-assign" });
        }
        const oldFuIso = lead.followupDate ? lead.followupDate.toISOString() : null;
        if (oldFuIso !== followupIso) {
          hist.push({ leadId: lead.id, field: "followupDate", oldValue: oldFuIso, newValue: followupIso, changedById: me.id, source: "master-data-assign" });
        }
        // Timeline card (best-effort — .catch keeps a failure from ever aborting the batch).
        await prisma.activity.create({
          data: {
            leadId: lead.id,
            userId: me.id,
            type: ActivityType.STATUS_CHANGE,
            status: ActivityStatus.DONE,
            title: "♻️ Assigned from Master Data",
            description: `Assigned to ${target.name ?? target.email ?? "agent"} · status "${status}" · follow-up ${followupHuman} IST.`,
            completedAt: now,
          },
        }).catch(() => {});
      } catch {
        // assignLeadTo (or the reactivation write) threw for THIS lead — count it as
        // skipped and keep going. One bad row must never abort the whole batch.
        skipped++;
      }
    }

    const assigned = assignedIds.length;
    writeHistory(hist);

    // OperationLog — reversible. beforeState = snapshots of the leads that ACTUALLY got
    // assigned (team-skips + failures excluded), captured BEFORE the mutation above.
    if (assignedIds.length) {
      await logOperation(prisma, {
        operation: "lead.assign",
        entityType: "Lead",
        module: "Master Data",
        summary: `Assigned ${assigned} record(s) from Master Data to ${target.name ?? target.email ?? "user"} · status ${status} · follow-up ${followupHuman}`,
        affectedIds: assignedIds,
        beforeState: beforeSnap.filter((b) => assignedIds.includes(b.id)),
        afterState: { toUserId: userId, status, followupDate: followupIso },
        createdById: me.id,
      }).catch(() => {});
    }

    await audit({ userId: me.id, action: "masterdata.bulk.assign", entity: "Lead", meta: { userId, status, followupDate: followupIso, assigned, skipped, leadIds: ids.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, assigned, skipped, status, followupDate: followupIso });
  }

  // ── Set status ───────────────────────────────────────────────────────
  if (action === "set_status") {
    const status = String(body.status ?? "").trim();
    if (!status) return NextResponse.json({ error: "status required" }, { status: 400 });
    // ownerId + previousOwnerId + followupDate are read so the SHARED lost/rejected
    // rule can unassign a LOST lead (owner → previousOwner) and so we can audit the
    // ownership/follow-up removals below.
    const before = await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, currentStatus: true, forwardedTeam: true, ownerId: true, previousOwnerId: true, followupDate: true } });
    // Team-strict: only apply to leads whose TEAM master includes this status —
    // never force a Dubai status onto a Gurgaon lead (or vice-versa). The sentinel
    // "Needs Review" is allowed for any team. Ineligible leads are skipped + counted.
    const eligible = before.filter((b) => status === NEEDS_REVIEW || (statusesForTeam(b.forwardedTeam) as readonly string[]).includes(status));
    const skipped = before.length - eligible.length;
    const changed = eligible.filter((b) => b.currentStatus !== status);
    // Snapshot the to-be-changed rows BEFORE mutating — the revert source for the
    // reversible "lead.status" OperationLog logged after the batch below.
    const beforeSnap = changed.length ? await snapshotLeads(prisma, changed.map((c) => c.id)) : [];
    if (changed.length) {
      const now = new Date();
      // SHARED terminal-status side-effects (src/lib/lostRejected.ts): a LOST status
      // unassigns the lead (owner → previousOwner, owner + assignedAt cleared) and
      // clears its follow-up; a CLOSED/WON status keeps the owner (booking attribution)
      // and only clears the follow-up. previousOwnerId is per-lead, so updateMany can't
      // reference a sibling column — groupTerminalUpdates() collapses the writes into
      // one updateMany per distinct previous-owner (bounded by the agent count) rather
      // than one round-trip per lead.
      for (const g of groupTerminalUpdates(status, changed)) {
        await prisma.lead.updateMany({ where: { id: { in: g.ids } }, data: { currentStatus: status, lastTouchedAt: now, ...g.data } });
      }
      const hist: HistRow[] = [];
      for (const c of changed) {
        const eff = terminalStatusSideEffects(status, { ownerId: c.ownerId, previousOwnerId: c.previousOwnerId });
        hist.push({ leadId: c.id, field: "currentStatus", oldValue: c.currentStatus, newValue: status, changedById: me.id, source: "master-data-bulk" });
        // Audit trail whenever the rule actually removes an assignment or a follow-up.
        if (eff.ownerId === null && c.ownerId != null) {
          hist.push({ leadId: c.id, field: "ownerId", oldValue: c.ownerId, newValue: null, changedById: me.id, source: "lost-rejected-rule" });
        }
        if (eff.followupDate === null && c.followupDate != null) {
          hist.push({ leadId: c.id, field: "followupDate", oldValue: c.followupDate.toISOString(), newValue: null, changedById: me.id, source: "lost-rejected-rule" });
        }
      }
      writeHistory(hist);
      // OperationLog — reversible bulk status change (undo from Admin → Operations).
      // beforeState = the snapshots captured above; the revert restores currentStatus +
      // follow-up + ownership together (a LOST status stripped owner/assignedAt/follow-up).
      await logOperation(prisma, {
        operation: "lead.status",
        entityType: "Lead",
        module: "Master Data",
        field: "currentStatus",
        summary: `Status → ${status}`,
        affectedIds: changed.map((c) => c.id),
        beforeState: beforeSnap,
        afterState: { currentStatus: status },
        createdById: me.id,
      }).catch(() => {});
    }
    await audit({ userId: me.id, action: "masterdata.bulk.status", entity: "Lead", meta: { status, updated: changed.length, skipped, leadIds: ids.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, updated: changed.length, skipped });
  }

  // ── Change team (Dubai / India) ──────────────────────────────────────
  if (action === "change_team") {
    const team = String(body.team ?? "").trim();
    if (team !== "Dubai" && team !== "India") {
      return NextResponse.json({ error: "team must be Dubai or India" }, { status: 400 });
    }
    const before = await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, forwardedTeam: true, currentStatus: true } });
    const changed = before.filter((b) => b.forwardedTeam !== team);
    let flagged = 0;
    if (changed.length) {
      // Market tracks team — set the derived India/UAE market in the same write
      // (team is validated Dubai/India above, so teamToMarket is never null).
      await prisma.lead.updateMany({ where: { id: { in: changed.map((c) => c.id) } }, data: { forwardedTeam: team, market: teamToMarket(team) } });
      writeHistory(changed.map((c) => ({ leadId: c.id, field: "forwardedTeam", oldValue: c.forwardedTeam, newValue: team, changedById: me.id, source: "master-data-bulk" })));
      // Revalidate status against the NEW team's master. A status that doesn't
      // exist for the new team becomes "Needs Review" (old value kept in history)
      // — never silently forced onto a wrong-team status.
      const toFlag = changed.filter((c) => !isStatusValidForTeam(c.currentStatus, team));
      if (toFlag.length) {
        await prisma.lead.updateMany({ where: { id: { in: toFlag.map((c) => c.id) } }, data: { currentStatus: NEEDS_REVIEW } });
        writeHistory(toFlag.map((c) => ({ leadId: c.id, field: "currentStatus", oldValue: c.currentStatus, newValue: NEEDS_REVIEW, changedById: me.id, source: "team-change-revalidate" })));
        flagged = toFlag.length;
      }
    }
    await audit({ userId: me.id, action: "masterdata.bulk.team", entity: "Lead", meta: { team, updated: changed.length, flaggedNeedsReview: flagged, leadIds: ids.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, updated: changed.length, flaggedNeedsReview: flagged });
  }

  // ── Soft delete (recoverable) — Super Admin only ─────────────────────
  if (action === "soft_delete") {
    if (!me.isSuperAdmin) return NextResponse.json({ error: "Only the Super Admin can delete records." }, { status: 403 });
    const rows = await prisma.lead.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } });
    const r = await prisma.lead.updateMany({ where: { id: { in: rows.map((x) => x.id) } }, data: { deletedAt: new Date(), deletedById: me.id } });
    await audit({ userId: me.id, action: "masterdata.bulk.delete", entity: "Lead", meta: { soft: true, count: r.count, leadIds: ids.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, deleted: r.count });
  }

  // ── Restore (undo soft delete) ───────────────────────────────────────
  if (action === "restore") {
    const r = await prisma.lead.updateMany({ where: { id: { in: ids }, deletedAt: { not: null } }, data: { deletedAt: null, deletedById: null } });
    await audit({ userId: me.id, action: "masterdata.bulk.restore", entity: "Lead", meta: { count: r.count, leadIds: ids.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, restored: r.count });
  }

  // ── Set arbitrary fields (medium, sourceDetail, etc) ──────────────────
  if (action === "set_fields") {
    const fields: Record<string, unknown> = {};

    // Medium validation and preparation
    if (body.medium) {
      try {
        const { medium: m, mediumOther: mo } = validateMedium(body.medium, body.mediumOther);
        if (m) fields.medium = m;
        if (mo) fields.mediumOther = mo;
      } catch (e) {
        return NextResponse.json({ error: `Invalid medium: ${String(e).slice(0, 100)}` }, { status: 400 });
      }
    }

    // Other simple string fields
    if (typeof body.sourceDetail === "string") fields.sourceDetail = body.sourceDetail || null;

    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const r = await prisma.lead.updateMany({
      where: { id: { in: ids } },
      data: fields,
    });

    // Write history for tracked fields
    const histRows: HistRow[] = [];
    if (body.medium) {
      const before = await prisma.lead.findMany({ where: { id: { in: ids } }, select: { id: true, medium: true } });
      histRows.push(...before.map((b) => ({ leadId: b.id, field: "medium", oldValue: b.medium, newValue: fields.medium as string, changedById: me.id, source: "master-data-bulk" })));
    }
    writeHistory(histRows);

    await audit({ userId: me.id, action: "masterdata.bulk.set_fields", entity: "Lead", meta: { fields: Object.keys(fields), updated: r.count, leadIds: ids.slice(0, 50) }, request: reqMeta(req) });
    return NextResponse.json({ ok: true, updated: r.count });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
