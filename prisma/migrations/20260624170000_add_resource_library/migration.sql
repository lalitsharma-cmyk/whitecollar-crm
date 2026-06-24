-- GALLERY / RESOURCE LIBRARY — client-shareable content + share tracking.
-- Additive: two NEW tables + two NEW enums, no existing table/column touched.
-- Idempotent (IF NOT EXISTS / guarded enum creation) so it is safe to re-run
-- and safe to apply ahead of the Prisma migration table catch-up.

-- ── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "ResourceType" AS ENUM ('FILE', 'URL', 'TEXT');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "ResourceShareChannel" AS ENUM ('WHATSAPP', 'EMAIL', 'ATTACH');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Resource ─────────────────────────────────────────────────────────────────
-- One of: FILE (bytes in fileData) | URL (fileUrl) | TEXT (textContent).
-- fileData is bytea — NEVER selected in list queries, only the download route.
CREATE TABLE IF NOT EXISTS "Resource" (
  "id"           TEXT NOT NULL,
  "title"        TEXT NOT NULL,
  "category"     TEXT NOT NULL DEFAULT 'Other',
  "type"         "ResourceType" NOT NULL,
  "fileName"     TEXT,
  "mimeType"     TEXT,
  "fileSize"     INTEGER,
  "fileData"     BYTEA,
  "fileUrl"      TEXT,
  "textContent"  TEXT,
  "projectName"  TEXT,
  "tags"         TEXT,
  "uploadedById" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "deletedAt"    TIMESTAMP(3),
  CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Resource_category_idx"    ON "Resource"("category");
CREATE INDEX IF NOT EXISTS "Resource_type_idx"        ON "Resource"("type");
CREATE INDEX IF NOT EXISTS "Resource_createdAt_idx"   ON "Resource"("createdAt");
CREATE INDEX IF NOT EXISTS "Resource_deletedAt_idx"   ON "Resource"("deletedAt");
CREATE INDEX IF NOT EXISTS "Resource_projectName_idx" ON "Resource"("projectName");

-- uploadedBy → User (ON DELETE SET NULL to match `User?`).
DO $$ BEGIN
  ALTER TABLE "Resource" ADD CONSTRAINT "Resource_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── ResourceShare ────────────────────────────────────────────────────────────
-- One row per share event — which resource → which lead/recipient, via what channel.
CREATE TABLE IF NOT EXISTS "ResourceShare" (
  "id"         TEXT NOT NULL,
  "resourceId" TEXT NOT NULL,
  "leadId"     TEXT,
  "sharedById" TEXT,
  "channel"    "ResourceShareChannel" NOT NULL,
  "recipient"  TEXT,
  "note"       TEXT,
  "sharedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResourceShare_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ResourceShare_resourceId_idx" ON "ResourceShare"("resourceId");
CREATE INDEX IF NOT EXISTS "ResourceShare_leadId_idx"     ON "ResourceShare"("leadId");
CREATE INDEX IF NOT EXISTS "ResourceShare_sharedById_idx" ON "ResourceShare"("sharedById");
CREATE INDEX IF NOT EXISTS "ResourceShare_sharedAt_idx"   ON "ResourceShare"("sharedAt");

-- resource → Resource (ON DELETE CASCADE — shares die with the resource).
DO $$ BEGIN
  ALTER TABLE "ResourceShare" ADD CONSTRAINT "ResourceShare_resourceId_fkey"
    FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- lead → Lead (ON DELETE SET NULL — keep the share row if the lead is purged).
DO $$ BEGIN
  ALTER TABLE "ResourceShare" ADD CONSTRAINT "ResourceShare_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- sharedBy → User (ON DELETE SET NULL to match `User?`).
DO $$ BEGIN
  ALTER TABLE "ResourceShare" ADD CONSTRAINT "ResourceShare_sharedById_fkey"
    FOREIGN KEY ("sharedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
