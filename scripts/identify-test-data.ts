// READ-ONLY. Identify candidate TEST DATA for Mehak + Tanuj so the user can
// confirm exactly what to hard-delete. Deletes nothing.
import { prisma } from "../src/lib/prisma";

const TEST_NAME = /\b(test|testing|dummy|sample|demo|asdf|qwerty|abc|xyz|trial|check|ignore)\b/i;

async function who(nm: string) {
  return prisma.user.findFirst({ where: { name: { contains: nm, mode: "insensitive" } }, select: { id: true, name: true } });
}

async function main() {
  const mehak = await who("Mehak");
  const tanuj = await who("Tanuj");
  console.log(`Mehak = ${mehak ? mehak.id : "NOT FOUND"} | Tanuj = ${tanuj ? tanuj.id : "NOT FOUND"}`);

  // ── ALL import batches (so user can pick a test batch) ──
  console.log("\n=== IMPORT BATCHES (all) ===");
  const batches = await prisma.importBatch.findMany({ include: { importedBy: { select: { name: true } } }, orderBy: { createdAt: "desc" } });
  for (const b of batches) {
    const total = await prisma.lead.count({ where: { importBatchId: b.id } });
    const live = await prisma.lead.count({ where: { importBatchId: b.id, deletedAt: null } });
    const mehakN = mehak ? await prisma.lead.count({ where: { importBatchId: b.id, ownerId: mehak.id } }) : 0;
    const tanujN = tanuj ? await prisma.lead.count({ where: { importBatchId: b.id, ownerId: tanuj.id } }) : 0;
    console.log(`  ${b.id}  "${b.fileName}"  type=${b.importType ?? "—"}  status=${b.status}  by=${b.importedBy?.name ?? "—"}  ${b.createdAt.toISOString().slice(0,16)}  leads(total/live)=${total}/${live}  Mehak=${mehakN} Tanuj=${tanujN}`);
  }

  // ── Confirm Tanuj's Silverglades cold import is gone ──
  const silver = await prisma.importBatch.findUnique({ where: { id: "cmqdhizp10001lb04fd3mni3t" } });
  console.log(`\n=== Tanuj Silverglades cold batch (cmqdhizp...) → ${silver ? "STILL EXISTS" : "GONE (purged) ✅"} ===`);
  if (tanuj) {
    const tCold = await prisma.lead.count({ where: { ownerId: tanuj.id, OR: [{ isColdCall: true }, { leadOrigin: "COLD" }] } });
    console.log(`  Tanuj cold leads remaining: ${tCold}`);
  }

  // ── Mehak's book ──
  if (mehak) {
    const total = await prisma.lead.count({ where: { ownerId: mehak.id } });
    const live = await prisma.lead.count({ where: { ownerId: mehak.id, deletedAt: null } });
    const del = await prisma.lead.count({ where: { ownerId: mehak.id, deletedAt: { not: null } } });
    console.log(`\n=== Mehak book: total(incl del)=${total}  live=${live}  soft-deleted=${del} ===`);
    const bySource = await prisma.lead.groupBy({ by: ["source"], where: { ownerId: mehak.id, deletedAt: null }, _count: { _all: true } });
    console.log(`  by source: ${bySource.map(s => `${s.source}:${s._count._all}`).join(", ")}`);
    const byBatch = await prisma.lead.groupBy({ by: ["importBatchId"], where: { ownerId: mehak.id }, _count: { _all: true } });
    console.log(`  by importBatch: ${byBatch.map(b => `${b.importBatchId ?? "(manual/none)"}:${b._count._all}`).join(", ")}`);
  }

  // ── Test-looking lead NAMES across the whole system ──
  console.log("\n=== Leads with TEST-looking names (whole system, incl deleted) ===");
  const all = await prisma.lead.findMany({ select: { id: true, name: true, ownerId: true, source: true, isColdCall: true, leadOrigin: true, deletedAt: true, createdAt: true }, orderBy: { createdAt: "desc" } });
  const ownerName: Record<string,string> = {};
  if (mehak) ownerName[mehak.id] = "Mehak";
  if (tanuj) ownerName[tanuj.id] = "Tanuj";
  const suspects = all.filter(l => l.name && TEST_NAME.test(l.name));
  console.log(`  found ${suspects.length} test-looking names:`);
  for (const l of suspects.slice(0, 40)) {
    console.log(`    "${l.name}"  owner=${l.ownerId ? (ownerName[l.ownerId] ?? l.ownerId.slice(0,6)) : "—"}  src=${l.source}  cold=${l.isColdCall}  origin=${l.leadOrigin}  ${l.deletedAt ? "DELETED" : "live"}  ${l.createdAt.toISOString().slice(0,10)}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
