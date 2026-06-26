-- Rejected-Lead workflow (Lalit 2026-06-27): denormalized previous-owner id.
-- On reject the lead is unassigned (ownerId → null) and the prior owner is kept
-- here for the "Previous Owner" display + audit. Additive + nullable = safe,
-- non-locking on Postgres. Idempotent so a re-apply is a no-op.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "previousOwnerId" TEXT;
