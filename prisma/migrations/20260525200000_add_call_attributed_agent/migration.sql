-- When a CallLog originates from a MIS-import remark cell, store the actual
-- caller name parsed out of the remark prefix here. user.name is the importer
-- (admin), which is wrong for display.
ALTER TABLE "CallLog" ADD COLUMN "attributedAgentName" TEXT;
