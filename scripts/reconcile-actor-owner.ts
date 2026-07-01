// ────────────────────────────────────────────────────────────────────────────
// scripts/reconcile-actor-owner.ts — historical actor-vs-owner reconciliation
//
//   DRY RUN (default, READ-ONLY):   npx tsx scripts/reconcile-actor-owner.ts
//   APPLY  (writes, gated):         npx tsx scripts/reconcile-actor-owner.ts --apply
//
// WHAT IT FIXES (owner-approved scope ONLY):
//   System-created Activity rows that were wrongly stamped with the lead OWNER as
//   the actor. These are deterministically identifiable by their title prefix and
//   were created by AUTOMATION / import code — they have NO human actor, so the
//   correct value is userId = NULL (renders "System"):
//     • "Duplicate intake from …"          (leadIngest dup-detection)   → null
//     • "🤖 …"                              (workflowEngine CREATE_TASK)  → null
//     • "Revival import — re-engaged from …" (revivalImport)             → null*
//   *Revival-import rows SHOULD carry the importer, not null — but historically we
//    only stored the owner and the original importer is unrecoverable, so we set
//    null ("System") rather than GUESS. (Prod currently has 0 such rows.)
//
// WHAT IT DELIBERATELY DOES NOT TOUCH (per Lalit's "never guess" rule):
//   • Acefone inbound CallLogs stamped with the owner via the old fallback — we
//     cannot distinguish "owner genuinely took the call" from "owner-fallback",
//     so they are LEFT UNCHANGED.
//   • Outbound WhatsApp — no actor was ever recorded; nothing to reconcile.
//   • Any human-created Activity/Note — already correct.
//
// SAFETY (production rules):
//   • DRY RUN by default — prints the exact rows and counts, writes NOTHING.
//   • --apply first writes a full JSON backup (id + old userId + owner + title)
//     to backups/ before any UPDATE, then runs inside a single transaction.
//   • Reversible: the backup lets us restore every prior userId exactly.
//   • Idempotent: re-running only touches rows that still have a non-null actor.
// ────────────────────────────────────────────────────────────────────────────
import { prisma } from "../src/lib/prisma";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const APPLY = process.argv.includes("--apply");

const PATTERNS = [
  { label: "duplicate-intake", startsWith: "Duplicate intake from" },
  { label: "workflow-task", startsWith: "🤖 " },
  { label: "revival-import", startsWith: "Revival import — re-engaged from" },
];

async function main() {
  console.log(`\n╔══ ACTOR-OWNER RECONCILIATION — ${APPLY ? "APPLY (WRITES)" : "DRY RUN (read-only)"} ══╗\n`);

  const affected: Array<{ id: string; label: string; oldUserId: string; oldUserName: string | null; ownerId: string | null; title: string; createdAt: string }> = [];

  for (const p of PATTERNS) {
    const rows = await prisma.activity.findMany({
      where: { title: { startsWith: p.startsWith }, userId: { not: null } },
      select: { id: true, title: true, userId: true, createdAt: true, user: { select: { name: true } }, lead: { select: { ownerId: true } } },
    });
    for (const r of rows) {
      affected.push({
        id: r.id, label: p.label, oldUserId: r.userId as string, oldUserName: r.user?.name ?? null,
        ownerId: r.lead?.ownerId ?? null, title: r.title, createdAt: r.createdAt.toISOString(),
      });
    }
    console.log(`  ${p.label.padEnd(18)} rows to reset → null: ${rows.length}`);
  }

  console.log(`\n  TOTAL rows to reconcile: ${affected.length}`);
  if (affected.length === 0) { console.log("\n  Nothing to do.\n"); await prisma.$disconnect(); return; }

  // How many still point at the CURRENT owner (confirms the owner-stamp origin)
  const stillOwner = affected.filter(a => a.oldUserId === a.ownerId).length;
  console.log(`  ...of which userId still == current owner: ${stillOwner} (rest = owner-at-creation, ownership since changed)\n`);

  console.log("  Sample (up to 10):");
  for (const a of affected.slice(0, 10)) {
    console.log(`    ${a.id} | ${a.label} | "${a.title.slice(0, 36)}" | ${a.createdAt.slice(0, 10)} | BEFORE=${a.oldUserName ?? a.oldUserId} → AFTER=System`);
  }

  if (!APPLY) {
    console.log(`\n  DRY RUN — no changes written. Re-run with --apply (after approval) to execute.\n`);
    await prisma.$disconnect();
    return;
  }

  // ── APPLY path (gated) ──────────────────────────────────────────────────────
  const stamp = process.env.RECONCILE_STAMP || "manual"; // pass a timestamp via env to avoid Date.now()
  const backupPath = join(process.cwd(), "backups", `reconcile-actor-owner-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify({ generatedStamp: stamp, count: affected.length, rows: affected }, null, 2), "utf8");
  console.log(`\n  Backup written: ${backupPath}`);

  const ids = affected.map(a => a.id);
  const res = await prisma.$transaction(async (tx) => {
    return tx.activity.updateMany({ where: { id: { in: ids }, userId: { not: null } }, data: { userId: null } });
  });
  console.log(`  ✅ Updated ${res.count} Activity rows → userId=null (System).`);
  console.log(`  Reversible via the backup JSON above.\n`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
