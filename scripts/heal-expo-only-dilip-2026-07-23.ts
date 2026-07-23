import { prisma } from "../src/lib/prisma";
import { writeFileSync, mkdirSync } from "node:fs";

// ════════════════════════════════════════════════════════════════════════════
// HEAL — the one lead wrongly "rejected" with reason Expo Only (Lalit 2026-07-23).
//
// CONTEXT: "Expo Only" is a WORKABLE status (client interested in an expo, still
// pursued), NOT a rejection. But it had been wired as a Dubai reject reason, so
// rejecting with it stamped rejectedAt + unassigned the lead + cleared the follow-up
// while leaving a workable "Expo Only" status — a contradiction (a "rejected" lead in
// a workable status). Exactly one prod lead is in this state: Dilip Lakdwala.
//
// FIX: undo the mis-rejection — clear the rejection stamps and restore the owner
// (only if that owner is ACTIVE; never re-strand on an inactive user). The lead
// becomes a clean, workable, owned "Expo Only" lead. History (activities/notes/calls/
// audit) is untouched. Reversible: backup + reversal SQL + OperationLog.
// ════════════════════════════════════════════════════════════════════════════
const APPLY = process.argv.includes("--apply");
const STAMP = "2026-07-23";
const LEAD_ID = "cmreus33t000cla04n9khb5tw"; // Dilip Lakdwala

(async () => {
  const l = await prisma.lead.findUnique({
    where: { id: LEAD_ID },
    select: { id: true, name: true, currentStatus: true, ownerId: true, previousOwnerId: true,
              assignedAt: true, returnedToPoolAt: true, rejectedAt: true, rejectionReason: true,
              rejectedById: true, followupDate: true, forwardedTeam: true, market: true },
  });
  if (!l) { console.log("Lead NOT FOUND — id may have changed."); await prisma.$disconnect(); return; }
  if (l.rejectedAt == null && l.currentStatus === "Expo Only") { console.log("Already healed (no rejectedAt). Nothing to do."); await prisma.$disconnect(); return; }
  console.log("BEFORE:", JSON.stringify(l, null, 2));

  // Restore to the previous owner only if they are active (never re-strand a lead).
  const prevOwner = l.previousOwnerId
    ? await prisma.user.findUnique({ where: { id: l.previousOwnerId }, select: { id: true, name: true, active: true } })
    : null;
  const restoreOwner = prevOwner && prevOwner.active ? prevOwner : null;
  console.log(restoreOwner
    ? `→ will restore owner = ${restoreOwner.name} (active)`
    : `→ previous owner missing/inactive — leaving unassigned but WORKABLE (surfaces for normal assignment)`);

  const actorId = "cmplo0t6v0000vpxslasvbwuq"; // Lalit
  mkdirSync("backups/expo-only-heal", { recursive: true });
  writeFileSync(`backups/expo-only-heal/before-${STAMP}.json`, JSON.stringify(l, null, 2));
  const q = (v: string | null) => (v ? `'${v}'` : "NULL");
  const qd = (v: Date | null) => (v ? `'${v.toISOString()}'` : "NULL");
  const rev = [
    `-- Reverse Expo Only heal ${STAMP} (restore the mis-rejection exactly)`,
    `UPDATE "Lead" SET "ownerId"=${q(l.ownerId)}, "previousOwnerId"=${q(l.previousOwnerId)}, "assignedAt"=${qd(l.assignedAt)}, "returnedToPoolAt"=${qd(l.returnedToPoolAt)}, "rejectedAt"=${qd(l.rejectedAt)}, "rejectionReason"=${q(l.rejectionReason)}, "rejectedById"=${q(l.rejectedById)} WHERE id='${l.id}';`,
  ].join("\n");
  writeFileSync(`backups/expo-only-heal/REVERSAL-${STAMP}.sql`, rev + "\n");
  console.log(`snapshot + reversal → backups/expo-only-heal/`);

  if (!APPLY) { console.log("\nDRY RUN — re-run with --apply."); await prisma.$disconnect(); return; }

  const now = new Date();
  await prisma.lead.update({
    where: { id: l.id },
    data: {
      rejectedAt: null, rejectionReason: null, rejectedById: null,   // un-reject
      ...(restoreOwner
        ? { ownerId: restoreOwner.id, assignedAt: now, returnedToPoolAt: null }  // restore active owner
        : {}),                                                         // else stay unassigned but workable
      // currentStatus stays "Expo Only" (workable); followupDate stays as-is (owner sets on next contact).
    },
  });

  await prisma.operationLog.create({ data: {
    operation: "lead.transfer", entityType: "Lead", module: "Leads", field: "rejectedAt",
    summary: `Un-reject Dilip Lakdwala — "Expo Only" is a workable status, not a rejection${restoreOwner ? ` (owner restored: ${restoreOwner.name})` : " (kept unassigned/workable)"}`,
    status: "EXECUTED", affectedCount: 1, affectedIds: [l.id],
    beforeState: [{ id: l.id, ownerId: l.ownerId, previousOwnerId: l.previousOwnerId, rejectedAt: l.rejectedAt, rejectionReason: l.rejectionReason }],
    afterState: { ownerId: restoreOwner?.id ?? null, rejectedAt: null }, createdById: actorId,
  } }).catch(e => console.error("OperationLog failed:", e.message));
  try {
    const { audit } = await import("../src/lib/audit");
    await audit({ userId: actorId, action: "lead.unreject", entity: "Lead", entityId: l.id,
      meta: { reason: "expo-only-is-workable-not-rejection", ownerRestored: restoreOwner?.id ?? null } });
  } catch (e) { console.error("audit failed:", (e as Error).message); }

  const after = await prisma.lead.findUnique({ where: { id: l.id }, select: { currentStatus: true, ownerId: true, rejectedAt: true } });
  console.log("\nAFTER:", JSON.stringify(after, null, 2));
  console.log(after?.rejectedAt === null && after?.currentStatus === "Expo Only" ? "✅ HEAL COMPLETE — workable Expo Only lead, no rejection" : "❌ CHECK ABOVE");
  await prisma.$disconnect();
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
