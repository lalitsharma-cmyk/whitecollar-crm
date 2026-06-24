-- BUYER IMPORT → RAW HISTORY + SMART TIMELINE + DEDUP (parity with Lead imports).
-- One additive, idempotent column: BuyerRecord.rawImport — the IMMUTABLE verbatim
-- copy of the ENTIRE original import row (every column, incl. the mapped ones),
-- mirroring Lead.rawImport. Surfaced in the buyer detail "Imported Fields →
-- Original Imported Row" so every imported value is recoverable exactly as written.
--
-- The verbatim imported-remarks text continues to live on the existing
-- BuyerRecord.remarks column (= Raw History source + working notes), so NO new
-- remarks column is needed — the import route now populates it + derives the
-- BuyerActivity Smart Timeline from it.
--
-- Re-runnable (IF NOT EXISTS) so a hand-apply and a later `prisma migrate deploy`
-- both converge without error. Nullable, no default, no existing data mutated.

ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "rawImport" JSONB;
