-- Follow-up-workflow action context (additive, reversible).
--   Activity gains an optional `actionContext` token, stamped on COMPLETE /
--   SNOOZE / ESCALATE / FOLLOWUP-DATE-CHANGE rows so the EOD Daily Report can
--   bucket them (completed-after-call vs whatsapp, snoozed-without-contact, …)
--   without re-deriving. Null on every other activity. No existing data touched.
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "actionContext" TEXT;
