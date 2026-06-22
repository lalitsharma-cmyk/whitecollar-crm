/**
 * scripts/audit-import-dates.ts
 *
 * READ-ONLY diagnostic to identify leads with potentially wrong createdAt values.
 * Helps understand the scope of the date parsing problem before running backfill.
 *
 * Usage:
 *   npx tsx scripts/audit-import-dates.ts [--yasir-only] [--detail]
 */

import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { parseImportDate } from "@/lib/parseImportDate";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");

const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const yasirOnly = process.argv.includes("--yasir-only");
const detail = process.argv.includes("--detail");

const ist = (d: Date) =>
  new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(d);

async function main() {
  console.log("🔍 Import Date Audit — Diagnostic Report");
  console.log("═".repeat(70));

  // Optionally filter to Yasir
  let filter: any = {};
  if (yasirOnly) {
    const yasir = await prisma.user.findFirst({
      where: {
        OR: [
          { name: { contains: "Yasir", mode: "insensitive" } },
          { email: { contains: "yasir", mode: "insensitive" } },
        ],
      },
      select: { id: true, name: true, email: true },
    });
    if (yasir) {
      filter = { importedById: yasir.id };
      console.log(`Filtering to Yasir Khan's imports`);
      console.log(`  Name: ${yasir.name}`);
      console.log(`  Email: ${yasir.email}`);
    } else {
      console.log("⚠️ Could not find Yasir — auditing all imports");
    }
  }

  const batches = await prisma.importBatch.findMany({
    where: filter,
    select: {
      id: true,
      fileName: true,
      importType: true,
      createdAt: true,
      totalRows: true,
      createdCount: true,
      importedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  console.log(`\nFound ${batches.length} import batches\n`);

  let totalLeads = 0;
  let totalWithDateData = 0;
  let totalMismatch = 0;
  let totalFuture = 0;

  const issues: Array<{
    batch: string;
    leadId: string;
    name: string;
    dbDate: string;
    parsedDate: string;
    rawValue: string;
    type: "mismatch" | "future";
  }> = [];

  for (const batch of batches) {
    console.log(`📦 ${batch.fileName}`);
    console.log(`   By: ${batch.importedBy?.name || "(unknown)"}`);
    console.log(`   When: ${ist(batch.createdAt)}`);
    console.log(`   Type: ${batch.importType} | Rows: ${batch.totalRows}`);

    const leads = await prisma.lead.findMany({
      where: { importBatchId: batch.id },
      select: {
        id: true,
        name: true,
        createdAt: true,
        rawImport: true,
      },
    });

    let batchDateCount = 0;
    let batchMismatch = 0;
    let batchFuture = 0;

    for (const lead of leads) {
      totalLeads++;
      const rawImport = (lead.rawImport as Record<string, string> | null) || {};

      // Find date field
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

      if (!dateRaw) continue;
      totalWithDateData++;
      batchDateCount++;

      // Re-parse
      const reparsedDate = parseImportDate(dateRaw);
      if (!reparsedDate) continue;

      const oldTime = lead.createdAt.getTime();
      const newTime = reparsedDate.getTime();

      if (oldTime === newTime) continue; // Correct

      // Check if future
      const isFuture = reparsedDate.getTime() > Date.now() + 24 * 3600 * 1000;
      if (isFuture) {
        batchFuture++;
        totalFuture++;
        issues.push({
          batch: batch.fileName,
          leadId: lead.id,
          name: lead.name ?? "(unknown)",
          dbDate: ist(lead.createdAt),
          parsedDate: ist(reparsedDate),
          rawValue: dateRaw,
          type: "future",
        });
      } else {
        batchMismatch++;
        totalMismatch++;
        issues.push({
          batch: batch.fileName,
          leadId: lead.id,
          name: lead.name ?? "(unknown)",
          dbDate: ist(lead.createdAt),
          parsedDate: ist(reparsedDate),
          rawValue: dateRaw,
          type: "mismatch",
        });
      }
    }

    if (batchDateCount > 0) {
      const pct = ((batchDateCount / leads.length) * 100).toFixed(0);
      console.log(`   📊 Leads with date data: ${batchDateCount}/${leads.length} (${pct}%)`);
      if (batchMismatch > 0) {
        console.log(`      ⚠️  Would correct: ${batchMismatch}`);
      }
      if (batchFuture > 0) {
        console.log(`      🚫 Future-dated: ${batchFuture}`);
      }
    }
    console.log("");
  }

  console.log("═".repeat(70));
  console.log("SUMMARY");
  console.log("═".repeat(70));
  console.log(`Total leads:             ${totalLeads}`);
  console.log(`With date in rawImport:  ${totalWithDateData}`);
  console.log(`Date mismatches:         ${totalMismatch}`);
  console.log(`Future-dated:            ${totalFuture}`);

  if (detail && issues.length > 0) {
    console.log("\n📋 All issues found:");
    for (const issue of issues.slice(0, 50)) {
      console.log(`\n  Lead: ${issue.name} (${issue.leadId})`);
      console.log(`    Batch: ${issue.batch}`);
      console.log(`    Raw:   "${issue.rawValue}"`);
      console.log(`    DB:    ${issue.dbDate}`);
      console.log(`    Parse: ${issue.parsedDate}`);
      console.log(`    Type:  ${issue.type}`);
    }
    if (issues.length > 50) {
      console.log(`\n  ... and ${issues.length - 50} more`);
    }
  } else if (issues.length > 0) {
    console.log("\nRun with --detail to see all issues");
  }

  if (totalMismatch > 0) {
    console.log(`\n✏️  To fix these mismatches, run:`);
    console.log(`   npx tsx scripts/fix-import-dates.ts${yasirOnly ? " --yasir-only" : ""}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  return prisma.$disconnect().then(() => process.exit(1));
});
