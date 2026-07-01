// ────────────────────────────────────────────────────────────────────────────
// scripts/reconcile-actor-owner.ts — historical actor-vs-owner reconciliation
//
//   DRY RUN (default, READ-ONLY):   npx tsx scripts/reconcile-actor-owner.ts
//   APPLY  (writes, gated):         npx tsx scripts/reconcile-actor-owner.ts --apply
//
// WHAT IT FIXES (owner-approved scope ONLY):
//   System-created Activity rows wrongly stamped with the lead OWNER as the actor.
//   Deterministically identifiable by title prefix; created by AUTOMATION / import
//   code with NO human actor → correct value is userId = NULL (renders "System"):
//     • "Duplicate intake from …"            (leadIngest dup-detection)   → null
//     • "🤖 …"                                (workflowEngine CREATE_TASK)  → null
//     • "Revival import — re-engaged from …"  (revivalImport)              → null*
//   *Revival-import SHOULD carry the importer; historically only the owner was
//    stored and the importer is unrecoverable, so we set null rather than GUESS.
//
// DELIBERATELY NOT TOUCHED (per Lalit's "never guess" rule):
//   • Acefone inbound CallLogs stamped with the owner via the old fallback — we
//     cannot distinguish "owner took the call" from "owner-fallback" → LEFT AS-IS.
//   • Outbound WhatsApp — no actor was ever recorded → nothing to reconcile.
//   • Any human-created Activity/Note — already correct.
//
// SAFEGUARDS (Lalit-mandated, 2026-07-01):
//   • Full DB backup taken BEFORE this runs (backups/FULL-*). This script also
//     writes a targeted JSON backup of every row it will touch (id + old userId).
//   • BATCHED — small transactions (no long-running locks on Activity).
//   • Every updated record gets its OWN AuditLog row (reversible + traceable).
//   • ONLY Activity.userId is changed. Title/description/timestamps/remarks/type
//     are NEVER touched. No business data is modified.
//   • Idempotent — re-running only affects rows that still have a non-null actor.
//   • Reversible — restore each prior userId from the backup JSON (or AuditLog).
// ────────────────────────────────────────────────────────────────────────────
import { prisma } from "../src/lib/prisma";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const APPLY = process.argv.includes("--apply");
const BATCH = 25;
const STAMP = process.env.RECONCILE_STAMP || "manual"; // pass a real timestamp via env (no Date.now in scripts)

const PATTERNS = [
  { label: "duplicate-intake", startsWith: "Duplicate intake from" },
  { label: "workflow-task", startsWith: "🤖 " },
  { label: "revival-import", startsWith: "Revival import — re-engaged from" },
];

type Row = { id: string; label: string; oldUserId: string; oldUserName: string | null; ownerId: string | null; title: string; createdAt: string };

async function main() {
  console.log(`\n╔══ ACTOR-OWNER RECONCILIATION — ${APPLY ? "APPLY (WRITES, BATCHED, AUDITED)" : "DRY RUN (read-only)"} ══╗\n`);

  // ── Scan ────────────────────────────────────────────────────────────────────
  const affected: Row[] = [];
  const perLabel: Record<string, number> = {};
  for (const p of PATTERNS) {
    const rows = await prisma.activity.findMany({
      where: { title: { startsWith: p.startsWith }, userId: { not: null } },
      select: { id: true, title: true, userId: true, createdAt: true, user: { select: { name: true } }, lead: { select: { ownerId: true } } },
    });
    perLabel[p.label] = rows.length;
    for (const r of rows) affected.push({
      id: r.id, label: p.label, oldUserId: r.userId as string, oldUserName: r.user?.name ?? null,
      ownerId: r.lead?.ownerId ?? null, title: r.title, createdAt: r.createdAt.toISOString(),
    });
    console.log(`  scanned ${p.label.padEnd(18)} → ${rows.length}`);
  }
  const scanned = affected.length;
  const stillOwner = affected.filter(a => a.oldUserId === a.ownerId).length;
  console.log(`\n  TOTAL scanned (to reconcile): ${scanned}   (userId still == current owner: ${stillOwner})\n`);

  console.log("  Before/after sample (up to 10):");
  for (const a of affected.slice(0, 10)) {
    console.log(`    ${a.id} | ${a.label} | "${a.title.slice(0, 34)}" | ${a.createdAt.slice(0, 10)} | BEFORE=${a.oldUserName ?? a.oldUserId} → AFTER=System`);
  }

  if (scanned === 0) { console.log("\n  Nothing to do.\n"); await prisma.$disconnect(); return; }

  if (!APPLY) {
    console.log(`\n  DRY RUN — no changes written. Re-run with --apply (after approval) to execute.\n`);
    await prisma.$disconnect();
    return;
  }

  // ── APPLY (batched + audited) ───────────────────────────────────────────────
  const backupPath = join(process.cwd(), "backups", `reconcile-actor-owner-${STAMP}.json`);
  writeFileSync(backupPath, JSON.stringify({ stamp: STAMP, scanned, rows: affected }, null, 2), "utf8");
  console.log(`\n  Targeted backup written: ${backupPath}`);

  let updated = 0, skipped = 0;
  const exceptions: Array<{ id: string; error: string }> = [];

  for (let i = 0; i < affected.length; i += BATCH) {
    const batch = affected.slice(i, i + BATCH);
    try {
      await prisma.$transaction([
        // one AuditLog per row (reversible + traceable)
        ...batch.map((a) => prisma.auditLog.create({
          data: {
            userId: null,
            action: "activity.actor-reconcile",
            entity: "Activity",
            entityId: a.id,
            meta: JSON.stringify({ from: a.oldUserId, fromName: a.oldUserName, ownerId: a.ownerId, to: null, reason: a.label, note: "owner-as-actor → System (Lalit 2026-07-01)" }),
          },
        })),
        // only flip rows that STILL have a non-null actor (idempotent guard)
        prisma.activity.updateMany({ where: { id: { in: batch.map((b) => b.id) }, userId: { not: null } }, data: { userId: null } }),
      ]);
      updated += batch.length;
    } catch (e) {
      for (const a of batch) exceptions.push({ id: a.id, error: String(e).slice(0, 160) });
    }
    process.stdout.write(`\r  progress: ${Math.min(i + BATCH, affected.length)}/${affected.length}`);
  }
  console.log("");

  // Post-verify: any of the scanned rows still non-null?
  const remaining = await prisma.activity.count({ where: { id: { in: affected.map((a) => a.id) }, userId: { not: null } } });
  skipped = scanned - updated;

  console.log(`\n  ── DELIVERABLES ─────────────────────────────`);
  console.log(`  Total scanned : ${scanned}`);
  console.log(`  Total updated : ${updated}`);
  console.log(`  Skipped       : ${skipped}`);
  console.log(`  Exceptions    : ${exceptions.length}${exceptions.length ? " → " + JSON.stringify(exceptions.slice(0, 5)) : ""}`);
  console.log(`  Post-verify still owner-stamped: ${remaining} (expect 0)`);
  console.log(`  Backup (reversible): ${backupPath}`);
  console.log(`  Audit rows written: ${updated} (action="activity.actor-reconcile")\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
