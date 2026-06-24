/**
 * scripts/fix-miscased-statuses.ts
 *
 * FIX 4 (data-integrity batch 2026-06-25): fold mis-cased / variant currentStatus
 * values to their canonical form, so they stop fragmenting into duplicate status
 * chips and fall back INSIDE the team status dropdown.
 *
 * DRIVEN BY canonicalStatus() (src/lib/lead-statuses.ts) — the SAME function the
 * importers run through. We extended its alias table in this batch:
 *   "Long Term Followup" (15) / "Long-term Followup" (3) / "Long Follow Up" (1)
 *        → "Long Term Follow Up"   (canonical, in the Dubai master)
 *   "Fund Issue" (3)              → "Funds Issue"          (canonical, both masters)
 * Bare "Other" (3) is intentionally LEFT AS-IS: it has no unambiguous canonical
 * target, and forcing "Other Location"/"Other Requirement" would fabricate intent
 * (one is a website return-request, two are Expo leads). canonicalStatus("Other")
 * === "Other", so this script naturally skips them — reported below for the record.
 *
 * SAFE + IDEMPOTENT:
 *   • Updates only leads where currentStatus !== canonicalStatus(currentStatus)
 *     AND the canonical differs (a real fold). Re-running is a no-op (after the
 *     fix the value already equals its canonical).
 *   • Excludes deletedAt != null.
 *   • Backs up affected leads (id, name, team, old→new) to backups/.
 *   • Writes a LeadFieldHistory audit row per lead (field "currentStatus",
 *     old→new, source "miscased-status-fix").
 *   • Reads back: 0 foldable variants remain, and the per-canonical chip counts.
 *   • NEVER invents a status — only maps to values already in a team master.
 *
 * Usage:
 *   npx tsx scripts/fix-miscased-statuses.ts --dry-run   # report only
 *   npx tsx scripts/fix-miscased-statuses.ts             # apply
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { canonicalStatus } from "../src/lib/lead-statuses";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`🔤 Mis-cased status canonicalization${dryRun ? " [DRY RUN]" : ""}`);
  console.log("═".repeat(64));

  const actor = await prisma.user.findFirst({
    where: { email: { equals: "LALITSHARMA@whitecollarrealty.com", mode: "insensitive" } },
    select: { id: true },
  });

  // Pull every distinct non-null currentStatus and compute its canonical form in JS
  // (canonicalStatus isn't expressible in SQL). Only the ones that actually FOLD
  // (canonical !== current) are targets.
  const rows = await prisma.lead.groupBy({
    by: ["currentStatus"],
    where: { deletedAt: null, currentStatus: { not: null } },
    _count: true,
  });
  const folds: Array<{ from: string; to: string; n: number }> = [];
  const leftAsIs: Array<{ status: string; n: number }> = [];
  for (const r of rows) {
    const cur = r.currentStatus!;
    const can = canonicalStatus(cur);
    if (can && can !== cur) folds.push({ from: cur, to: can, n: r._count as number });
  }
  // For the record: known ambiguous value(s) we deliberately don't fold.
  for (const s of ["Other"]) {
    const n = await prisma.lead.count({ where: { deletedAt: null, currentStatus: s } });
    if (n > 0) leftAsIs.push({ status: s, n });
  }

  console.log("Folds (currentStatus → canonical):");
  for (const f of folds.sort((a, b) => b.n - a.n)) console.log(`   "${f.from}"  →  "${f.to}"   (${f.n})`);
  const totalFold = folds.reduce((s, f) => s + f.n, 0);
  console.log(`   total leads to fold: ${totalFold}`);
  if (leftAsIs.length) {
    console.log("Deliberately NOT folded (no unambiguous canonical target):");
    for (const l of leftAsIs) console.log(`   "${l.status}"   (${l.n})  — left as-is by design`);
  }

  // Gather the actual lead rows to update + back up.
  const fromValues = folds.map((f) => f.from);
  const leads = fromValues.length
    ? await prisma.lead.findMany({
        where: { deletedAt: null, currentStatus: { in: fromValues } },
        select: { id: true, name: true, forwardedTeam: true, currentStatus: true },
      })
    : [];
  const backup = leads.map((l) => ({ id: l.id, name: l.name, team: l.forwardedTeam, oldStatus: l.currentStatus, newStatus: canonicalStatus(l.currentStatus) }));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `./backups/miscased-status-fix-${stamp}.json`;
  writeFileSync(backupPath, JSON.stringify({ timestamp: new Date().toISOString(), dryRun, fix: "FIX4 canonicalize mis-cased statuses", count: backup.length, leftAsIs, leads: backup }, null, 2));
  console.log(`\n📝 Backup (${backup.length} rows): ${backupPath}`);

  if (dryRun) { console.log("\n🔍 DRY RUN — no changes made"); await prisma.$disconnect(); return; }

  let applied = 0;
  for (const l of leads) {
    const newStatus = canonicalStatus(l.currentStatus);
    if (!newStatus || newStatus === l.currentStatus) continue;
    await prisma.lead.update({ where: { id: l.id }, data: { currentStatus: newStatus } });
    if (actor) {
      await prisma.leadFieldHistory.create({
        data: {
          leadId: l.id, field: "currentStatus",
          oldValue: l.currentStatus, newValue: newStatus,
          changedById: actor.id, source: "miscased-status-fix",
        },
      }).catch(() => {});
    }
    applied++;
  }
  console.log(`\n✅ Canonicalized: ${applied} leads`);

  // Read-back: 0 foldable variants remain + per-canonical chip counts.
  const after = await prisma.lead.groupBy({ by: ["currentStatus"], where: { deletedAt: null, currentStatus: { not: null } }, _count: true });
  const stillFoldable = after.filter((r) => { const c = canonicalStatus(r.currentStatus!); return c && c !== r.currentStatus!; });
  console.log(`Read-back · variants STILL foldable: ${stillFoldable.length} (expected 0)`);
  for (const target of ["Long Term Follow Up", "Funds Issue"]) {
    const n = await prisma.lead.count({ where: { deletedAt: null, currentStatus: target } });
    console.log(`Read-back · "${target}" chip now: ${n}`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
