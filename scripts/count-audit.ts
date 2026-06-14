import { prisma } from "../src/lib/prisma";
async function main(){
  const W = { deletedAt: null } as const;
  console.log("=== GROUND-TRUTH DB COUNTS (deletedAt=null unless noted) ===");
  console.log("Total (non-deleted):", await prisma.lead.count({ where: W }));
  console.log("Soft-deleted:        ", await prisma.lead.count({ where: { deletedAt: { not: null } } }));
  console.log("Assigned (owner set):", await prisma.lead.count({ where: { ...W, ownerId: { not: null } } }));
  console.log("Unassigned (null):   ", await prisma.lead.count({ where: { ...W, ownerId: null } }));
  console.log("rejectionReason set: ", await prisma.lead.count({ where: { ...W, rejectionReason: { not: null } } }));
  console.log("rejectedAt set:      ", await prisma.lead.count({ where: { ...W, rejectedAt: { not: null } } }));
  console.log("\n=== by status (non-deleted) ===");
  for (const g of (await prisma.lead.groupBy({ by: ["status"], where: W, _count: { _all: true } })).sort((a,b)=>b._count._all-a._count._all)) console.log(`  ${String(g.status).padEnd(16)} ${g._count._all}`);
  console.log("\n=== by leadOrigin (non-deleted) ===");
  for (const g of await prisma.lead.groupBy({ by: ["leadOrigin"], where: W, _count: { _all: true } })) console.log(`  ${String(g.leadOrigin).padEnd(12)} ${g._count._all}`);
  console.log("\n=== by currentStatus top 15 (non-deleted) ===");
  for (const g of (await prisma.lead.groupBy({ by: ["currentStatus"], where: W, _count: { _all: true } })).sort((a,b)=>b._count._all-a._count._all).slice(0,15)) console.log(`  ${String(g.currentStatus ?? "(null)").padEnd(28)} ${g._count._all}`);
  console.log("\n=== assigned per owner (top 12, non-deleted) ===");
  const byOwner = await prisma.lead.groupBy({ by: ["ownerId"], where: { ...W, ownerId: { not: null } }, _count: { _all: true } });
  for (const g of byOwner.sort((a,b)=>b._count._all-a._count._all).slice(0,12)) { const u = await prisma.user.findUnique({ where: { id: g.ownerId! }, select: { name: true, role: true } }); console.log(`  ${String(u?.name).padEnd(20)} (${u?.role}) ${g._count._all}`); }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
