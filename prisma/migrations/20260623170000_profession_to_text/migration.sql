-- Widen Lead.profession from the Profession enum to free-text TEXT.
--
-- WHY: the New-Lead form previously forced one of 7 fixed enum values. Sales
-- needs to type ANY profession ("Pilot", "Doctor", "Chartered Accountant").
-- Widening an enum column to TEXT is loss-less — every existing enum value
-- (e.g. JOB, SELF_EMPLOYED) becomes the identical STRING ("JOB", ...), so no
-- historical data is lost and nothing needs backfilling.
--
-- Reversible: to roll back, the column could be cast back to the enum
-- (`ALTER ... TYPE "Profession" USING "profession"::"Profession"`) as long as
-- only legacy enum tokens were stored. New free-text values would block that,
-- which is acceptable and expected.
--
-- The Profession enum TYPE itself is intentionally LEFT IN PLACE (other code or
-- future rollback may reference it); dropping it is out of scope and risk-free
-- to skip.

ALTER TABLE "Lead" ALTER COLUMN "profession" TYPE TEXT USING "profession"::text;
