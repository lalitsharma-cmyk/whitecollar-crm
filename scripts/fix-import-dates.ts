/**
 * scripts/fix-import-dates.ts
 *
 * Backfill script to correct import dates for leads that were affected by weak date parsing.
 *
 * Problem: Google Sheet importer had a naive parseDate() that failed on:
 * - Excel serial numbers (e.g., "45752")
 * - Indian date format (dd/mm/yyyy)
 * - Midnight dates (rendered as 5:30 AM IST instead of noon IST)
 *
 * This script:
 * 1. Finds all import batches (especially Yasir Khan's)
 * 2. For each lead in a batch, checks if rawImport contains date data
 * 3. Re-parses the date with the improved parser
 * 4. If it differs from the current createdAt, updates it
 * 5. Backfills lastTouchedAt to match
 * 6. Logs all changes to audit trail
 *
 * Usage:
 *   npx tsx scripts/fix-import-dates.ts [--dry-run] [--yasir-only]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { parseImportDate } from "@/lib/parseImportDate";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");

const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const dryRun = process.argv.includes("--dry-run");
const yasirOnly = process.argv.includes("--yasir-only");

const ist = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(d);

async function main() {
  console.log(`🔧 Import Date Backfill Script${dryRun ? " [DRY RUN]" : ""}`);
  console.log("═".repeat(60));

  // Find Lalit (actor for audit trail)
  const actor = await prisma.user.findFirst({
    where: { email: { equals: "LALITSHARMA@whitecollarrealty.com", mode: "insensitive" } },
    select: { id: true },
  });

  if (!actor) {
    console.error("⚠️ Could not find Lalit (LALITSHARMA@whitecollarrealty.com)");
  }

  // Find import batches: optionally filter to Yasir's
  let batchQuery: any = {};
  if (yasirOnly) {
    const yasir = await prisma.user.findFirst({
      where: { OR: [
        { name: { contains: "Yasir", mode: "insensitive" } },
        { email: { contains: "yasir", mode: "insensitive" } },
      ]},
      select: { id: true },
    });
    if (yasir) {
      batchQuery = { importedById: yasir.id };
      console.log(`Filtering to Yasir's imports (userId: ${yasir.id})`);
    } else {
      console.log("⚠️ Could not find Yasir — scanning all imports");
    }
  }

  const batches = await prisma.importBatch.findMany({
    where: batchQuery,
    select: { id: true, fileName: true, createdAt: true, totalRows: true },
    orderBy: { createdAt: "desc" },
  });

  console.log(`Found ${batches.length} import batches`);
  console.log("");

  let totalAudited = 0;
  let totalCorrected = 0;
  let totalFutureDated = 0;
  const correctionLog: Array<{
    leadId: string;
    name: string;
    oldDate: string;
    newDate: string;
    rawValue: string;
  }> = [];

  for (const batch of batches) {
    console.log(`📦 Batch: ${batch.fileName}`);
    console.log(`   Created: ${ist(batch.createdAt)} | Rows: ${batch.totalRows}`);

    const leads = await prisma.lead.findMany({
      where: { importBatchId: batch.id },
      select: {
        id: true,
        name: true,
        createdAt: true,
        lastTouchedAt: true,
        rawImport: true,
      },
    });

    let batchCorrected = 0;
    let batchFuture = 0;

    for (const lead of leads) {
      totalAudited++;
      const rawImport = (lead.rawImport as Record<string, string> | null) || {};

      // Look for date fields in rawImport
      const dateFields = [
        "Date",
        "date",
        "LeadDate",
        "leaddate",
        "CreatedDate",
        "createddate",
        "Created",
        "created",
        "DateGenerated",
        "dategenerated",
        "EntryDate",
        "entrydate",
      ];

      let dateRaw: string | null = null;
      for (const field of dateFields) {
        if (rawImport[field]) {
          dateRaw = rawImport[field];
          break;
        }
      }

      if (!dateRaw) continue; // No date data in rawImport

      // Re-parse with improved parser
      const reparsedDate = parseImportDate(dateRaw);
      if (!reparsedDate) continue; // Could not parse

      // Check if it differs from current createdAt
      const oldTime = lead.createdAt.getTime();
      const newTime = reparsedDate.getTime();

      if (oldTime === newTime) continue; // Already correct

      // Guard: reject future dates
      if (reparsedDate.getTime() > Date.now() + 24 * 3600 * 1000) {
        batchFuture++;
        totalFutureDated++;
        continue; // Don't backdate to future
      }

      // This one needs fixing
      batchCorrected++;
      totalCorrected++;

      correctionLog.push({
        leadId: lead.id,
        name: lead.name ?? "(unknown)",
        oldDate: ist(lead.createdAt),
        newDate: ist(reparsedDate),
        rawValue: dateRaw,
      });

      if (!dryRun) {
        // Update lead
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            createdAt: reparsedDate,
            lastTouchedAt: reparsedDate,
          },
        });

        // Audit trail
        if (actor) {
          await prisma.leadFieldHistory.create({
            data: {
              leadId: lead.id,
              field: "createdAt",
              oldValue: lead.createdAt.toISOString(),
              newValue: reparsedDate.toISOString(),
              changedById: actor.id,
              source: "import-date-backfill",
            },
          });
        }
      }
    }

    if (batchCorrected > 0 || batchFuture > 0) {
      console.log(`   ✓ Audited: ${leads.length} leads`);
      if (batchCorrected > 0) console.log(`   ✏️  Corrected: ${batchCorrected}`);
      if (batchFuture > 0) console.log(`   ⚠️  Future-dated (skipped): ${batchFuture}`);
    } else {
      console.log(`   ✓ All ${leads.length} leads already correct`);
    }
    console.log("");
  }

  // Summary
  console.log("═".repeat(60));
  console.log("SUMMARY");
  console.log("═".repeat(60));
  console.log(`Total leads audited:     ${totalAudited}`);
  console.log(`Total records corrected: ${totalCorrected}`);
  console.log(`Total future-dated:      ${totalFutureDated} (skipped)`);

  if (dryRun) {
    console.log("\n🔍 DRY RUN — No changes made");
  } else {
    console.log("\n✅ Changes applied and audit trail written");
  }

  // Write detailed log
  if (correctionLog.length > 0) {
    const logPath = `./backups/import-date-corrections-${Date.now()}.json`;
    writeFileSync(
      logPath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          dryRun,
          totalCorrected: correctionLog.length,
          corrections: correctionLog.slice(0, 100),
        },
        null,
        2
      )
    );
    console.log(`\n📝 Detailed log: ${logPath}`);
  }

  // Sample before/after
  if (correctionLog.length > 0) {
    console.log("\n📋 Sample corrections (first 5):");
    for (const item of correctionLog.slice(0, 5)) {
      console.log(`  ${item.name}`);
      console.log(`    Raw value: "${item.rawValue}"`);
      console.log(`    Was:  ${item.oldDate}`);
      console.log(`    Now:  ${item.newDate}`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  return prisma.$disconnect().then(() => process.exit(1));
});
