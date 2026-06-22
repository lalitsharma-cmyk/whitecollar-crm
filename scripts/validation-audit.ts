// READ-ONLY live-DB validation audit. Feeds the pre-Phase-C pass/fail report.
import { prisma } from "../src/lib/prisma";
import { SUPPRESSED_STATUSES, BOOKED_STATUSES } from "../src/lib/lead-statuses";

const NAMES = ["Lalit", "Tanuj", "Mehak"];

async function main() {
  // 1. COUNT RECONCILIATION
  console.log("=== 1. COUNTS (total/active/won, non-deleted, non-cold) ===");
  for (const nm of NAMES) {
    const u = await prisma.user.findFirst({ where: { name: { contains: nm, mode: "insensitive" } }, select: { id: true, name: true } });
    if (!u) { console.log(`  ${nm}: NOT FOUND`); continue; }
    const total  = await prisma.lead.count({ where: { ownerId: u.id, deletedAt: null, leadOrigin: { notIn: ["COLD", "REVIVAL"] } } });
    const active = await prisma.lead.count({ where: { ownerId: u.id, deletedAt: null, leadOrigin: { notIn: ["COLD", "REVIVAL"] }, currentStatus: { notIn: SUPPRESSED_STATUSES } } });
    const won    = await prisma.lead.count({ where: { ownerId: u.id, deletedAt: null, currentStatus: { in: BOOKED_STATUSES } } });
    console.log(`  ${u.name.padEnd(14)} total=${total}  active=${active}  won=${won}`);
  }

  // 2. MODULE SEPARATION — cold must not be live/workable
  console.log("\n=== 2. SEPARATION ===");
  const coldLive = await prisma.lead.count({ where: { deletedAt: null, OR: [{ isColdCall: true }, { leadOrigin: "COLD" }] } });
  const coldInLeads = await prisma.lead.count({ where: { deletedAt: null, leadOrigin: "COLD", isColdCall: false } });
  console.log(`  cold live=${coldLive}  cold-origin-but-isColdCall-false(leak risk)=${coldInLeads}`);

  // 3. COUNTRY AUTO-FILL — leads with a city but blank country (shows blank for ALL roles)
  console.log("\n=== 3. COUNTRY ===");
  const cityNoCountry = await prisma.lead.count({ where: { deletedAt: null, AND: [{ city: { not: null } }, { city: { not: "" } }], OR: [{ country: null }, { country: "" }] } });
  const totalWithCity = await prisma.lead.count({ where: { deletedAt: null, AND: [{ city: { not: null } }, { city: { not: "" } }] } });
  console.log(`  leads with city set: ${totalWithCity}  | of those, country BLANK: ${cityNoCountry}  (these render blank country for every role)`);
  const delhiNoCountry = await prisma.lead.findMany({ where: { deletedAt: null, city: { contains: "delhi", mode: "insensitive" }, OR: [{ country: null }, { country: "" }] }, select: { id: true, name: true, city: true, country: true }, take: 5 });
  for (const l of delhiNoCountry) console.log(`    Delhi/blank-country sample: ${l.name} city="${l.city}" country=${JSON.stringify(l.country)}`);

  // 4. BUDGET INTEGRITY — sample India leads to eyeball Cr/Lakh
  console.log("\n=== 4. BUDGET (India sample — budgetMin in rupees + currency) ===");
  const inr = await prisma.lead.findMany({ where: { deletedAt: null, budgetMin: { not: null, gt: 0 }, OR: [{ budgetCurrency: "INR" }, { forwardedTeam: "India" }] }, select: { name: true, budgetMin: true, budgetCurrency: true, forwardedTeam: true }, orderBy: { budgetMin: "desc" }, take: 8 });
  for (const l of inr) {
    const cr = (Number(l.budgetMin) / 10_000_000);
    console.log(`    ${(l.name ?? "").padEnd(18)} budgetMin=${l.budgetMin}  ccy=${l.budgetCurrency ?? "—"}  team=${l.forwardedTeam ?? "—"}  ≈ ${cr} Cr`);
  }

  // 5. BOOKING CASING
  console.log("\n=== 5. BOOKING CASING ===");
  const casings = await prisma.lead.groupBy({ by: ["currentStatus"], where: { currentStatus: { in: ["Booked With Us", "Booked with Us"] } }, _count: { _all: true } });
  for (const c of casings) console.log(`    "${c.currentStatus}" → ${c._count._all}`);

  // 6. leadOrigin distribution (for the Phase D vocabulary migration)
  console.log("\n=== 6. leadOrigin DISTRIBUTION ===");
  const origins = await prisma.lead.groupBy({ by: ["leadOrigin"], _count: { _all: true } });
  for (const o of origins) console.log(`    ${o.leadOrigin ?? "(null)"} → ${o._count._all}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
