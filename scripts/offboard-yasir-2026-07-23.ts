import { prisma } from "../src/lib/prisma";
import { writeFileSync, mkdirSync } from "node:fs";

// URGENT OFFBOARDING — Yasir Khan (left org). Locks the account + moves his 112
// active Revival leads to the Admin Queue, reversibly. Preserves ALL history
// (Previous Owner=Yasir, assignment history, calls, notes, activities, audit).
// No user record deleted, no historical data altered.
const APPLY = process.argv.includes("--apply");
const STAMP = "2026-07-23";

(async () => {
  const y = await prisma.user.findFirst({ where: { name: { contains: "Yasir" } } });
  if (!y) { console.log("Yasir NOT FOUND"); return; }
  const actorId = "cmplo0t6v0000vpxslasvbwuq"; // Lalit (admin performing offboarding)

  // Active workload = owned, non-terminal, not deleted (the 112 revival leads).
  const { TERMINAL_STATUSES } = await import("../src/lib/lead-statuses");
  const active = await prisma.lead.findMany({
    where: { ownerId: y.id, deletedAt: null, currentStatus: { notIn: [...TERMINAL_STATUSES] } },
    select: { id: true, name: true, ownerId: true, previousOwnerId: true, assignedAt: true,
              followupDate: true, followupReminderSentAt: true, returnedToPoolAt: true, currentStatus: true, forwardedTeam: true },
  });
  console.log(`Yasir ${y.id} · active=${y.active} · sessionEpoch=${y.sessionEpoch}`);
  console.log(`active leads to move → Admin Queue: ${active.length}`);

  // Snapshot + reversal (self-contained safety net, independent of OperationLog).
  mkdirSync("backups/offboard-yasir", { recursive: true });
  const before = {
    user: { id: y.id, active: y.active, sessionEpoch: y.sessionEpoch, passwordChangedAt: y.passwordChangedAt },
    leads: active.map(l => ({ id: l.id, ownerId: l.ownerId, previousOwnerId: l.previousOwnerId, assignedAt: l.assignedAt,
      followupDate: l.followupDate, followupReminderSentAt: l.followupReminderSentAt, returnedToPoolAt: l.returnedToPoolAt })),
  };
  writeFileSync(`backups/offboard-yasir/before-${STAMP}.json`, JSON.stringify(before, null, 2));
  const rev = [
    `-- Reverse Yasir offboarding ${STAMP}`,
    `UPDATE "User" SET active=${y.active}, "sessionEpoch"=${y.sessionEpoch}, "passwordChangedAt"=${y.passwordChangedAt ? `'${y.passwordChangedAt.toISOString()}'` : "NULL"} WHERE id='${y.id}';`,
    ...active.map(l => `UPDATE "Lead" SET "ownerId"='${y.id}', "assignedAt"=${l.assignedAt ? `'${l.assignedAt.toISOString()}'` : "NULL"}, "previousOwnerId"=${l.previousOwnerId ? `'${l.previousOwnerId}'` : "NULL"}, "followupDate"=${l.followupDate ? `'${l.followupDate.toISOString()}'` : "NULL"}, "returnedToPoolAt"=${l.returnedToPoolAt ? `'${l.returnedToPoolAt.toISOString()}'` : "NULL"} WHERE id='${l.id}';`),
  ].join("\n");
  writeFileSync(`backups/offboard-yasir/REVERSAL-${STAMP}.sql`, rev + "\n");
  console.log(`snapshot + reversal → backups/offboard-yasir/`);

  if (!APPLY) { console.log("\nDRY RUN — re-run with --apply."); await prisma.$disconnect(); return; }

  const now = new Date();
  // ── 1. LOCK ACCOUNT ──
  await prisma.user.update({ where: { id: y.id },
    data: { active: false, sessionEpoch: { increment: 1 }, passwordChangedAt: now } });
  const revoked = await prisma.userSession.updateMany({ where: { userId: y.id, revokedAt: null }, data: { revokedAt: now, revokedReason: "offboarded" } });
  const presence = await prisma.presenceSession.deleteMany({ where: { userId: y.id } }).catch(() => ({ count: 0 }));
  console.log(`ACCOUNT LOCKED: active=false, sessionEpoch bumped, passwordChangedAt set · sessions revoked=${revoked.count} · presence cleared=${presence.count}`);

  // ── 2. MOVE ACTIVE LEADS → ADMIN QUEUE (unassign, keep Previous Owner=Yasir) ──
  let moved = 0;
  for (const l of active) {
    await prisma.lead.update({ where: { id: l.id }, data: {
      ownerId: null,
      previousOwnerId: l.ownerId ?? l.previousOwnerId,   // Previous Owner = Yasir (current owner wins)
      assignedAt: null,
      returnedToPoolAt: now,
      followupDate: null,                                 // unassigned → not in anyone's follow-up queue
      followupReminderSentAt: null,
    }});
    moved++;
  }
  console.log(`MOVED ${moved} leads → Admin Queue (ownerId null, previousOwnerId=Yasir, follow-up cleared)`);

  // ── 3. OperationLog (reversible via /admin/operations) + audit ──
  await prisma.operationLog.create({ data: {
    operation: "lead.transfer", entityType: "Lead", module: "Revival Engine", field: "ownerId",
    summary: `Offboard Yasir Khan —  active leads → Admin Queue`, status: "EXECUTED", affectedCount: moved,
    affectedIds: active.map(l => l.id),
    beforeState: before.leads.map(l => ({ id: l.id, ownerId: l.ownerId, previousOwnerId: l.previousOwnerId, assignedAt: l.assignedAt, followupDate: l.followupDate })),
    afterState: { ownerId: null, previousOwnerId: y.id, returnedToPoolAt: now.toISOString() }, createdById: actorId,
  } }).catch(e => console.error("OperationLog failed:", e.message));
  try {
    const { audit } = await import("../src/lib/audit");
    await audit({ userId: actorId, action: "user.offboard", entity: "User", entityId: y.id,
      meta: { reason: "left-organization", activeLeadsMoved: moved, sessionsRevoked: revoked.count } });
  } catch (e) { console.error("audit failed:", (e as Error).message); }

  // ── 4. VERIFY ──
  const [uAfter, stillActive, stillOwned] = await Promise.all([
    prisma.user.findUnique({ where: { id: y.id }, select: { active: true, sessionEpoch: true } }),
    prisma.userSession.count({ where: { userId: y.id, revokedAt: null } }),
    prisma.lead.count({ where: { ownerId: y.id, deletedAt: null, currentStatus: { notIn: [...TERMINAL_STATUSES] } } }),
  ]);
  const histPreserved = await prisma.lead.count({ where: { previousOwnerId: y.id } });
  console.log(`\nVERIFY: user.active=${uAfter?.active} sessionEpoch=${uAfter?.sessionEpoch} · unrevoked sessions=${stillActive} · active owned leads=${stillOwned} · leads w/ Previous Owner=Yasir=${histPreserved}`);
  console.log(stillActive === 0 && stillOwned === 0 && uAfter?.active === false ? "✅ OFFBOARDING COMPLETE" : "❌ CHECK ABOVE");
  await prisma.$disconnect();
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
