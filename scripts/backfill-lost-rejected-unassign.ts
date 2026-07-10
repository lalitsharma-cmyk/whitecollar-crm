// ─────────────────────────────────────────────────────────────────────────────
// ONE-TIME backfill: historical LOST / REJECTED leads must not stay assigned.
//   previousOwnerId ← (previousOwnerId ?? ownerId)   · ownerId → null · assignedAt → null
//   followupDate + followupReminderSentAt → null
// SCOPE: live leads that are LOST-by-status OR rejected AND still carry an owner or an
//   active follow-up. Won/Closed are NEVER touched (their owner IS the booking attribution).
// PRESERVES: every conversation, remark, call, note, activity + assignment-history row.
// SAFETY: dry-run by default; --apply writes a JSON backup, ONE revertable OperationLog
//   row (Admin → Operations), LeadFieldHistory audit rows, an AuditLog entry, then verifies.
//
//   npx tsx scripts/backfill-lost-rejected-unassign.ts          # dry-run
//   npx tsx scripts/backfill-lost-rejected-unassign.ts --apply  # write to prod
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient, Prisma } from "@prisma/client";
import { LOST_STATUSES } from "../src/lib/lead-statuses";

const APPLY = process.argv.includes("--apply");
const env = readFileSync("C:/Users/Lenovo/whitecollar-crm/.env", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

// Mirrors LEAD_SNAPSHOT_SELECT in src/lib/operationLog.ts so the OperationLog row is
// revertable by the shared revertOperation() (its "lead.transfer" branch restores
// owner / previousOwnerId / assignedAt exactly).
const SNAP = {
  id: true, ownerId: true, previousOwnerId: true, assignedAt: true,
  forwardedTeam: true, market: true, currentStatus: true, followupDate: true,
  tags: true, slaFirstCallBy: true, slaEscalated: true, routingMethod: true,
} as const;

async function main() {
  console.log(`\n${APPLY ? "APPLY" : "DRY-RUN"} — Lost/Rejected leads: unassign + preserve Previous Owner + clear follow-up\n`);

  const where: Prisma.LeadWhereInput = {
    deletedAt: null,
    OR: [{ currentStatus: { in: LOST_STATUSES } }, { rejectedAt: { not: null } }],
    AND: [{ OR: [{ ownerId: { not: null } }, { followupDate: { not: null } }] }],
  };
  const targets = await prisma.lead.findMany({
    where,
    select: { ...SNAP, name: true, rejectedAt: true, owner: { select: { name: true } } },
  });

  console.log(`Leads to fix: ${targets.length}`);
  const byStatus = new Map<string, number>();
  for (const t of targets) byStatus.set(t.currentStatus ?? "(null)", (byStatus.get(t.currentStatus ?? "(null)") ?? 0) + 1);
  console.log(`By status: ${[...byStatus].map(([s, n]) => `${s}=${n}`).join(" · ")}`);
  for (const t of targets.slice(0, 8)) {
    console.log(`  ▸ ${t.name} · status="${t.currentStatus}" · owner=${t.owner?.name ?? "—"} → Previous Owner; follow-up=${t.followupDate ? t.followupDate.toISOString().slice(0, 10) : "—"} → cleared`);
  }
  if (targets.length > 8) console.log(`  … and ${targets.length - 8} more`);

  if (!APPLY) { console.log(`\nDRY-RUN — nothing written. Re-run with --apply.`); await prisma.$disconnect(); return; }
  if (targets.length === 0) { console.log(`\n✅ Nothing to do (idempotent).`); await prisma.$disconnect(); return; }

  const admin = await prisma.user.findFirst({ where: { OR: [{ isSuperAdmin: true }, { role: "ADMIN" }], active: true }, orderBy: { isSuperAdmin: "desc" }, select: { id: true, name: true } });
  if (!admin) throw new Error("no admin to attribute the audit/OperationLog to");

  // ── Backup (rollback artifact) ──
  mkdirSync("C:/Users/Lenovo/whitecollar-crm/backups", { recursive: true });
  const TS = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `backups/backfill-lost-rejected-${TS}.json`;
  writeFileSync(`C:/Users/Lenovo/whitecollar-crm/${file}`, JSON.stringify(targets, null, 2));
  console.log(`\n🔒 Backup → ${file}`);

  const ids = targets.map((t) => t.id);
  const beforeState = targets.map((t) => Object.fromEntries(Object.keys(SNAP).map((k) => [k, (t as Record<string, unknown>)[k]])));

  // ── Revertable OperationLog (restores owner/previousOwnerId/assignedAt) ──
  const op = await prisma.operationLog.create({
    data: {
      operation: "lead.transfer", entityType: "Lead", module: "Master Data",
      summary: `Lost/Rejected unassign backfill — ${ids.length} leads (owner → Previous Owner, follow-up cleared)`,
      status: "EXECUTED", affectedCount: ids.length,
      affectedIds: ids as unknown as Prisma.InputJsonValue,
      beforeState: beforeState as unknown as Prisma.InputJsonValue,
      afterState: { ownerId: null, assignedAt: null, followupDate: null } as unknown as Prisma.InputJsonValue,
      createdById: admin.id,
    },
  });

  // ── Apply per-lead. Precedence MUST match terminalStatusSideEffects() in
  // src/lib/lostRejected.ts: the CURRENT owner is the "last active owner" and wins;
  // the stored value is only a fallback so a re-run can't wipe an already-unassigned
  // lead's Previous Owner to null. (On the 2026-07-10 run all 111 rows had
  // previousOwnerId = null and a real owner, so both orderings agreed.)
  let unassigned = 0, followupsCleared = 0;
  const now = new Date();
  for (const t of targets) {
    const prev = t.ownerId ?? t.previousOwnerId;
    if (t.ownerId) unassigned++;
    if (t.followupDate) followupsCleared++;
    await prisma.$transaction(async (tx) => {
      await tx.lead.update({
        where: { id: t.id },
        data: { previousOwnerId: prev, ownerId: null, assignedAt: null, followupDate: null, followupReminderSentAt: null },
      });
      // Audit trail: who/when/what changed (history rows; never touches remarks/activities).
      const rows: Prisma.LeadFieldHistoryCreateManyInput[] = [];
      if (t.ownerId) rows.push({ leadId: t.id, field: "ownerId", oldValue: t.ownerId, newValue: null, changedById: admin.id, changedAt: now, source: "lost-rejected-backfill" });
      if (t.followupDate) rows.push({ leadId: t.id, field: "followupDate", oldValue: t.followupDate.toISOString(), newValue: null, changedById: admin.id, changedAt: now, source: "lost-rejected-backfill" });
      if (rows.length) await tx.leadFieldHistory.createMany({ data: rows });
    });
  }

  await prisma.auditLog.create({
    data: {
      userId: admin.id, action: "lead.lost-rejected.unassign-backfill", entity: "Lead", entityId: null,
      meta: JSON.stringify({ leads: ids.length, unassigned, followupsCleared, operationLogId: op.id, backup: file, note: "previousOwnerId preserved; history untouched" }),
    },
  });

  // ── Read-back verify ──
  const remaining = await prisma.lead.count({ where });
  const withPrev = await prisma.lead.count({ where: { id: { in: ids }, previousOwnerId: { not: null } } });
  console.log(`\n✅ APPLIED — ${ids.length} leads · assignments removed: ${unassigned} · follow-ups cleared: ${followupsCleared}`);
  console.log(`   Previous Owner recorded on ${withPrev}/${ids.length} · still-offending after fix (want 0): ${remaining}`);
  console.log(`   Revert anytime from Admin → Operations (OperationLog ${op.id}).`);
  if (remaining !== 0) process.exitCode = 1;
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); return prisma.$disconnect().then(() => process.exit(1)); });
