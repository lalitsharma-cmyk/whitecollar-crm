-- Immutable verbatim audit of the ENTIRE original import row (every column,
-- including mapped ones that are otherwise consumed into derived fields). JSONB,
-- nullable, additive — invisible to the running app until the matching code
-- deploys. Guarantees "imported value remains exactly as written" for every field.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "rawImport" JSONB;
