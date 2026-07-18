-- Call state machine (Lalit P0, 2026-07-18): a dial click creates a CallLog
-- IMMEDIATELY at INITIATED, then the SAME row transitions to a terminal state.
-- Additive only: new enum values + nullable columns. Existing rows untouched.
--
-- PENDING (not yet an attempt): INITIATED, RINGING
-- TERMINAL: CONNECTED/COMPLETED, NOT_PICKED(No Answer), BUSY, FAILED, CANCELLED,
--           MISSED, + the existing business outcomes.
-- Only TERMINAL states may feed the ghosting / revival-attempt engines, so a dial
-- that never connects can never trigger a false 👻 tag or a false auto-return.
ALTER TYPE "CallOutcome" ADD VALUE IF NOT EXISTS 'INITIATED';
ALTER TYPE "CallOutcome" ADD VALUE IF NOT EXISTS 'RINGING';
ALTER TYPE "CallOutcome" ADD VALUE IF NOT EXISTS 'FAILED';
ALTER TYPE "CallOutcome" ADD VALUE IF NOT EXISTS 'CANCELLED';
ALTER TYPE "CallOutcome" ADD VALUE IF NOT EXISTS 'MISSED';
