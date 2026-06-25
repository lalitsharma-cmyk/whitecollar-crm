-- CUSTOMER LAYER (Step 1 foundation) — the canonical-customer grouping over
-- enquiries, plus the immutable link/unlink audit trail.
--
-- Additive ONLY: two NEW tables ("Customer", "CustomerLinkAudit") + one NEW
-- nullable column ("Lead"."customerId") + indexes + FKs. NO existing table or
-- column is altered or dropped; every existing Lead keeps customerId = NULL, so
-- applying this changes ZERO existing rows' meaning.
--
-- Idempotent (IF NOT EXISTS / guarded constraint creation) so it is safe to
-- re-run and safe to apply ahead of the Prisma _prisma_migrations catch-up —
-- matching the convention of the prior additive migrations in this repo.
--
-- NOTE: This migration file is committed for the gated future deploy. It has NOT
-- been applied to production (Step 1 is build-only). Do not run migrate deploy.

-- ── Customer ─────────────────────────────────────────────────────────────────
-- IMMUTABLE identity = uuid id (never a phone/email/name). Everything about the
-- customer's CURRENT state (status / owner / confidence / contact rollup) is
-- COMPUTED LIVE from the linked enquiries — only canonicalOwnerId (an admin
-- override) and healthMeta (reserved, unused) are stored.
CREATE TABLE IF NOT EXISTS "Customer" (
  "id"               TEXT NOT NULL,
  "displayName"      TEXT NOT NULL,
  "canonicalOwnerId" TEXT,
  "healthMeta"       JSONB,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "Customer_canonicalOwnerId_idx" ON "Customer"("canonicalOwnerId");

-- canonicalOwner → User (ON DELETE SET NULL to match `User?`).
DO $$ BEGIN
  ALTER TABLE "Customer" ADD CONSTRAINT "Customer_canonicalOwnerId_fkey"
    FOREIGN KEY ("canonicalOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── Lead.customerId ──────────────────────────────────────────────────────────
-- Nullable FK → Customer. NULL = standalone enquiry (the default for every
-- existing lead). Set/cleared ONLY via the audited link/unlink service.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "customerId" TEXT;
CREATE INDEX IF NOT EXISTS "Lead_customerId_idx" ON "Lead"("customerId");

-- customer → Customer (ON DELETE SET NULL — deleting a customer detaches its
-- enquiries back to standalone; it never deletes an enquiry).
DO $$ BEGIN
  ALTER TABLE "Lead" ADD CONSTRAINT "Lead_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── CustomerLinkAudit ────────────────────────────────────────────────────────
-- IMMUTABLE, append-only. One row per link/unlink decision — never updated or
-- deleted. The replayable, reversible history of every customer grouping.
CREATE TABLE IF NOT EXISTS "CustomerLinkAudit" (
  "id"                 TEXT NOT NULL,
  "customerId"         TEXT,
  "leadId"             TEXT NOT NULL,
  "action"             TEXT NOT NULL,
  "performedById"      TEXT,
  "performedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason"             TEXT,
  "confidenceSnapshot" INTEGER,
  "matchFactors"       JSONB,
  "previousOwnerId"    TEXT,
  "currentOwnerId"     TEXT,
  "prevCustomerId"     TEXT,
  "newCustomerId"      TEXT,
  "rollbackAvailable"  BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "CustomerLinkAudit_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "CustomerLinkAudit_customerId_idx"    ON "CustomerLinkAudit"("customerId");
CREATE INDEX IF NOT EXISTS "CustomerLinkAudit_leadId_idx"        ON "CustomerLinkAudit"("leadId");
CREATE INDEX IF NOT EXISTS "CustomerLinkAudit_performedById_idx" ON "CustomerLinkAudit"("performedById");
CREATE INDEX IF NOT EXISTS "CustomerLinkAudit_performedAt_idx"   ON "CustomerLinkAudit"("performedAt");

-- customer → Customer (ON DELETE SET NULL — keep the audit row if the customer
-- is later deleted; the row is the source of truth for what happened).
DO $$ BEGIN
  ALTER TABLE "CustomerLinkAudit" ADD CONSTRAINT "CustomerLinkAudit_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- performedBy → User (ON DELETE SET NULL to match `User?`).
DO $$ BEGIN
  ALTER TABLE "CustomerLinkAudit" ADD CONSTRAINT "CustomerLinkAudit_performedById_fkey"
    FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
