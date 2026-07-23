import { prisma } from "../src/lib/prisma";
import { writeFileSync, mkdirSync } from "node:fs";

// ════════════════════════════════════════════════════════════════════════════
// HEAL — offboarding null-status blind spot (RCA 2026-07-23).
//
// ROOT CAUSE: the Yasir offboarding (both scripts/offboard-yasir-2026-07-23.ts
// AND lib/offboarding.ts) selected the active workload with
//     currentStatus: { notIn: TERMINAL_STATUSES }
// In Postgres a NULL status is neither IN nor NOT IN a set, so every null/blank-
// status lead was silently EXCLUDED. The bespoke script's own verify used the
// SAME predicate, so it reported "COMPLETE" while 147 REVIVAL leads (null status,
// carrying follow-ups) stayed frozen with the now locked-out Yasir — no owner can
// work them, they never surface anywhere.
//
// THIS SCRIPT moves exactly those stranded leads to the Admin Queue: the identical,
// reversible operation already applied to the 112, with Previous Owner=Yasir
// preserved and ALL history (calls/notes/activities/audit) untouched. Data-only —
// the account is already locked, so no account/session mutation here.
// ════════════════════════════════════════════════════════════════════════════
const APPLY = process.argv.includes("--apply");
const STAMP = "2026-07-23-heal";

