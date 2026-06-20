-- Per-user notification sound + volume (additive, nullable). Safe re-run.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notifSound" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notifVolume" TEXT;
