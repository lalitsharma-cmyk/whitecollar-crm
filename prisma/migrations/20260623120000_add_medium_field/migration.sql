-- Add medium field to Lead model
ALTER TABLE "Lead" ADD COLUMN "medium" VARCHAR(255);
ALTER TABLE "Lead" ADD COLUMN "mediumOther" VARCHAR(255);

-- Migrate data: WHATSAPP source → WEBSITE + WhatsApp medium
UPDATE "Lead" 
SET "medium" = 'WhatsApp', "source" = 'WEBSITE' 
WHERE "source" = 'WHATSAPP' AND "deletedAt" IS NULL;

-- Migrate data: INBOUND_CALL source → WEBSITE + Call medium
UPDATE "Lead" 
SET "medium" = 'Call', "source" = 'WEBSITE' 
WHERE "source" = 'INBOUND_CALL' AND "deletedAt" IS NULL;

-- Note: EMAIL was never used as a source value (grep confirms),
-- so no data migration needed for it.
