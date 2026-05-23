// Wipes ALL demo data from production. Keeps only the Lalit admin user
// and the intake API keys (so login + webhooks continue to work).
//
// Usage:
//   DATABASE_URL="postgresql://..." npx tsx scripts/clean-prod.ts

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const before = {
    users: await prisma.user.count(),
    leads: await prisma.lead.count(),
    projects: await prisma.project.count(),
    units: await prisma.unit.count(),
    calls: await prisma.callLog.count(),
    activities: await prisma.activity.count(),
    intakeKeys: await prisma.intakeKey.count(),
  };
  console.log("📊 BEFORE:", before);

  // Delete in dependency order (children first)
  const r1 = await prisma.activity.deleteMany({});
  const r2 = await prisma.callLog.deleteMany({});
  const r3 = await prisma.note.deleteMany({});
  const r4 = await prisma.assignment.deleteMany({});
  const r5 = await prisma.leadProperty.deleteMany({});
  const r6 = await prisma.whatsAppMessage.deleteMany({});
  const r7 = await prisma.lead.deleteMany({});
  const r8 = await prisma.unit.deleteMany({});
  const r9 = await prisma.project.deleteMany({});

  // Keep only Lalit (admin). Delete everyone else.
  const r10 = await prisma.user.deleteMany({
    where: { email: { not: "lalit@whitecollarrealty.com" } },
  });

  console.log("\n🗑 Deletions:");
  console.log(`  activities:        ${r1.count}`);
  console.log(`  callLogs:          ${r2.count}`);
  console.log(`  notes:             ${r3.count}`);
  console.log(`  assignments:       ${r4.count}`);
  console.log(`  leadProperties:    ${r5.count}`);
  console.log(`  whatsappMessages:  ${r6.count}`);
  console.log(`  leads:             ${r7.count}`);
  console.log(`  units:             ${r8.count}`);
  console.log(`  projects:          ${r9.count}`);
  console.log(`  users (kept Lalit):${r10.count}`);

  const after = {
    users: await prisma.user.count(),
    leads: await prisma.lead.count(),
    projects: await prisma.project.count(),
    units: await prisma.unit.count(),
    calls: await prisma.callLog.count(),
    activities: await prisma.activity.count(),
    intakeKeys: await prisma.intakeKey.count(),
  };
  console.log("\n📊 AFTER:", after);

  if (after.users !== 1) throw new Error("Expected exactly 1 user (Lalit) to remain");
  if (after.intakeKeys === 0) console.warn("⚠ No intake keys — recreate via /intake page");
  console.log("\n✅ Production DB is clean. Lalit account intact, intake keys intact.");
}

main().catch((e) => { console.error("❌", e); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