(async () => {
  const y = await prisma.user.findFirst({ where: { name: { contains: "Yasir" } } });
  if (!y) { console.log("Yasir NOT FOUND"); await prisma.$disconnect(); return; }
  if (y.active) { console.log("⚠️  Yasir is ACTIVE — abort. This heal assumes an offboarded (locked) user."); await prisma.$disconnect(); return; }
  const actorId = "cmplo0t6v0000vpxslasvbwuq"; // Lalit (admin who performed the offboarding)

  const { TERMINAL_STATUSES } = await import("../src/lib/lead-statuses");
  // CORRECTED predicate — WORKABLE_STATUS_OR: null/blank statuses INCLUDED. The 112
  // already-moved leads are ownerId=null now, so `ownerId=Yasir` yields only the
  // stranded set. "Already Bought" (terminal, non-null) is excluded → correctly
  // stays with Yasir for booking attribution.
  const NON_TERMINAL_OR = [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: [...TERMINAL_STATUSES] } }];
  const stranded = await prisma.lead.findMany({
    where: { ownerId: y.id, deletedAt: null, OR: NON_TERMINAL_OR },
    select: { id: true, name: true, ownerId: true, previousOwnerId: true, assignedAt: true,
              followupDate: true, followupReminderSentAt: true, returnedToPoolAt: true, currentStatus: true, leadOrigin: true, forwardedTeam: true },
  });
  console.log(`Yasir ${y.id} · active=${y.active} · employmentStatus check via user record`);
  console.log(`STRANDED non-terminal leads still owned (the null-status blind spot): ${stranded.length}`);
  const byStatus: Record<string, number> = {}; const byOrigin: Record<string, number> = {};
  for (const l of stranded) {
    const s = l.currentStatus == null ? "(null)" : (l.currentStatus === "" ? "(empty)" : l.currentStatus);
    byStatus[s] = (byStatus[s] || 0) + 1;
    const o = l.leadOrigin ?? "(null)"; byOrigin[o] = (byOrigin[o] || 0) + 1;
  }
  console.log("  by status:", byStatus);
  console.log("  by origin:", byOrigin);
  console.log("  sample:", stranded.slice(0, 5).map(l => ({ id: l.id, name: l.name, status: l.currentStatus, fu: l.followupDate })));

  // ── Backup + reversal artifact (independent of OperationLog) ──
  mkdirSync("backups/offboard-yasir-heal", { recursive: true });
  const before = { leads: stranded.map(l => ({ id: l.id, ownerId: l.ownerId, previousOwnerId: l.previousOwnerId, assignedAt: l.assignedAt, followupDate: l.followupDate, followupReminderSentAt: l.followupReminderSentAt, returnedToPoolAt: l.returnedToPoolAt })) };
  writeFileSync(`backups/offboard-yasir-heal/before-${STAMP}.json`, JSON.stringify(before, null, 2));
  const rev = [
    `-- Reverse Yasir stranded-revival heal ${STAMP} (restores ownerId=Yasir + follow-ups)`,
    ...stranded.map(l => `UPDATE "Lead" SET "ownerId"='${y.id}', "assignedAt"=${l.assignedAt ? `'${l.assignedAt.toISOString()}'` : "NULL"}, "previousOwnerId"=${l.previousOwnerId ? `'${l.previousOwnerId}'` : "NULL"}, "followupDate"=${l.followupDate ? `'${l.followupDate.toISOString()}'` : "NULL"}, "followupReminderSentAt"=${l.followupReminderSentAt ? `'${l.followupReminderSentAt.toISOString()}'` : "NULL"}, "returnedToPoolAt"=${l.returnedToPoolAt ? `'${l.returnedToPoolAt.toISOString()}'` : "NULL"} WHERE id='${l.id}';`),
  ].join("\n");
  writeFileSync(`backups/offboard-yasir-heal/REVERSAL-${STAMP}.sql`, rev + "\n");
  console.log(`snapshot + reversal → backups/offboard-yasir-heal/`);

  if (!APPLY) { console.log("\nDRY RUN — re-run with --apply to move them."); await prisma.$disconnect(); return; }

  const now = new Date();
  let moved = 0;
  for (const l of stranded) {
    await prisma.lead.update({ where: { id: l.id }, data: {
      ownerId: null,
      previousOwnerId: l.ownerId ?? l.previousOwnerId,   // Previous Owner = Yasir
      assignedAt: null,
      returnedToPoolAt: now,
      followupDate: null,                                 // unassigned → out of every follow-up queue (matches the 112)
      followupReminderSentAt: null,
    }});
    moved++;
  }
  console.log(`MOVED ${moved} stranded leads → Admin Queue (ownerId null, previousOwnerId=Yasir, follow-up cleared)`);

  // ── OperationLog (reversible via /admin/operations) + audit ──
  await prisma.operationLog.create({ data: {
    operation: "lead.transfer", entityType: "Lead", module: "Revival Engine", field: "ownerId",
    summary: `Heal offboarding null-status blind spot — ${moved} stranded Yasir revival leads → Admin Queue`, status: "EXECUTED", affectedCount: moved,
    affectedIds: stranded.map(l => l.id),
    beforeState: before.leads.map(l => ({ id: l.id, ownerId: l.ownerId, previousOwnerId: l.previousOwnerId, assignedAt: l.assignedAt, followupDate: l.followupDate })),
    afterState: { ownerId: null, previousOwnerId: y.id, returnedToPoolAt: now.toISOString() }, createdById: actorId,
  } }).catch(e => console.error("OperationLog failed:", e.message));
  try {
    const { audit } = await import("../src/lib/audit");
    await audit({ userId: actorId, action: "user.offboard.heal", entity: "User", entityId: y.id,
      meta: { reason: "null-status-blind-spot", strandedLeadsMoved: moved } });
  } catch (e) { console.error("audit failed:", (e as Error).message); }

  // ── VERIFY ──
  const [stillOwnedNonTerminal, stillOwnedTotal, histPreserved] = await Promise.all([
    prisma.lead.count({ where: { ownerId: y.id, deletedAt: null, OR: NON_TERMINAL_OR } }),
    prisma.lead.count({ where: { ownerId: y.id, deletedAt: null } }),
    prisma.lead.count({ where: { previousOwnerId: y.id } }),
  ]);
  console.log(`\nVERIFY: Yasir non-terminal owned=${stillOwnedNonTerminal} (expect 0) · total owned=${stillOwnedTotal} (expect 1 = "Already Bought", attribution) · leads w/ Previous Owner=Yasir=${histPreserved}`);
  console.log(stillOwnedNonTerminal === 0 ? "✅ HEAL COMPLETE — no non-terminal leads stranded with the offboarded user" : "❌ CHECK ABOVE");
  await prisma.$disconnect();
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
