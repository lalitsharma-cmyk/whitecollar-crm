/**
 * Additive migration — Dashboard Voice Broadcast tables (Feature 1).
 * Creates VoiceBroadcast + VoiceBroadcastRead + the BroadcastTarget enum.
 * Idempotent (IF NOT EXISTS / guarded DO blocks) — safe to re-run. Additive only:
 * NO existing table/column is touched, so no backup needed.
 *
 *   npx tsx scripts/migrate-voice-broadcast.ts
 */
import { prisma } from "../src/lib/prisma";

const STATEMENTS: string[] = [
  `DO $$ BEGIN CREATE TYPE "BroadcastTarget" AS ENUM ('ALL','TEAM','USER'); EXCEPTION WHEN duplicate_object THEN null; END $$;`,
  `CREATE TABLE IF NOT EXISTS "VoiceBroadcast" (
     "id" TEXT PRIMARY KEY,
     "createdById" TEXT NOT NULL,
     "audioData" BYTEA NOT NULL,
     "mimeType" TEXT NOT NULL DEFAULT 'audio/webm',
     "durationSec" INTEGER,
     "transcript" TEXT,
     "title" TEXT,
     "targetKind" "BroadcastTarget" NOT NULL,
     "targetTeam" TEXT,
     "targetUserId" TEXT,
     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
   );`,
  `CREATE INDEX IF NOT EXISTS "VoiceBroadcast_createdAt_idx" ON "VoiceBroadcast"("createdAt");`,
  `CREATE INDEX IF NOT EXISTS "VoiceBroadcast_targetKind_targetTeam_idx" ON "VoiceBroadcast"("targetKind","targetTeam");`,
  `CREATE INDEX IF NOT EXISTS "VoiceBroadcast_targetUserId_idx" ON "VoiceBroadcast"("targetUserId");`,
  `CREATE TABLE IF NOT EXISTS "VoiceBroadcastRead" (
     "id" TEXT PRIMARY KEY,
     "broadcastId" TEXT NOT NULL,
     "userId" TEXT NOT NULL,
     "heardAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
   );`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "VoiceBroadcastRead_broadcastId_userId_key" ON "VoiceBroadcastRead"("broadcastId","userId");`,
  `DO $$ BEGIN ALTER TABLE "VoiceBroadcast" ADD CONSTRAINT "VoiceBroadcast_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;`,
  `DO $$ BEGIN ALTER TABLE "VoiceBroadcast" ADD CONSTRAINT "VoiceBroadcast_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;`,
  `DO $$ BEGIN ALTER TABLE "VoiceBroadcastRead" ADD CONSTRAINT "VoiceBroadcastRead_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "VoiceBroadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;`,
  `DO $$ BEGIN ALTER TABLE "VoiceBroadcastRead" ADD CONSTRAINT "VoiceBroadcastRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN null; END $$;`,
];

async function main() {
  for (const [i, sql] of STATEMENTS.entries()) {
    await prisma.$executeRawUnsafe(sql);
    console.log(`  ✓ stmt ${i + 1}/${STATEMENTS.length}`);
  }
  const b = await prisma.voiceBroadcast.count();
  const r = await prisma.voiceBroadcastRead.count();
  console.log(`✅ VoiceBroadcast ready (rows=${b}) · VoiceBroadcastRead ready (rows=${r})`);
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); }).finally(() => prisma.$disconnect());
