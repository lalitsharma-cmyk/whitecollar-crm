-- 1-hour-before meeting/site-visit reminder dedupe flag (additive)
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "reminderSentAt1h" TIMESTAMP(3);
