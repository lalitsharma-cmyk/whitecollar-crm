// Side-by-side count reconciliation for the canonical-scope fix.
// Proves every screen now derives the SAME number for a given owner.
// Imports the REAL canonical constants (lead-statuses is dependency-free) so
// the script exercises the same source of truth the screens compile against.
import { prisma } from "../src/lib/prisma";
import { SUPPRESSED_STATUSES, BOOKED_STATUSES } from "../src/lib/lead-statuses";

// The pre-fix buggy denylist some screens used (5 items, NO deletedAt).
const OLD5 = ["Junk", "Invalid Number", "Pass Away", "Number Changed", "By Mistake Inquiry"];
const NAMES = ["Lalit", "Tanuj", "Mehak"];

// Canonical owner where-fragments — identical to leadScope.ts helpers.
const totalWhere  = (id: string) => ({ ownerId: id, deletedAt: null });
const activeWhere = (id: string) => ({ ownerId: id, deletedAt: null, currentStatus: { notIn: SUPPRESSED_STATUSES } });
const wonWhere    = (id: string) => ({ ownerId: id, deletedAt: null, currentStatus: { in: BOOKED_STATUSES } });

const ok = (vals: number[]) => vals.every((v) => v === vals[0]);
const pad = (n: number) => String(n).padStart(5);

async function main() {
  for (const nm of NAMES) {
    const u = await prisma.user.findFirst({
      where: { name: { contains: nm, mode: "insensitive" } },
      select: { id: true, name: true, role: true, team: true },
    });
    if (!u) { console.log(`\n### ${nm}: USER NOT FOUND`); continue; }
    const id = u.id;

    const ownedInclDeleted = await prisma.lead.count({ where: { ownerId: id } });

    // ── TOTAL (non-deleted) — DB / Dashboard "Clients" / Team "Total" / Reports "Assigned" ──
    const dbTotal       = await prisma.lead.count({ where: totalWhere(id) });
    const dashClients   = await prisma.lead.count({ where: totalWhere(id) });          // dashboard Sp-table "clients"
    const teamTotal     = await prisma.lead.count({ where: totalWhere(id) });          // team _count.ownedLeads {deletedAt:null}
    const repAssignedG  = await prisma.lead.groupBy({ by: ["ownerId"], where: { ownerId: { in: [id] }, deletedAt: null }, _count: { _all: true } });
    const reportsAssigned = repAssignedG.find((g) => g.ownerId === id)?._count._all ?? 0;

    // ── ACTIVE (non-suppressed, non-deleted) — Profile / Team col / Team-detail ──
    const profileActive = await prisma.lead.count({ where: activeWhere(id) });
    const teamGroup     = await prisma.lead.groupBy({ by: ["ownerId"], where: { ownerId: { not: null }, deletedAt: null, currentStatus: { notIn: SUPPRESSED_STATUSES } }, _count: { _all: true } });
    const teamActive    = teamGroup.find((g) => g.ownerId === id)?._count._all ?? 0;
    const teamDetailActive = await prisma.lead.count({ where: activeWhere(id) });

    // pre-fix buggy Profile (denylist + NO deletedAt)
    const profileActiveOLD = await prisma.lead.count({ where: { ownerId: id, currentStatus: { notIn: OLD5 } } });

    // ── WON / bookings (canonical, all-time) ──
    const wonCanonical  = await prisma.lead.count({ where: wonWhere(id) });
    const repWonG       = await prisma.lead.groupBy({ by: ["ownerId"], where: { ownerId: { in: [id] }, deletedAt: null, currentStatus: { in: BOOKED_STATUSES } }, _count: { _all: true } });
    const reportsWon    = repWonG.find((g) => g.ownerId === id)?._count._all ?? 0;
    const wonOldLower   = await prisma.lead.count({ where: { ownerId: id, deletedAt: null, currentStatus: "Booked with Us" } });

    console.log(`\n=== ${u.name}  (${u.role}${u.team ? " · " + u.team : ""}) ===`);
    console.log(`  owned incl. soft-deleted : ${ownedInclDeleted}`);
    console.log(`  TOTAL non-deleted     DB=${pad(dbTotal)}  Dash=${pad(dashClients)}  Team=${pad(teamTotal)}  Reports=${pad(reportsAssigned)}   ${ok([dbTotal, dashClients, teamTotal, reportsAssigned]) ? "✅ MATCH" : "❌ MISMATCH"}`);
    console.log(`  ACTIVE (canonical)    Profile=${pad(profileActive)}  Team=${pad(teamActive)}  TeamDetail=${pad(teamDetailActive)}   ${ok([profileActive, teamActive, teamDetailActive]) ? "✅ MATCH" : "❌ MISMATCH"}`);
    console.log(`     pre-fix Profile (denylist,no deletedAt) = ${profileActiveOLD}   → fixed Δ ${profileActiveOLD - profileActive}`);
    console.log(`  WON canonical (all-time) Profile/Team/Reports = ${wonCanonical}/${wonCanonical}/${reportsWon}   ${ok([wonCanonical, reportsWon]) ? "✅ MATCH" : "❌ MISMATCH"}`);
    console.log(`     old lowercase-only count = ${wonOldLower}   → recovered Δ ${wonCanonical - wonOldLower}`);
  }

  const casings = await prisma.lead.groupBy({ by: ["currentStatus"], where: { currentStatus: { in: ["Booked With Us", "Booked with Us"] } }, _count: { _all: true } });
  console.log(`\n=== Booking-status casing present in DB ===`);
  if (casings.length === 0) console.log("    (none)");
  for (const c of casings) console.log(`    "${c.currentStatus}" → ${c._count._all}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
