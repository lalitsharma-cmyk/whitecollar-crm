-- Add originalSheetStatus to Lead model
-- Stores the raw value from the Excel/CSV "Status" column during import
-- so agents can see what the original sheet said vs the mapped CRM stage.

ALTER TABLE "Lead" ADD COLUMN "originalSheetStatus" TEXT;
