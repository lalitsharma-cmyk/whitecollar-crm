// READ-ONLY. Identify the mistaken cold-data import batch(es) under Tanuj so the
// exact target can be shown BEFORE any hard delete. Deletes nothing.
import { prisma } from "../src/lib/prisma";

async function main() {
  const tanuj = await prisma.user.findFirst({
    where: { name: { contains: "Tanuj", mode: "insensitive" } },
    select: { id: true, name: true },
  });
  console.log(`Tanuj = ${tanuj ? `${tanuj.name} (${tanuj.id})` : "NOT FOUND"}`);
  if (!tanuj) return;

  // All batches that EITHER were imported as COLD, OR have at least one lead owned by Tanuj.
  const coldBatchIds = (await prisma.lead.findMany({
    where: { ownerId: tanuj.id, importBatchId: { not: null } },
    select: { importBatchId: true },
    distinct: ["importBatchId"],
  })).map((l) => l.importBatchId!).filter(Boolean);

  const batches = await prisma.importBatch.findMany({
    where: { OR: [{ id: { in: coldBatchIds } }, { importType: "COLD" }] },
    include: { importedBy: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
  });

  console.log(`\nFound ${batches.length} candidate batch(es):\n`);
  for (const b of batches) {
    const total      = await prisma.lead.count({ where: { importBatchId: b.id } });
    const live       = await prisma.lead.count({ where: { importBatchId: b.id, deletedAt: null } });
    const softDel    = await prisma.lead.count({ where: { importBatchId: b.id, deletedAt: { not: null } } });
    const ownedTanuj = await prisma.lead.count({ where: { importBatchId: b.id, ownerId: tanuj.id } });
    const cold       = await prisma.lead.count({ where: { importBatchId: b.id, OR: [{ isColdCall: true }, { leadOrigin: "COLD" }] } });

    console.log(`── Batch ${b.id}`);
    console.log(`   fileName      : ${b.fileName}`);
    console.log(`   importType    : ${b.importType ?? "—"}   team: ${b.team ?? "—"}`);
    console.log(`   importedBy    : ${b.importedBy?.name ?? "—"}   at: ${b.createdAt.toISOString()}`);
    console.log(`   status        : ${b.status}${b.deletedAt ? ` (deletedAt ${b.deletedAt.toISOString()})` : ""}`);
    console.log(`   totalRows     : ${b.totalRows}  created: ${b.createdCount}  updated: ${b.updatedCount}`);
    console.log(`   LEADS now     : total=${total}  live=${live}  soft-deleted=${softDel}`);
    console.log(`   owned by Tanuj: ${ownedTanuj}   cold(isColdCall|origin=COLD): ${cold}`);
    console.log("");
  }

  // Sanity: Tanuj's overall book so we can confirm Leads stay intact after delete.
  const tTotal = await prisma.lead.count({ where: { ownerId: tanuj.id } });
  const tLive  = await prisma.lead.count({ where: { ownerId: tanuj.id, deletedAt: null } });
  const tCold  = await prisma.lead.count({ where: { ownerId: tanuj.id, OR: [{ isColdCall: true }, { leadOrigin: "COLD" }] } });
  const tActive= await prisma.lead.count({ where: { ownerId: tanuj.id, deletedAt: null, isColdCall: false, leadOrigin: { not: "COLD" } } });
  console.log(`Tanuj book: total(incl del)=${tTotal}  live=${tLive}  cold=${tCold}  active-non-cold-live=${tActive}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
