// Seeds the 7 starter saved-filter chips. Idempotent — re-runnable.
// Run: npx tsx scripts/seed-saved-filters.ts
import { PrismaClient } from "@prisma/client";
import { SEED_FILTERS } from "../src/lib/savedFilters";

async function main() {
  const prisma = new PrismaClient();
  const existing = new Set(
    (await prisma.savedFilter.findMany({ where: { createdById: null }, select: { name: true } })).map(f => f.name)
  );
  let created = 0, skipped = 0;
  for (const f of SEED_FILTERS) {
    if (existing.has(f.name)) { skipped++; continue; }
    await prisma.savedFilter.create({
      data: {
        name: f.name,
        icon: f.icon,
        queryString: f.queryString,
        sortOrder: f.sortOrder,
        isShared: true,
        createdById: null,
      },
    });
    created++;
  }
  console.log(`Saved filters: ${created} created, ${skipped} already existed.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
