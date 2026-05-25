import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const total = await p.lead.count();
  const withRemarks = await p.lead.count({ where: { remarks: { not: null } } });
  const empty = await p.lead.count({ where: { remarks: null } });
  console.log(`Total leads: ${total}`);
  console.log(`  • with remarks: ${withRemarks}`);
  console.log(`  • null remarks: ${empty}`);
  // Sample 5 from each
  console.log("\n📋 Sample with remarks:");
  const sample = await p.lead.findMany({
    where: { remarks: { not: null } },
    select: { name: true, remarks: true, createdAt: true },
    orderBy: { createdAt: "desc" },
    take: 5,
  });
  for (const l of sample) {
    console.log(`  ${l.name.padEnd(25)} → ${l.remarks?.slice(0, 80).replace(/\n/g, ' / ')}…`);
  }
  console.log("\n❌ Sample WITHOUT remarks:");
  const empties = await p.lead.findMany({
    where: { remarks: null },
    select: { name: true, source: true, createdAt: true, ownerId: true },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  for (const l of empties) {
    console.log(`  ${l.name.padEnd(25)} src=${l.source} created=${l.createdAt.toISOString().slice(0,10)}`);
  }
  await p.$disconnect();
})();
