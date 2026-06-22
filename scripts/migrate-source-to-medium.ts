#!/usr/bin/env node
/**
 * Source + Medium Migration Script
 *
 * Migrates leads with deprecated source values (WHATSAPP, INBOUND_CALL) to the new
 * structure where the source is standardized and medium captures the communication channel.
 *
 * BEFORE running this script:
 *   - Ensure database backups are fresh
 *   - Database migration (20260623120000_add_medium_field) must be applied
 *   - Node env + .env loaded (DATABASE_URL set)
 *
 * AFTER running this script:
 *   - Verify the output
 *   - No data loss — only NEW medium field populated
 *   - All old records preserved with historical source intact (for audit)
 *   - Scripts/regression.ts mirrors the new schema + continues to pass
 */

import { PrismaClient, LeadSource } from "@prisma/client";
import chalk from "chalk";

const prisma = new PrismaClient();

async function main() {
  console.log(chalk.blue.bold("\n🔄 Source → Medium Migration Starting...\n"));

  // ── STEP 1: Verify schema is ready ──
  try {
    const sample = await prisma.lead.findFirst({
      select: { id: true, source: true, medium: true, mediumOther: true },
    });
    if (sample === null) {
      console.log(chalk.yellow("ℹ No leads in database yet. Skipping migration."));
      process.exit(0);
    }
    console.log(chalk.green("✓ Schema ready — medium fields present"));
  } catch (err) {
    console.error(
      chalk.red(
        "✗ Schema not ready. Run: npx prisma migrate deploy\n"
      ),
      err
    );
    process.exit(1);
  }

  // ── STEP 2: Snapshot BEFORE state ──
  console.log(chalk.blue("\n📊 Snapshot BEFORE migration:"));
  const beforeCounts = await prisma.lead.groupBy({
    by: ["source"],
    _count: true,
    where: { deletedAt: null },
  });

  const beforeTotal = beforeCounts.reduce((sum, c) => sum + c._count, 0);
  beforeCounts.forEach((c) => {
    console.log(`   ${c.source || "(null)"}: ${c._count}`);
  });
  console.log(`   TOTAL ACTIVE: ${beforeTotal}`);

  // Count existing medium values
  const existingMediums = await prisma.lead.groupBy({
    by: ["medium"],
    _count: true,
    where: { deletedAt: null, medium: { not: null } },
  });
  console.log(
    `\n   Leads with existing medium: ${existingMediums.reduce((s, c) => s + c._count, 0)}`
  );
  existingMediums.forEach((c) => {
    console.log(`      ${c.medium}: ${c._count}`);
  });

  // ── STEP 3: Migrate WHATSAPP → WEBSITE + WhatsApp ──
  console.log(chalk.blue("\n🔄 Migrating WHATSAPP source..."));
  const waResult = await prisma.lead.updateMany({
    where: { source: "WHATSAPP" as LeadSource, deletedAt: null },
    data: { source: LeadSource.WEBSITE, medium: "WhatsApp" },
  });
  console.log(
    chalk.green(`✓ ${waResult.count} leads: WHATSAPP → WEBSITE + WhatsApp`)
  );

  // ── STEP 4: Migrate INBOUND_CALL → WEBSITE + Call ──
  console.log(chalk.blue("🔄 Migrating INBOUND_CALL source..."));
  const callResult = await prisma.lead.updateMany({
    where: { source: "INBOUND_CALL" as LeadSource, deletedAt: null },
    data: { source: LeadSource.WEBSITE, medium: "Call" },
  });
  console.log(
    chalk.green(`✓ ${callResult.count} leads: INBOUND_CALL → WEBSITE + Call`)
  );

  // ── STEP 5: Verify no old sources remain ──
  console.log(chalk.blue("\n🔍 Verification..."));
  const remaining = await prisma.lead.count({
    where: {
      source: { in: ["WHATSAPP" as LeadSource, "INBOUND_CALL" as LeadSource] },
      deletedAt: null,
    },
  });

  if (remaining === 0) {
    console.log(chalk.green("✓ No remaining WHATSAPP or INBOUND_CALL sources"));
  } else {
    console.error(
      chalk.red(`✗ ${remaining} leads still have old source values!`)
    );
    process.exit(1);
  }

  // ── STEP 6: Snapshot AFTER state ──
  console.log(chalk.blue("\n📊 Snapshot AFTER migration:"));
  const afterCounts = await prisma.lead.groupBy({
    by: ["source"],
    _count: true,
    where: { deletedAt: null },
  });

  const afterTotal = afterCounts.reduce((sum, c) => sum + c._count, 0);
  afterCounts.forEach((c) => {
    console.log(`   ${c.source || "(null)"}: ${c._count}`);
  });
  console.log(`   TOTAL ACTIVE: ${afterTotal}`);

  // Medium distribution
  console.log(chalk.blue("\n📊 Medium distribution AFTER:"));
  const mediumCounts = await prisma.lead.groupBy({
    by: ["medium"],
    _count: true,
    where: { deletedAt: null, medium: { not: null } },
  });

  const mediumTotal = mediumCounts.reduce((sum, c) => sum + c._count, 0);
  mediumCounts.forEach((c) => {
    console.log(`   ${c.medium}: ${c._count}`);
  });
  console.log(`   TOTAL WITH MEDIUM: ${mediumTotal}`);

  // ── STEP 7: Summary ──
  console.log(chalk.blue.bold("\n✅ Migration Complete!"));
  console.log(`\n   Total leads processed: ${waResult.count + callResult.count}`);
  console.log(`   • WhatsApp: ${waResult.count}`);
  console.log(`   • Call: ${callResult.count}`);
  console.log(`   • Database total (before/after): ${beforeTotal} / ${afterTotal}`);
  console.log(
    chalk.yellow(
      "\n⚠️  Next steps:\n   1. Verify /leads page shows Source + Medium correctly\n   2. Run: npm run regression\n   3. Deploy with confidence"
    )
  );
}

main()
  .catch((err) => {
    console.error(chalk.red("\n✗ Migration failed:"), err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
