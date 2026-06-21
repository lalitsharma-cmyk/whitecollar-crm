// scripts/migrate-note-voiceoriginal.ts  (npx tsx scripts/migrate-note-voiceoriginal.ts)
// Additive: store the raw speech-to-text transcript of voice notes for audit.
// Idempotent, zero rows changed. Run against prod before deploying the code.
import { prisma } from "../src/lib/prisma";

async function main() {
  await prisma.$executeRawUnsafe(`ALTER TABLE "Note" ADD COLUMN IF NOT EXISTS "voiceOriginal" TEXT`);
  const rows = await prisma.$queryRawUnsafe<{ column_name: string }[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'Note' AND column_name = 'voiceOriginal'`
  );
  console.log(rows.length ? "✓ Note.voiceOriginal present." : "✗ column missing after ALTER");
  if (!rows.length) throw new Error("voiceOriginal missing");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
