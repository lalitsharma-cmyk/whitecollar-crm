-- Verbatim source value, exactly as imported ("Townscript", "Eventbrite",
-- "Dubai Property Expo This Weekend"). Never mapped/normalized/defaulted.
-- Additive + nullable; invisible to the running app until the matching code
-- deploys. Display/filters/reports will read this as the source of truth.
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "sourceRaw" TEXT;
