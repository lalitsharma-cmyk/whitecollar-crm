// scripts/migrate-lead-indexes.ts   (npx tsx scripts/migrate-lead-indexes.ts)
// Additive performance indexes for the Leads page (follow-up chip counts, status
// groupBy, ghosting/overdue filters, owner/team scopes). CREATE INDEX CONCURRENTLY
// = NO table lock, safe on live prod; IF NOT EXISTS = idempotent. Zero rows changed.
// Names match Prisma's convention so a future `prisma migrate` sees them as present.
import { prisma } from "../src/lib/prisma";

const INDEXES: { name: string; cols: string }[] = [
  { name: "Lead_followupDate_idx",           cols: `"followupDate"` },
  { name: "Lead_currentStatus_idx",          cols: `"currentStatus"` },
  { name: "Lead_lastTouchedAt_idx",          cols: `"lastTouchedAt"` },
  { name: "Lead_leadOrigin_idx",             cols: `"leadOrigin"` },
  { name: "Lead_ownerId_deletedAt_idx",      cols: `"ownerId", "deletedAt"` },
  { name: "Lead_forwardedTeam_deletedAt_idx", cols: `"forwardedTeam", "deletedAt"` },
];

async function main() {
  for (const ix of INDEXES) {
    process.stdout.write(`• ${ix.name} … `);
    // CONCURRENTLY cannot run inside a transaction; $executeRawUnsafe autocommits.
    await prisma.$executeRawUnsafe(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "${ix.name}" ON "Lead" (${ix.cols})`);
    console.log("ok");
  }
  const rows = await prisma.$queryRawUnsafe<{ indexname: string }[]>(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'Lead' ORDER BY indexname`
  );
  console.log("\nLead indexes now:", rows.map((r) => r.indexname).join(", "));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
