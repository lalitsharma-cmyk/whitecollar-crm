-- Global-search performance: pg_trgm GIN indexes so partial (ILIKE '%q%') matches
-- on name / phone / email / company stay fast at 100k+ rows. Idempotent — safe to
-- re-run. Applied to prod 2026-07-04; apply the same to any sandbox/new DB.
--   psql "$DATABASE_URL" -f scripts/search-trgm-indexes.sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS lead_name_trgm      ON "Lead"        USING gin (name        gin_trgm_ops);
CREATE INDEX IF NOT EXISTS lead_phone_trgm     ON "Lead"        USING gin (phone       gin_trgm_ops);
CREATE INDEX IF NOT EXISTS lead_altphone_trgm  ON "Lead"        USING gin ("altPhone"  gin_trgm_ops);
CREATE INDEX IF NOT EXISTS lead_email_trgm     ON "Lead"        USING gin (email       gin_trgm_ops);
CREATE INDEX IF NOT EXISTS lead_company_trgm   ON "Lead"        USING gin (company     gin_trgm_ops);
CREATE INDEX IF NOT EXISTS buyer_name_trgm     ON "BuyerRecord" USING gin ("clientName" gin_trgm_ops);
CREATE INDEX IF NOT EXISTS buyer_phones_trgm   ON "BuyerRecord" USING gin (phones      gin_trgm_ops);
CREATE INDEX IF NOT EXISTS buyer_emails_trgm   ON "BuyerRecord" USING gin (emails      gin_trgm_ops);
