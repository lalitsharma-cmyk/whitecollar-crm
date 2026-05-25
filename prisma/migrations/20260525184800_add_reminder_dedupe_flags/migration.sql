-- Dedupe flags for the every-5-min pre-meeting-reminder cron.
--
-- Lead.followupReminderSentAt — set when the 10-min-before-callback push has
--   fired for this lead's current Lead.followupDate. Cleared when followupDate
--   changes (see src/app/api/leads/[id]/update/route.ts).
--
-- Activity.reminderSentAt — set when the 30-min-before-meeting push has fired
--   for this activity's scheduledAt. Cleared on reschedule (see
--   src/app/api/leads/[id]/meeting/route.ts).
--
-- Originally `db push`'d directly to prod; this migration brings prisma migrate
-- history in sync so preview/branch deploys don't crash with column-not-found.

ALTER TABLE "Lead" ADD COLUMN "followupReminderSentAt" TIMESTAMP(3);
ALTER TABLE "Activity" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
