-- SV-2 stale site-visit/meeting watch. Additive, idempotent, non-destructive.
-- Tracks how many "still active" reminders were sent for an open GOING_* field-status
-- event, and whether it was escalated to Requires-Review — so the heartbeat watcher
-- never re-notifies on every tick. Existing rows default to 0 / false (unwatched).
ALTER TABLE "AgentStatusEvent" ADD COLUMN IF NOT EXISTS "staleRemindersSent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentStatusEvent" ADD COLUMN IF NOT EXISTS "staleReviewFlagged" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AgentStatusEvent" ADD COLUMN IF NOT EXISTS "staleLastRemindedAt" TIMESTAMP(3);
