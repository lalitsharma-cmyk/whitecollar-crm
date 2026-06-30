import { prisma } from "../src/lib/prisma";

async function uname(id: string | null): Promise<string> {
  if (!id) return "(unassigned)";
  const u = await prisma.user.findUnique({ where: { id }, select: { name: true } });
  return u?.name ?? id;
}

async function main() {
  for (const nm of ["Raushan Prasad", "Akanksha Chugh"]) {
    const rows = await prisma.lead.findMany({
      where: { name: { contains: nm, mode: "insensitive" }, deletedAt: null },
      select: { id: true, name: true, ownerId: true, previousOwnerId: true, currentStatus: true, leadOrigin: true, assignedAt: true,
        owner: { select: { name: true } } },
    });
    console.log(`\n=== ${nm} ===`);
    if (!rows.length) { console.log("  (not found / deleted)"); continue; }
    for (const r of rows) {
      const asg = await prisma.assignment.findMany({ where: { leadId: r.id }, select: { user: { select: { name: true } }, assignedAt: true }, orderBy: { assignedAt: "asc" } });
      console.log(`  ${r.name} [${r.id}] origin=${r.leadOrigin} status=${r.currentStatus}`);
      console.log(`    current owner   : ${r.owner?.name ?? "(unassigned)"}`);
      console.log(`    previousOwnerId : ${await uname(r.previousOwnerId)}`);
      console.log(`    assignedAt      : ${r.assignedAt?.toISOString() ?? "-"}`);
      console.log(`    assignment HIST : ${asg.map((a) => `${a.user?.name}@${a.assignedAt?.toISOString().slice(0,10)}`).join("  ·  ")}`);
    }
  }

  // How many reassigned leads (current owner != some historical assignee) are out there?
  const owned = await prisma.lead.findMany({
    where: { deletedAt: null, ownerId: { not: null } },
    select: { id: true, ownerId: true, assignments: { select: { userId: true } } },
    take: 5000,
  });
  const crossOwner = owned.filter((l) => l.assignments.some((a) => a.userId !== l.ownerId));
  console.log(`\n=== Leads whose CURRENT owner differs from a historical assignee (history-stale population): ${crossOwner.length} ===`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
