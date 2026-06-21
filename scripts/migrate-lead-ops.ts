// ────────────────────────────────────────────────────────────────────────────
// scripts/migrate-lead-ops.ts   (npx tsx scripts/migrate-lead-ops.ts)
//
// 1) Additive: ensure User.leadOpsOnly column exists (idempotent, default false —
//    no existing row/data touched).
// 2) Flag Sameer (the active gmail account) as leadOpsOnly = true so his dashboard
//    becomes the lead-management view. Reversible: set false to restore.
// Only Sameer is changed; Lalit / agents / managers / HR are untouched.
// ────────────────────────────────────────────────────────────────────────────
import { prisma } from "../src/lib/prisma";

const SAMEER_EMAIL = "sameer.wcr1@gmail.com";

async function main(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "leadOpsOnly" BOOLEAN NOT NULL DEFAULT false`,
  );
  console.log("✓ User.leadOpsOnly column ensured (additive, default false)");

  let u = await prisma.user.findUnique({ where: { email: SAMEER_EMAIL }, select: { id: true, name: true, email: true, role: true, active: true } });
  if (!u) {
    // Fallback: surface every Sameer-like account so we flag the right one.
    const cands = await prisma.user.findMany({
      where: { OR: [{ email: { contains: "sameer", mode: "insensitive" } }, { name: { contains: "Sam", mode: "insensitive" } }] },
      select: { id: true, name: true, email: true, role: true, active: true },
    });
    console.error(`✗ ${SAMEER_EMAIL} not found. Candidates:`, JSON.stringify(cands));
    process.exit(2);
  }
  console.log("Sameer:", JSON.stringify(u));
  if (!u.active) { console.error("✗ ABORT: that Sameer account is INACTIVE — not flagging it."); process.exit(3); }

  await prisma.user.update({ where: { id: u.id }, data: { leadOpsOnly: true } });
  const flagged = await prisma.user.findMany({ where: { leadOpsOnly: true }, select: { name: true, email: true, role: true } });
  console.log(`✓ leadOpsOnly=true →`, JSON.stringify(flagged));
  console.log(flagged.length === 1 ? "✓ exactly one user flagged (Sameer only)." : "⚠ more than one user flagged — review above.");
}

main().catch((e) => { console.error("✗ failed:", e); process.exit(1); }).finally(() => prisma.$disconnect());
