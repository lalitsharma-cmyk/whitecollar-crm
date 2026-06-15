-- Currency Preservation: store the verbatim imported budget text.
-- Additive + nullable → existing rows get NULL, zero rewrite, fully reversible.
-- budgetCurrency stays a free String; "UNKNOWN" is a valid value (no enum change).
ALTER TABLE "Lead" ADD COLUMN "budgetRaw" TEXT;
