import { prisma } from "../src/lib/prisma";
const IST = 5.5 * 3600 * 1000;
function istToday() {
  const n = new Date(); const i = new Date(n.getTime() + IST);
  const start = new Date(Date.UTC(i.getUTCFullYear(), i.getUTCMonth(), i.getUTCDate()) - IST);
  return start;
}
async function main() {
  const start = istToday();
  const since = new Date(Date.now() - 36 * 3600 * 1000); // last 36h, to be safe
  console.log("IST today start (UTC):", start.toISOString(), "| 36h window from:", since.toISOString());

  // Import batches recently
  try {
    const batches = await prisma.importBatch.findMany({
      where: { createdAt: { gte: since } }, orderBy: { createdAt: "desc" },
      select: { id: true, createdAt: true, status: true, _count: { select: { leads: true } } },
    });
    console.log(`\nImport batches (last 36h): ${batches.length}`);
    for (const b of batches) console.log(`  ${b.id.slice(0, 10)} ${b.createdAt.toISOString()} status=${b.status} leads=${b._count.leads}`);
  } catch (e) { console.log("importBatch query failed:", String(e).slice(0, 120)); }

  // Leads created in window, grouped by origin/cold/deleted/batch
  const leads = await prisma.lead.findMany({
    where: { createdAt: { gte: since } },
    select: { leadOrigin: true, isColdCall: true, deletedAt: true, importBatchId: true, currentStatus: true, ownerId: true },
  });
  const g = new Map<string, number>();
  for (const l of leads) {
    const k = `origin=${l.leadOrigin} cold=${l.isColdCall ? "Y" : "n"} del=${l.deletedAt ? "Y" : "n"} batch=${l.importBatchId ? "Y" : "n"}`;
    g.set(k, (g.get(k) ?? 0) + 1);
  }
  console.log(`\nLeads created (last 36h): ${leads.length}`);
  for (const [k, v] of [...g.entries()].sort()) console.log(`  ${String(v).padStart(4)}  ${k}`);

  // What the Revival list actually shows (COLD_ORIGINS or isColdCall, not deleted)
  const { COLD_ORIGINS } = await import("../src/lib/leadScope");
  const revivalVisibleToday = await prisma.lead.count({
    where: { createdAt: { gte: since }, deletedAt: null, OR: [{ leadOrigin: { in: [...COLD_ORIGINS] } }, { isColdCall: true }] },
  });
  const revivalTotal = await prisma.lead.count({ where: { deletedAt: null, OR: [{ leadOrigin: { in: [...COLD_ORIGINS] } }, { isColdCall: true }] } });
  console.log(`\nRevival-visible (last 36h): ${revivalVisibleToday} | Revival total (all time): ${revivalTotal}`);
  console.log("COLD_ORIGINS =", COLD_ORIGINS);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
