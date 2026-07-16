// ─────────────────────────────────────────────────────────────────────────────
// backfill-created-datetime.ts — fix Created Date/Time on EXISTING imported leads
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY (Item #3, Lalit created-date rule 2026-07-15)
//   "Created Date" = the Date column; "Created Time" = a SEPARATE Time column; when
//   the sheet had NO Time column the Created Time must display BLANK. Two historical
//   defects this heals for already-imported leads:
//     1. TIME UNKNOWN → BLANK: rows imported from a sheet with no Time column carry a
//        fabricated noon/midnight time. We set the new Lead.createdTimeKnown=false so
//        the list/detail render Created Time blank. (Purely additive — the column is
//        null on every existing row, so this is zero-risk.)
//     2. IMPORT-TIME LEAK: some rows got today's import timestamp as createdAt instead
//        of the sheet's Date. Where the verbatim rawImport still holds a Date column
//        whose IST day DIFFERS from the stored createdAt, re-derive createdAt from it
//        (date + Time column when present). Gated to a real day-level discrepancy so
//        we never churn a correct date over a mere noon-vs-time difference.
//
//   Derivation uses the SAME helpers the importer uses (detectDateColumn /
//   detectTimeColumn / parseImportDate / applyTimeToDate) read off Lead.rawImport
//   (the immutable original row). NOTE: it AUTO-DETECTS the date/time columns; a lead
//   whose admin mapped an unusual column as the Date may re-derive from a different
//   column — the DRY-RUN report lists every createdAt day-change so a human verifies
//   before --apply.
//
// SAFETY
//   • DEFAULT = DRY-RUN: reads only, prints a report, writes NOTHING.
//   • --apply: writes a JSON backup to backups/ FIRST, then updates only changed
//     fields. Per-row try/catch — one bad row logs + is skipped; never aborts.
//   • NEVER touches remarks / rawImport / history. Only createdAt + createdTimeKnown.
//   • Future-dated sheet values are NEVER written to createdAt (same guard as import).
//
//   npx tsx scripts/backfill-created-datetime.ts           # dry-run (safe on prod)
//   npx tsx scripts/backfill-created-datetime.ts --apply   # write
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { parseImportDate, detectDateColumn, detectTimeColumn, applyTimeToDate } from "../src/lib/parseImportDate";

const APPLY = process.argv.includes("--apply");
const env = readFileSync("C:/Users/Lenovo/whitecollar-crm/.env", "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

// IST calendar-day key (UTC+5:30) — two instants share a day iff these match.
const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

type Row = {
  id: string;
  name: string;
  createdAt: Date;
  createdTimeKnown: boolean | null;
  importBatchId: string | null;
  rawImport: unknown;
};

type Plan = {
  row: Row;
  newCreatedAt: Date | null;      // set only when a day-level correction applies
  newTimeKnown: boolean;          // the recomputed createdTimeKnown
  dateChanged: boolean;
  timeKnownChanged: boolean;
};

function planFor(row: Row): Plan | null {
  const raw = row.rawImport;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return null;

  const dateCol = detectDateColumn(keys);
  const timeCol = detectTimeColumn(keys);

  const dateVal = dateCol ? String(obj[dateCol] ?? "") : "";
  const parsedDate = dateCol ? parseImportDate(dateVal) : undefined;
  const dateIsFuture = !!parsedDate && parsedDate.getTime() > Date.now() + 24 * 3600 * 1000;

  const timeVal = timeCol ? String(obj[timeCol] ?? "") : "";
  const hasTime = !!timeVal && /\d{1,2}[:.]\d{2}/.test(timeVal);

  // createdTimeKnown = true ONLY when a valid, non-future Date anchored a parseable
  // Time (identical to the importer's write-path rule). Everything else → false.
  const newTimeKnown = !!parsedDate && !dateIsFuture && hasTime;

  // createdAt correction: only on a real IST-day discrepancy (import-time leak).
  let newCreatedAt: Date | null = null;
  if (parsedDate && !dateIsFuture && istDay(parsedDate) !== istDay(row.createdAt)) {
    newCreatedAt = hasTime ? applyTimeToDate(parsedDate, timeVal) : parsedDate;
  }

  const dateChanged = newCreatedAt != null && newCreatedAt.getTime() !== row.createdAt.getTime();
  const timeKnownChanged = row.createdTimeKnown !== newTimeKnown;
  if (!dateChanged && !timeKnownChanged) return null;
  return { row, newCreatedAt: dateChanged ? newCreatedAt : null, newTimeKnown, dateChanged, timeKnownChanged };
}

async function main() {
  console.log(`\n${APPLY ? "APPLY" : "DRY-RUN"} — Lead createdAt / createdTimeKnown backfill (imported rows)\n`);

  // SCOPE = import-CREATED rows only (importBatchId set). Deliberately NOT every
  // rawImport-bearing row: a real-time website/manual lead later ENRICHED by a sheet
  // dedupe also carries the sheet's Date in its merged rawImport, but its createdAt is
  // a genuine creation moment we must not retroactively rewrite/blank. importBatchId is
  // stamped on every NEW import row, so this precisely targets rows whose createdAt +
  // time came from the sheet. (Trade-off: pre-importBatchId legacy imports aren't
  // auto-detected — negligible today; review by hand if ever needed.)
  const leads: Row[] = await prisma.lead.findMany({
    where: { importBatchId: { not: null } },
    select: { id: true, name: true, createdAt: true, createdTimeKnown: true, importBatchId: true, rawImport: true },
  });

  const plans: Plan[] = [];
  for (const l of leads) {
    const p = planFor(l);
    if (p) plans.push(p);
  }

  const dateChanges = plans.filter((p) => p.dateChanged);
  const timeBlanks = plans.filter((p) => p.timeKnownChanged && p.newTimeKnown === false);
  const timeReveals = plans.filter((p) => p.timeKnownChanged && p.newTimeKnown === true);

  console.log(`Imported rows scanned:          ${leads.length}`);
  console.log(`Rows that would change:         ${plans.length}`);
  console.log(`  • createdAt day corrections:  ${dateChanges.length}  (import-time leak → sheet Date)`);
  console.log(`  • Created Time → blank:        ${timeBlanks.length}  (no Time column)`);
  console.log(`  • Created Time → shown:        ${timeReveals.length}  (Time column parsed)`);

  const dateSamples = dateChanges.slice(0, 20);
  if (dateSamples.length) {
    console.log(`\n--- Sample createdAt corrections (${dateSamples.length} of ${dateChanges.length}) ---`);
    for (const p of dateSamples) {
      console.log(`  ${p.row.name}:  ${istDay(p.row.createdAt)} → ${p.newCreatedAt ? istDay(p.newCreatedAt) : "?"}  (timeKnown=${p.newTimeKnown})`);
    }
  }

  if (!APPLY) {
    console.log(`\nDRY-RUN — nothing written. Re-run with --apply to write.`);
    await prisma.$disconnect();
    return;
  }
  if (plans.length === 0) {
    console.log(`\n✅ Nothing to do (idempotent).`);
    await prisma.$disconnect();
    return;
  }

  // ── Backup (rollback artifact): id → prior createdAt + createdTimeKnown ──
  mkdirSync("C:/Users/Lenovo/whitecollar-crm/backups", { recursive: true });
  const TS = new Date().toISOString().replace(/[:.]/g, "-");
  const file = `backups/backfill-created-datetime-${TS}.json`;
  writeFileSync(
    `C:/Users/Lenovo/whitecollar-crm/${file}`,
    JSON.stringify(
      plans.map((p) => ({
        id: p.row.id,
        oldCreatedAt: p.row.createdAt.toISOString(),
        oldCreatedTimeKnown: p.row.createdTimeKnown,
        newCreatedAt: p.newCreatedAt ? p.newCreatedAt.toISOString() : p.row.createdAt.toISOString(),
        newCreatedTimeKnown: p.newTimeKnown,
      })),
      null,
      2,
    ),
  );
  console.log(`\n🔒 Backup → ${file}`);

  let updated = 0;
  const errors: { id: string; name: string; message: string }[] = [];
  for (const p of plans) {
    const data: { createdAt?: Date; createdTimeKnown?: boolean } = {};
    if (p.dateChanged && p.newCreatedAt) data.createdAt = p.newCreatedAt;
    if (p.timeKnownChanged) data.createdTimeKnown = p.newTimeKnown;
    if (Object.keys(data).length === 0) continue;
    try {
      await prisma.lead.update({ where: { id: p.row.id }, data });
      updated++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      errors.push({ id: p.row.id, name: p.row.name, message });
      console.log(`   ✗ skipped ${p.row.name} (${p.row.id}): ${message}`);
    }
  }

  console.log(`\n--- Summary ---`);
  console.log(`Rows updated: ${updated}`);
  console.log(`Errors:       ${errors.length}`);
  console.log(`\nDone.`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
