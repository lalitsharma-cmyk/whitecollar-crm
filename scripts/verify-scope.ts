// READ-ONLY post-purge scope verification: prove ONLY Mehak's data was removed.
import { prisma } from "../src/lib/prisma";

async function main() {
  const sysTotal = await prisma.lead.count();
  const sysLive = await prisma.lead.count({ where: { deletedAt: null } });
  console.log(`SYSTEM: total=${sysTotal}  live=${sysLive}  (was total=346 live=253 before Mehak purge → exactly -82 total / -81 live)`);

  console.log("\n=== Live leads per owner (everyone except Mehak should be intact) ===");
  const byOwner = await prisma.lead.groupBy({ by: ["ownerId"], where: { deletedAt: null }, _count: { _all: true } });
  const users = await prisma.user.findMany({ select: { id: true, name: true, team: true } });
  const unm = Object.fromEntries(users.map(u => [u.id, `${u.name}${u.team ? " ("+u.team+")" : ""}`]));
  for (const r of byOwner.sort((a, b) => b._count._all - a._count._all)) {
    console.log(`  ${(r.ownerId ? (unm[r.ownerId] ?? r.ownerId) : "UNASSIGNED").padEnd(28)} ${r._count._all}`);
  }
  const mehak = users.find(u => /mehak/i.test(u.name));
  if (mehak) console.log(`\n  Mehak live leads now: ${await prisma.lead.count({ where: { ownerId: mehak.id, deletedAt: null } })}  (expected 0)`);

  console.log("\n=== Live leads per team (Dubai/India production intact) ===");
  const byTeam = await prisma.lead.groupBy({ by: ["forwardedTeam"], where: { deletedAt: null }, _count: { _all: true } });
  for (const r of byTeam) console.log(`  ${(r.forwardedTeam ?? "(unclassified)").padEnd(16)} ${r._count._all}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
