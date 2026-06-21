// scripts/migrate-lunch-kind.ts   (npx tsx scripts/migrate-lunch-kind.ts)
// Additive: add the LUNCH_REMINDER value to the Postgres NotifKind enum so the
// lunch-reminder cron can insert notifications of that kind. Idempotent + safe
// (ADD VALUE IF NOT EXISTS); changes no rows. Run BEFORE deploying the code.
import { prisma } from "../src/lib/prisma";

async function main() {
  // ALTER TYPE ... ADD VALUE cannot run inside a transaction; $executeRawUnsafe
  // autocommits, so this is fine on Neon PG17.
  await prisma.$executeRawUnsafe(`ALTER TYPE "NotifKind" ADD VALUE IF NOT EXISTS 'LUNCH_REMINDER'`);
  const rows = await prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
    `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'NotifKind' ORDER BY e.enumsortorder`
  );
  console.log("✓ NotifKind values:", rows.map((r) => r.enumlabel).join(", "));
  if (!rows.some((r) => r.enumlabel === "LUNCH_REMINDER")) throw new Error("LUNCH_REMINDER missing after ALTER");
  console.log("✓ LUNCH_REMINDER present.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
