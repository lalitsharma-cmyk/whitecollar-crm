import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";

/**
 * ADMIN-only: merge one or more duplicate Leads into a single master Lead.
 *
 * Body shape: { masterId: string, mergeIds: string[] }
 *
 * Behaviour:
 *  - All Activity / CallLog / Note / Assignment / LeadProperty / LeadProject rows
 *    on each mergeId get re-pointed to masterId.
 *  - One AuditLog row per merged lead: action = "lead.merged_into.master".
 *  - The merged Lead rows are deleted.
 *
 * Defensive:
 *  - Refuses if masterId appears in mergeIds (would delete the master).
 *  - Refuses if any id is unknown.
 *  - Refuses if mergeIds is empty.
 *  - LeadProperty / LeadProject have @@unique constraints — we handle the
 *    "master already has this unit/project" case by dropping the duplicate
 *    instead of crashing on a unique violation.
 */
export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN");

  let body: { masterId?: unknown; mergeIds?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const masterId = typeof body.masterId === "string" ? body.masterId : "";
  const mergeIdsRaw = Array.isArray(body.mergeIds) ? body.mergeIds : [];
  const mergeIds = mergeIdsRaw.filter((x): x is string => typeof x === "string" && x.length > 0);

  if (!masterId) {
    return NextResponse.json({ ok: false, error: "masterId is required" }, { status: 400 });
  }
  if (mergeIds.length === 0) {
    return NextResponse.json({ ok: false, error: "mergeIds must include at least one lead id" }, { status: 400 });
  }
  if (mergeIds.includes(masterId)) {
    return NextResponse.json(
      { ok: false, error: "masterId cannot also appear in mergeIds — would delete the master" },
      { status: 400 },
    );
  }

  // Validate every id exists before we touch anything.
  const allIds = [masterId, ...mergeIds];
  const found = await prisma.lead.findMany({ where: { id: { in: allIds } }, select: { id: true } });
  if (found.length !== allIds.length) {
    const missing = allIds.filter((id) => !found.some((f) => f.id === id));
    return NextResponse.json({ ok: false, error: "Some leads not found", missing }, { status: 404 });
  }

  // Pre-compute existing (unitId / projectId) on the master so we don't
  // violate the @@unique([leadId, unitId]) / @@unique([leadId, projectId]).
  const [masterUnits, masterProjects] = await Promise.all([
    prisma.leadProperty.findMany({ where: { leadId: masterId }, select: { unitId: true } }),
    prisma.leadProject.findMany({ where: { leadId: masterId }, select: { projectId: true } }),
  ]);
  const masterUnitIds = new Set(masterUnits.map((u) => u.unitId));
  const masterProjectIds = new Set(masterProjects.map((p) => p.projectId));

  let mergedCount = 0;

  // Single transaction so a failure mid-merge doesn't leave dangling data.
  await prisma.$transaction(async (tx) => {
    for (const mergeId of mergeIds) {
      // 1. Move simple child tables (no unique constraint on (leadId, *)).
      await tx.activity.updateMany({ where: { leadId: mergeId }, data: { leadId: masterId } });
      await tx.callLog.updateMany({ where: { leadId: mergeId }, data: { leadId: masterId } });
      await tx.note.updateMany({ where: { leadId: mergeId }, data: { leadId: masterId } });
      await tx.assignment.updateMany({ where: { leadId: mergeId }, data: { leadId: masterId } });
      await tx.whatsAppMessage.updateMany({ where: { leadId: mergeId }, data: { leadId: masterId } });

      // 2. LeadProperty — has @@unique([leadId, unitId]). For each row on the
      //    merged lead, either re-point it (unit not yet on master) or drop it.
      const dupUnits = await tx.leadProperty.findMany({
        where: { leadId: mergeId },
        select: { id: true, unitId: true },
      });
      for (const lp of dupUnits) {
        if (masterUnitIds.has(lp.unitId)) {
          await tx.leadProperty.delete({ where: { id: lp.id } });
        } else {
          await tx.leadProperty.update({ where: { id: lp.id }, data: { leadId: masterId } });
          masterUnitIds.add(lp.unitId);
        }
      }

      // 3. LeadProject — same dance for @@unique([leadId, projectId]).
      const dupProjects = await tx.leadProject.findMany({
        where: { leadId: mergeId },
        select: { id: true, projectId: true },
      });
      for (const lp of dupProjects) {
        if (masterProjectIds.has(lp.projectId)) {
          await tx.leadProject.delete({ where: { id: lp.id } });
        } else {
          await tx.leadProject.update({ where: { id: lp.id }, data: { leadId: masterId } });
          masterProjectIds.add(lp.projectId);
        }
      }

      // 4. Snapshot the full merged-lead row + audit BEFORE deletion, so the
      //    merged lead's OWN fields (remarks, budget, status, …) stay fully
      //    recoverable. Its child history is already reparented to the master.
      const snapshot = await tx.lead.findUnique({ where: { id: mergeId } });
      await tx.auditLog.create({
        data: {
          userId: me.id,
          action: "lead.merged_into.master",
          entity: "Lead",
          entityId: mergeId,
          meta: JSON.stringify({ masterId, mergedId: mergeId, snapshot }),
        },
      });

      // 5. Delete the now-empty merged Lead.
      await tx.lead.delete({ where: { id: mergeId } });
      mergedCount++;
    }
  });

  // Top-level audit (best-effort, outside the txn).
  await audit({
    userId: me.id,
    action: "lead.merge",
    entity: "Lead",
    entityId: masterId,
    meta: { masterId, mergeIds, mergedCount },
    request: reqMeta(req),
  });

  return NextResponse.json({ ok: true, mergedCount });
}
