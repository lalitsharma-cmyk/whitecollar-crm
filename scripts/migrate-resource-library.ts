// ────────────────────────────────────────────────────────────────────────────
// scripts/migrate-resource-library.ts   (npx tsx scripts/migrate-resource-library.ts)
//
// Applies the Gallery / Resource Library migration to the live DB. Additive +
// idempotent: two NEW tables (Resource, ResourceShare) and two NEW enums, no
// existing table/column touched. Safe to re-run.
//
// Runs the SAME statements as prisma/migrations/20260624170000_add_resource_library,
// then verifies the tables + key columns + FK exist.
// ────────────────────────────────────────────────────────────────────────────
import { prisma } from "../src/lib/prisma";

const STATEMENTS: string[] = [
  `DO $$ BEGIN CREATE TYPE "ResourceType" AS ENUM ('FILE', 'URL', 'TEXT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN CREATE TYPE "ResourceShareChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'ATTACH'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `CREATE TABLE IF NOT EXISTS "Resource" (
     "id" TEXT NOT NULL,
     "title" TEXT NOT NULL,
     "category" TEXT NOT NULL DEFAULT 'Other',
     "type" "ResourceType" NOT NULL,
     "fileName" TEXT,
     "mimeType" TEXT,
     "fileSize" INTEGER,
     "fileData" BYTEA,
     "fileUrl" TEXT,
     "textContent" TEXT,
     "projectName" TEXT,
     "tags" TEXT,
     "uploadedById" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt" TIMESTAMP(3) NOT NULL,
     "deletedAt" TIMESTAMP(3),
     CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "Resource_category_idx"    ON "Resource"("category")`,
  `CREATE INDEX IF NOT EXISTS "Resource_type_idx"        ON "Resource"("type")`,
  `CREATE INDEX IF NOT EXISTS "Resource_createdAt_idx"   ON "Resource"("createdAt")`,
  `CREATE INDEX IF NOT EXISTS "Resource_deletedAt_idx"   ON "Resource"("deletedAt")`,
  `CREATE INDEX IF NOT EXISTS "Resource_projectName_idx" ON "Resource"("projectName")`,
  `DO $$ BEGIN
     ALTER TABLE "Resource" ADD CONSTRAINT "Resource_uploadedById_fkey"
       FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `CREATE TABLE IF NOT EXISTS "ResourceShare" (
     "id" TEXT NOT NULL,
     "resourceId" TEXT NOT NULL,
     "leadId" TEXT,
     "sharedById" TEXT,
     "channel" "ResourceShareChannel" NOT NULL,
     "recipient" TEXT,
     "note" TEXT,
     "sharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     CONSTRAINT "ResourceShare_pkey" PRIMARY KEY ("id")
   )`,
  `CREATE INDEX IF NOT EXISTS "ResourceShare_resourceId_idx" ON "ResourceShare"("resourceId")`,
  `CREATE INDEX IF NOT EXISTS "ResourceShare_leadId_idx"     ON "ResourceShare"("leadId")`,
  `CREATE INDEX IF NOT EXISTS "ResourceShare_sharedById_idx" ON "ResourceShare"("sharedById")`,
  `CREATE INDEX IF NOT EXISTS "ResourceShare_sharedAt_idx"   ON "ResourceShare"("sharedAt")`,
  `DO $$ BEGIN
     ALTER TABLE "ResourceShare" ADD CONSTRAINT "ResourceShare_resourceId_fkey"
       FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN
     ALTER TABLE "ResourceShare" ADD CONSTRAINT "ResourceShare_leadId_fkey"
       FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
  `DO $$ BEGIN
     ALTER TABLE "ResourceShare" ADD CONSTRAINT "ResourceShare_sharedById_fkey"
       FOREIGN KEY ("sharedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;`,
];

async function main(): Promise<void> {
  console.log("→ Applying Resource Library migration (additive, idempotent)…");
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql);
  }
  console.log(`✓ ${STATEMENTS.length} statements applied`);

  // ── Verify ──
  const tables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('Resource', 'ResourceShare')
    ORDER BY table_name`;
  console.log("✓ tables present:", tables.map((t) => t.table_name).join(", "));
  if (tables.length !== 2) { console.error("✗ expected both tables to exist"); process.exit(2); }

  const cols = await prisma.$queryRaw<{ column_name: string; data_type: string }[]>`
    SELECT column_name, data_type FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'Resource'
      AND column_name IN ('fileData', 'type', 'fileUrl', 'textContent', 'deletedAt')
    ORDER BY column_name`;
  console.log("✓ Resource key columns:", JSON.stringify(cols));
  const fileData = cols.find((c) => c.column_name === "fileData");
  if (!fileData || fileData.data_type !== "bytea") { console.error("✗ Resource.fileData must be bytea"); process.exit(3); }

  const fk = await prisma.$queryRaw<{ constraint_name: string }[]>`
    SELECT constraint_name FROM information_schema.table_constraints
    WHERE table_schema = 'public' AND table_name = 'ResourceShare'
      AND constraint_type = 'FOREIGN KEY' AND constraint_name = 'ResourceShare_leadId_fkey'`;
  if (fk.length !== 1) { console.error("✗ ResourceShare.leadId FK (share-tracking) missing"); process.exit(4); }
  console.log("✓ ResourceShare → Lead FK present (share tracking wired)");

  // Smoke: counts work (proves Prisma client sees the tables once generated).
  const [r, s] = await Promise.all([
    prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "Resource"`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*)::bigint AS n FROM "ResourceShare"`,
  ]);
  console.log(`✓ row counts — Resource=${r[0].n}, ResourceShare=${s[0].n}`);
  console.log("✅ Resource Library migration complete.");
}

main().catch((e) => { console.error("✗ migration failed:", e); process.exit(1); }).finally(() => prisma.$disconnect());
