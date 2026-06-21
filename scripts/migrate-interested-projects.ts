// ────────────────────────────────────────────────────────────────────────────
// scripts/migrate-interested-projects.ts
//
//   npx tsx scripts/migrate-interested-projects.ts
//
// Creates the LeadInterestedProject table (the independent "Interested
// Properties" store). PURELY ADDITIVE + IDEMPOTENT — a new empty table with
// CREATE TABLE/INDEX IF NOT EXISTS and FK-add guarded by pg_constraint. Touches
// NO existing table, column, or row, so it is safe to run against production
// Neon any number of times. Mirrors Prisma's constraint/index names so a future
// `prisma db push` sees zero drift.
// ────────────────────────────────────────────────────────────────────────────
import { prisma } from "../src/lib/prisma";

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS "LeadInterestedProject" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "notes" TEXT,
    "autoDetected" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" TEXT,
    "sourceDate" TIMESTAMP(3),
    "sourceText" TEXT,
    "suggestion" BOOLEAN NOT NULL DEFAULT false,
    "interestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LeadInterestedProject_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "LeadInterestedProject_leadId_projectId_key" ON "LeadInterestedProject"("leadId", "projectId")`,
  `CREATE INDEX IF NOT EXISTS "LeadInterestedProject_leadId_idx" ON "LeadInterestedProject"("leadId")`,
  `CREATE INDEX IF NOT EXISTS "LeadInterestedProject_projectId_idx" ON "LeadInterestedProject"("projectId")`,
];

// ADD CONSTRAINT has no IF NOT EXISTS — guard each FK on pg_constraint so re-runs
// are no-ops.
const FK_STATEMENTS: Array<{ name: string; sql: string }> = [
  {
    name: "LeadInterestedProject_leadId_fkey",
    sql: `ALTER TABLE "LeadInterestedProject" ADD CONSTRAINT "LeadInterestedProject_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  },
  {
    name: "LeadInterestedProject_projectId_fkey",
    sql: `ALTER TABLE "LeadInterestedProject" ADD CONSTRAINT "LeadInterestedProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE`,
  },
];

async function main(): Promise<void> {
  console.log("→ Applying LeadInterestedProject migration (additive, idempotent)…");
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql);
  }
  for (const fk of FK_STATEMENTS) {
    const exists = await prisma.$queryRawUnsafe<Array<{ conname: string }>>(
      `SELECT conname FROM pg_constraint WHERE conname = $1`,
      fk.name,
    );
    if (exists.length === 0) {
      await prisma.$executeRawUnsafe(fk.sql);
      console.log(`  + added FK ${fk.name}`);
    } else {
      console.log(`  = FK ${fk.name} already present`);
    }
  }
  // Verify: the generated client can query the new table + the Lead relation.
  const count = await prisma.leadInterestedProject.count();
  const sample = await prisma.lead.findFirst({
    select: { id: true, _count: { select: { interestedProjects: true } } },
  });
  console.log(`✓ LeadInterestedProject ready — rows = ${count}; relation OK (sample lead ${sample?.id ?? "n/a"}).`);
}

main()
  .catch((e) => { console.error("✗ migration failed:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
