-- Import-fidelity columns (Lalit 2026-07-15). BOTH additive + nullable — no
-- backfill in the migration, no rewrite of a single existing row. Idempotent
-- (ADD COLUMN IF NOT EXISTS) so re-running against prod is safe.

-- ITEM #2 — Canonical phone. DIGITS-ONLY country_code+national_number (no "+"),
-- e.g. "9999999999" / "+919999999999" / "919999999999" all → "919999999999".
-- Written by phoneCanonicalDigits() on every phone write; dedup keys off its
-- trailing tail (fixes the phone-only-re-import miss). Backfilled by
-- scripts/backfill-phone-canonical.ts. Not indexed (dedup uses a suffix match).
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "phoneCanonical" TEXT;

-- ITEM #3 — Was the createdAt TIME portion actually known? false = imported row
-- whose sheet had no Time column → "Created Time" displays BLANK; true = real
-- time (Time column parsed, or live intake); NULL = legacy/real-time (display
-- unchanged). Backfilled by scripts/backfill-created-datetime.ts.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "createdTimeKnown" BOOLEAN;
