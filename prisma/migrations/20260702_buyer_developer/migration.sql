-- Add first-class Developer column to BuyerRecord (additive, nullable).
ALTER TABLE "BuyerRecord" ADD COLUMN IF NOT EXISTS "developer" TEXT;
