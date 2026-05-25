-- Second phone number from multi-number MIS cells.
-- Lalit's MIS frequently stored "+919146449146, 7779990838" in one cell — the
-- importer (src/lib/phone.ts:splitPhones) now splits on `,`/`;`/`/`/newline and
-- routes the second number here.

ALTER TABLE "Lead" ADD COLUMN "altPhone" TEXT;
