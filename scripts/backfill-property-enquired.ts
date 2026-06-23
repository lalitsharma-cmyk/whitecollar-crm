/**
 * scripts/backfill-property-enquired.ts
 *
 * ITEM 3 backfill (Lalit 2026-06-24): map historical imported project/property
 * columns into "Property Enquired" (Lead.sourceDetail).
 *
 * Scans every NON-deleted lead with a BLANK sourceDetail, reads its rawImport /
 * customFields JSON for any of the known project/property header variants
 * (case- and punctuation-insensitive), and sets sourceDetail to that raw text.
 *
 * SAFE + IDEMPOTENT:
 *   • Only touches leads where sourceDetail is null/empty — NEVER overwrites a
 *     manually-set or already-mapped value.
 *   • Excludes deletedAt != null (recycle-bin records).
 *   • Stores the RAW text verbatim — no Project-Master match required.
 *   • Re-running is a no-op once values are filled.
 *   • Writes a LeadFieldHistory audit row per change (source = property-enquired-backfill).
 *
 * Usage:
 *   npx tsx scripts/backfill-property-enquired.ts --dry-run   # report only
 *   npx tsx scripts/backfill-property-enquired.ts             # apply
 */

import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const dryRun = process.argv.includes("--dry-run");

// Normalize a header to compare against the wanted keys (strip spaces/punct/emoji).
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Header variants that mean "the project/property the client enquired about".
// Mirrors PROJECT_PICK in the CSV + Google-Sheet importers.
const WANTED = [
  "Project", "Project Name", "Property", "Property Name", "Enquired Property",
  "Interested Project", "Requirement Project", "Tower/Project", "Tower",
].map(norm);

// Values that are NOT a real property name even if they sit in a project column —
// skip these so we don't write junk into Property Enquired.
const JUNK = new Set(["", "na", "n/a", "none", "null", "-", "nil", "tbd", "notapplicable"]);

function extractProject(blob: Record<string, unknown>): string | null {
  for (const [k, v] of Object.entries(blob)) {
    if (v == null) continue;
    const val = String(v).trim();
    if (!val) continue;
    if (JUNK.has(norm(val))) continue;
    if (WANTED.includes(norm(k))) return val;
  }
  return null;
}

async function main() {
  console.log(`🏗  Property Enquired backfill${dryRun ? " [DRY RUN]" : ""}`);
  console.log("═".repeat(60));

  const actor = await prisma.user.findFirst({
    where: { email: { equals: "LALITSHARMA@whitecollarrealty.com", mode: "insensitive" } },
    select: { id: true },
  });

  // Only non-deleted leads with a blank sourceDetail.
  const leads = await prisma.lead.findMany({
    where: { deletedAt: null, OR: [{ sourceDetail: null }, { sourceDetail: "" }] },
    select: { id: true, name: true, rawImport: true, customFields: true },
  });
  console.log(`Scanning ${leads.length} non-deleted leads with blank Property Enquired…\n`);

  let updated = 0;
  const log: Array<{ leadId: string; name: string; value: string; sourceKey: string }> = [];

  for (const lead of leads) {
    // rawImport first (the verbatim original row), then customFields (preserved extras).
    const ri = (lead.rawImport as Record<string, unknown> | null) ?? {};
    const cf = (lead.customFields as Record<string, unknown> | null) ?? {};
    // Find which key matched, for the audit log.
    const blob = { ...cf, ...ri }; // rawImport wins on key collision
    const value = extractProject(blob);
    if (!value) continue;
    // Which header produced it?
    const sourceKey = Object.keys(blob).find((k) => WANTED.includes(norm(k)) && String(blob[k]).trim() && !JUNK.has(norm(String(blob[k])))) ?? "?";

    updated++;
    log.push({ leadId: lead.id, name: lead.name ?? "(unknown)", value, sourceKey });

    if (!dryRun) {
      await prisma.lead.update({ where: { id: lead.id }, data: { sourceDetail: value } });
      if (actor) {
        await prisma.leadFieldHistory.create({
          data: {
            leadId: lead.id,
            field: "sourceDetail",
            oldValue: null,
            newValue: value,
            changedById: actor.id,
            source: "property-enquired-backfill",
          },
        }).catch(() => {});
      }
    }
  }

  console.log("═".repeat(60));
  console.log(`Leads ${dryRun ? "that WOULD be" : ""} updated: ${updated}`);
  if (log.length) {
    console.log("\nSample (first 15):");
    for (const l of log.slice(0, 15)) console.log(`  ${l.name}: "${l.value}"  (from "${l.sourceKey}")`);
  }
  if (log.length) {
    const path = `./backups/property-enquired-backfill-${Date.now()}.json`;
    try {
      writeFileSync(path, JSON.stringify({ timestamp: new Date().toISOString(), dryRun, updated, changes: log }, null, 2));
      console.log(`\n📝 Log: ${path}`);
    } catch { /* backups dir may not exist in some envs — non-fatal */ }
  }
  console.log(dryRun ? "\n🔍 DRY RUN — no changes made" : "\n✅ Backfill applied + audited");

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
