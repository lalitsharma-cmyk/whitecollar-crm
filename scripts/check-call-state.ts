// Quick one-off: inspect current CallLog state so we know what data we have
// before extending the backfill script to catch un-attributed imported rows.
import { prisma } from "../src/lib/prisma";

async function main() {
  const total = await prisma.callLog.count();
  const withAttribution = await prisma.callLog.count({ where: { attributedAgentName: { not: null } } });
  const withNotes = await prisma.callLog.count({ where: { notes: { not: null } } });
  // Calls whose notes look like an imported entry ("AgentName: ..." prefix)
  const importLooking = await prisma.callLog.count({
    where: {
      attributedAgentName: null,
      notes: { contains: ": " },
    },
  });
  console.log("Total CallLogs:", total);
  console.log("With attributedAgentName:", withAttribution);
  console.log("With notes:", withNotes);
  console.log("Looks-imported (null attribName + 'X: ' note):", importLooking);

  const sample = await prisma.callLog.findMany({
    take: 6,
    orderBy: { startedAt: "desc" },
    include: { user: true },
  });
  console.log("\nSample 6 most recent:");
  for (const c of sample) {
    console.log(`  ${c.startedAt.toISOString()}  user=${c.user?.name ?? "Unknown Agent"}  attribName=${c.attributedAgentName ?? "-"}  outcome=${c.outcome}  notes=${(c.notes ?? "").slice(0, 60)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
