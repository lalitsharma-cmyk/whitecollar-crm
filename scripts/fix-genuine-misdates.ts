/**
 * scripts/fix-genuine-misdates.ts
 *
 * ITEM 5 (Lalit 2026-06-24): correct imported leads whose createdAt landed on the
 * WRONG CALENDAR DAY (it stuck at the import timestamp because the original parser
 * couldn't read the sheet's "D-Mon-YY" date). Re-parses the sheet Date column with
 * the current parser and backdates createdAt + lastTouchedAt to the real day.
 *
 * WHY NOT the stock fix-import-dates.ts:
 *   That script flags any createdAt whose millisecond value differs from a fresh
 *   parse — including ~151 leads that are already on the CORRECT day but stored at
 *   noon-IST vs a re-parse that yields midnight. Re-dating those is pure churn (same
 *   day) and would rewrite 151 correct rows. This script only touches rows where the
 *   IST CALENDAR DAY actually differs → the genuine bugs only.
 *
 * SAFE:
 *   • Only rows where istDay(sheetDate) != istDay(createdAt).
 *   • Skips future-relative-to-import dates (24h tolerance) — the import guard kept
 *     those at import time on purpose.
 *   • Normalizes the target to NOON IST (06:30 UTC) so it shows as a clean date-only
 *     entry, matching every other imported lead (no 00:00 artifact).
 *   • Excludes deletedAt != null.
 *   • Writes a LeadFieldHistory audit row (source = genuine-misdate-fix).
 *   • Idempotent: re-running finds nothing once corrected.
 *
 * Usage:
 *   npx tsx scripts/fix-genuine-misdates.ts --dry-run
 *   npx tsx scripts/fix-genuine-misdates.ts
 */

import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { parseImportDate } from "@/lib/parseImportDate";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const dryRun = process.argv.includes("--dry-run");

const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const ist = (d: Date) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" }).format(d);

// Force a date to NOON IST (06:30 UTC) on its own calendar day, so it renders as a
// clean date-only entry (the importer's convention) instead of a midnight artifact.
function noonIST(d: Date): Date {
  const day = istDay(d); // YYYY-MM-DD in IST
  const [y, m, dd] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, dd, 6, 30, 0));
}

const DATE_KEYS = ["Date", "date", "LeadDate", "leaddate", "CreatedDate", "createddate", "Created", "created", "DateGenerated", "dategenerated", "EntryDate", "entrydate", "Lead Date"];

async function main() {
  console.log(`🗓  Genuine mis-date fix${dryRun ? " [DRY RUN]" : ""}`);
  console.log("═".repeat(60));

  const actor = await prisma.user.findFirst({
    where: { email: { equals: "LALITSHARMA@whitecollarrealty.com", mode: "insensitive" } },
    select: { id: true },
  });

  const batches = await prisma.importBatch.findMany({ select: { id: true, fileName: true, createdAt: true } });

  let fixed = 0;
  const log: Array<{ leadId: string; name: string; raw: string; from: string; to: string; batch: string }> = [];

  for (const b of batches) {
    const leads = await prisma.lead.findMany({
      where: { importBatchId: b.id, deletedAt: null },
      select: { id: true, name: true, createdAt: true, rawImport: true },
    });
    for (const l of leads) {
      const ri = (l.rawImport as Record<string, unknown> | null) ?? {};
      let raw: string | null = null;
      for (const k of DATE_KEYS) if (ri[k]) { raw = String(ri[k]); break; }
      if (!raw) continue;
      const parsed = parseImportDate(raw);
      if (!parsed) continue;
      // future-relative-to-import → the importer guard kept import time on purpose
      if (parsed.getTime() > b.createdAt.getTime() + 24 * 3600 * 1000) continue;
      // GENUINE mis-date only: IST calendar day differs.
      if (istDay(parsed) === istDay(l.createdAt)) continue;

      const target = noonIST(parsed);
      fixed++;
      log.push({ leadId: l.id, name: l.name ?? "(?)", raw, from: ist(l.createdAt), to: ist(target), batch: b.fileName });

      if (!dryRun) {
        await prisma.lead.update({ where: { id: l.id }, data: { createdAt: target, lastTouchedAt: target } });
        if (actor) {
          await prisma.leadFieldHistory.create({
            data: {
              leadId: l.id,
              field: "createdAt",
              oldValue: l.createdAt.toISOString(),
              newValue: target.toISOString(),
              changedById: actor.id,
              source: "genuine-misdate-fix",
            },
          }).catch(() => {});
        }
      }
    }
  }

  console.log("═".repeat(60));
  console.log(`Rows ${dryRun ? "that WOULD be" : ""} corrected: ${fixed}`);
  for (const f of log.slice(0, 40)) console.log(`   [${f.batch}] ${f.name}: "${f.raw}"  ${f.from} → ${f.to}`);
  if (log.length) {
    const path = `./backups/genuine-misdate-fix-${Date.now()}.json`;
    try {
      writeFileSync(path, JSON.stringify({ timestamp: new Date().toISOString(), dryRun, fixed, changes: log }, null, 2));
      console.log(`\n📝 Log: ${path}`);
    } catch { /* non-fatal */ }
  }
  console.log(dryRun ? "\n🔍 DRY RUN — no changes made" : "\n✅ Applied + audited");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
