/**
 * scripts/backfill-sourceraw-from-enum.ts
 *
 * FIX 3 (data-integrity batch 2026-06-25): backfill Lead.sourceRaw from a human
 * label of the Lead.source enum, for live leads where sourceRaw IS NULL.
 *
 * WHY: the Source column filter is built from the DISTINCT non-null sourceRaw
 * values. 54 live leads (mostly CSV_IMPORT) have sourceRaw = NULL while the
 * `source` enum IS set — so those leads are silently OMITTED from the Source
 * filter dropdown and can't be filtered to. `Lead.source` is non-nullable
 * (@default(WEBSITE)), so the only gap is sourceRaw IS NULL.
 *
 * VALUE: sourceRaw = sourceEnumLabel(source) — the SAME mapping the rest of the
 * CRM uses (WEBSITE→"Website", CSV_IMPORT→"CSV Import", …). This is provenance
 * DISPLAY only — additive. The `source` enum is unchanged; effectiveSource()
 * already prefers sourceRaw, so display/filters/reports now include these leads.
 *
 * SAFE + IDEMPOTENT:
 *   • Only leads with deletedAt:null AND sourceRaw null — never overwrites a
 *     verbatim sheet value. Re-running is a no-op.
 *   • Backs up affected leads (id, name, source, prior sourceRaw=null) to backups/.
 *   • Writes a LeadFieldHistory audit row per lead (field "sourceRaw", null→label,
 *     source "sourceraw-enum-backfill").
 *   • Reads back a verification count.
 *
 * Usage:
 *   npx tsx scripts/backfill-sourceraw-from-enum.ts --dry-run   # report only
 *   npx tsx scripts/backfill-sourceraw-from-enum.ts             # apply
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { sourceEnumLabel } from "../src/lib/sourceLabel";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const dryRun = process.argv.includes("--dry-run");

async function main() {
  console.log(`🏷  sourceRaw backfill from source enum${dryRun ? " [DRY RUN]" : ""}`);
  console.log("═".repeat(64));

  const actor = await prisma.user.findFirst({
    where: { email: { equals: "LALITSHARMA@whitecollarrealty.com", mode: "insensitive" } },
    select: { id: true },
  });

  const leads = await prisma.lead.findMany({
    where: { deletedAt: null, sourceRaw: null },
    select: { id: true, name: true, source: true },
  });
  console.log(`Live leads with sourceRaw NULL: ${leads.length}`);

  const changes: Array<{ id: string; name: string | null; source: string; sourceRaw: string }> = [];
  const dist = new Map<string, number>();
  for (const l of leads) {
    const label = sourceEnumLabel(l.source);
    // sourceEnumLabel returns "Unknown" only for null/undefined; source is non-null
    // so this is always a real label. Guard anyway — never write "Unknown".
    if (!label || label === "Unknown") continue;
    changes.push({ id: l.id, name: l.name, source: l.source, sourceRaw: label });
    dist.set(label, (dist.get(label) ?? 0) + 1);
  }
  console.log(`Will backfill: ${changes.length}`);
  for (const [lab, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) console.log(`   → "${lab}"   ${n}`);

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `./backups/sourceraw-enum-backfill-${stamp}.json`;
  writeFileSync(backupPath, JSON.stringify({ timestamp: new Date().toISOString(), dryRun, fix: "FIX3 sourceRaw from source enum", count: changes.length, changes }, null, 2));
  console.log(`\n📝 Backup (${changes.length} rows): ${backupPath}`);

  if (dryRun) { console.log("\n🔍 DRY RUN — no changes made"); await prisma.$disconnect(); return; }

  let applied = 0;
  for (const c of changes) {
    await prisma.lead.update({ where: { id: c.id }, data: { sourceRaw: c.sourceRaw } });
    if (actor) {
      await prisma.leadFieldHistory.create({
        data: {
          leadId: c.id, field: "sourceRaw",
          oldValue: null, newValue: c.sourceRaw,
          changedById: actor.id, source: "sourceraw-enum-backfill",
        },
      }).catch(() => {});
    }
    applied++;
  }
  console.log(`\n✅ Backfilled sourceRaw on: ${applied} leads`);

  const remaining = await prisma.lead.count({ where: { deletedAt: null, sourceRaw: null } });
  console.log(`Read-back · live leads STILL sourceRaw null: ${remaining} (expected 0)`);
  const distinctNow = await prisma.lead.findMany({ where: { deletedAt: null, sourceRaw: { not: null } }, select: { sourceRaw: true }, distinct: ["sourceRaw"] });
  console.log(`Read-back · distinct non-null sourceRaw values now: ${distinctNow.length}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
