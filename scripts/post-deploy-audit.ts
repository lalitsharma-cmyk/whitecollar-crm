// READ-ONLY post-deploy CRM consistency audit. Counts + module separation.
import { prisma } from "../src/lib/prisma";
import { SUPPRESSED_STATUSES, BOOKED_STATUSES, TERMINAL_STATUSES } from "../src/lib/lead-statuses";

const NAMES = ["Lalit", "Tanuj", "Mehak"];

async function main() {
  console.log("=== A. COUNT RECONCILIATION (canonical) ===");
  for (const nm of NAMES) {
    const u = await prisma.user.findFirst({ where: { name: { contains: nm, mode: "insensitive" } }, select: { id: true, name: true, role: true } });
    if (!u) { console.log(`  ${nm}: NOT FOUND`); continue; }
    const total  = await prisma.lead.count({ where: { ownerId: u.id, deletedAt: null } });
    const active = await prisma.lead.count({ where: { ownerId: u.id, deletedAt: null, currentStatus: { notIn: SUPPRESSED_STATUSES } } });
    const won    = await prisma.lead.count({ where: { ownerId: u.id, deletedAt: null, currentStatus: { in: BOOKED_STATUSES } } });
    const inclDel= await prisma.lead.count({ where: { ownerId: u.id } });
    console.log(`  ${u.name.padEnd(14)} total(non-del)=${total}  active=${active}  won=${won}   (incl. soft-deleted=${inclDel})`);
  }

  console.log("\n=== B. MODULE SEPARATION (system-wide, deletedAt:null) ===");
  const live        = await prisma.lead.count({ where: { deletedAt: null } });
  const coldLive    = await prisma.lead.count({ where: { deletedAt: null, OR: [{ isColdCall: true }, { leadOrigin: "COLD" }] } });
  const leadsUniverse = await prisma.lead.count({ where: { deletedAt: null, isColdCall: false, currentStatus: { notIn: TERMINAL_STATUSES } } });
  const terminalLive= await prisma.lead.count({ where: { deletedAt: null, currentStatus: { in: TERMINAL_STATUSES } } });
  // The leak: cold by ORIGIN but isColdCall=false AND in a workable status → would appear in the Leads working view.
  const coldLeak    = await prisma.lead.count({ where: { deletedAt: null, isColdCall: false, leadOrigin: "COLD", currentStatus: { notIn: TERMINAL_STATUSES } } });
  console.log(`  live leads ................... ${live}`);
  console.log(`  cold (isColdCall|origin=COLD)  ${coldLive}`);
  console.log(`  Leads working universe ....... ${leadsUniverse}  (deletedAt:null, isColdCall:false, non-terminal)`);
  console.log(`  terminal (closed+lost) ....... ${terminalLive}  (Master Data only)`);
  console.log(`  ⚠ COLD-ORIGIN LEAK into Leads  ${coldLeak}  (leadOrigin=COLD, isColdCall=false, workable → leaks past isColdCall filter)`);

  console.log("\n=== C. DUPLICATE-COUNT INTEGRITY ===");
  const withDup = await prisma.lead.count({ where: { deletedAt: null, duplicateCount: { gt: 0 } } });
  console.log(`  live leads with duplicateCount>0 : ${withDup}`);

  console.log("\n=== D. BOOKING CASING (whole DB) ===");
  const casings = await prisma.lead.groupBy({ by: ["currentStatus"], where: { currentStatus: { in: ["Booked With Us", "Booked with Us"] } }, _count: { _all: true } });
  for (const c of casings) console.log(`  "${c.currentStatus}" → ${c._count._all}`);
  if (!casings.length) console.log("  (no bookings)");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
