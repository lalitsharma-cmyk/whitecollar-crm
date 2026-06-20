-- "I am here" agent self-check-in fields (additive, nullable). Safe re-run.
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "selfCheckedInAt" TIMESTAMP(3);
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "checkInIp" TEXT;
ALTER TABLE "Attendance" ADD COLUMN IF NOT EXISTS "checkInDevice" TEXT;
