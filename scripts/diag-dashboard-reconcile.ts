// READ-ONLY reconciliation — proves the dashboard widget count == the /leads drill
// query == a direct DB count, per agent, AFTER the count==drill fix.
//
//   npx tsx scripts/diag-dashboard-reconcile.ts
//
// For each widget we compute THREE numbers and assert they match:
//   CARD  = the dashboard count (canonical where)
//   DRILL = the /leads page where the card's href reproduces
//   DB    = an independent direct prisma count of the same definition
// No writes. Safe against prod Neon.
import { prisma } from "../src/lib/prisma";
import { AIScore, ActivityType, Prisma } from "@prisma/client";
import { SUPPRESSED_STATUSES, CLOSING_STATUSES, TERMINAL_STATUSES } from "../src/lib/lead-statuses";
import { hotUntouchedWhere, CONTACT_ACTIVITY_TYPES, UNTOUCHED_WHERE } from "../src/lib/dashboardWidgets";

const COLD_ORIGINS = ["COLD", "REVIVAL"];
const WORKABLE_STATUS_OR = [
  { currentStatus: null },
  { currentStatus: "" },
  { currentStatus: { notIn: TERMINAL_STATUSES } },
];
const workable = (scope: Prisma.LeadWhereInput): Prisma.LeadWhereInput => ({
  ...scope, leadOrigin: { notIn: COLD_ORIGINS }, OR: WORKABLE_STATUS_OR,
});

// Reproduce the /leads page where for the relevant params, for a given owner scope.
// Mirrors src/app/(app)/leads/page.tsx exactly for the params the cards use.
function leadsDrillWhere(ownerId: string, params: Record<string, string>): Prisma.LeadWhereInput {
  // Base working-view scope: owner + non-deleted + non-cold + isColdCall:false.
  const where: Prisma.LeadWhereInput = {
    ownerId, deletedAt: null, isColdCall: false, leadOrigin: { notIn: COLD_ORIGINS },
  };
  const and: Prisma.LeadWhereInput[] = [];
  // working view (no explicit cstatus/status) → workable OR
  and.push({ OR: WORKABLE_STATUS_OR });
  if (params.ai) where.aiScore = params.ai as AIScore;
  if (params.untouched === "1") {
    where.callLogs = { none: {} };
    where.activities = { none: { type: { in: CONTACT_ACTIVITY_TYPES } } };
  }
  if (params.smart === "visit_potential") and.push({ currentStatus: { in: CLOSING_STATUSES } });
  // follow-up: card drills pass followup=all (no narrowing) OR followup=overdue.
  if (params.followup === "overdue") where.followupDate = { lt: new Date(), not: null };
  // followup=all → no follow-up filter.
  where.AND = and;
  return where;
}

const ok3 = (a: number, b: number, c: number) => a === b && b === c;
const p = (n: number) => String(n).padStart(4);

async function main() {
  const agents = await prisma.user.findMany({
    where: { active: true, role: { in: ["AGENT", "MANAGER", "ADMIN"] }, hrOnly: false },
    select: { id: true, name: true, role: true, team: true },
    orderBy: { name: "asc" },
  });

  console.log("\n===== DASHBOARD RECONCILIATION (CARD == DRILL == DB), per agent — READ-ONLY =====\n");
  console.log("widget                     CARD  DRILL  DB    match\n");

  let allOk = true;
  const totals: Record<string, [number, number, number]> = {
    "Hot Untouched": [0, 0, 0], "Overdue": [0, 0, 0], "Closable": [0, 0, 0],
  };

  for (const u of agents) {
    const meScope: Prisma.LeadWhereInput = { ownerId: u.id, deletedAt: null, leadOrigin: { notIn: COLD_ORIGINS } };

    // ── HOT UNTOUCHED ──
    const hotCard = await prisma.lead.count({ where: hotUntouchedWhere(meScope) });
    const hotDrill = await prisma.lead.count({ where: leadsDrillWhere(u.id, { ai: "HOT", untouched: "1", followup: "all" }) });
    const hotDb = await prisma.lead.count({
      where: {
        ownerId: u.id, deletedAt: null, isColdCall: false, leadOrigin: { notIn: COLD_ORIGINS },
        aiScore: AIScore.HOT, callLogs: { none: {} },
        activities: { none: { type: { in: CONTACT_ACTIVITY_TYPES } } },
        AND: [{ OR: WORKABLE_STATUS_OR }],
      },
    });

    // ── OVERDUE FOLLOWUP ──
    const ovCard = await prisma.lead.count({ where: { ...workable(meScope), followupDate: { lt: new Date(), not: null } } });
    const ovDrill = await prisma.lead.count({ where: leadsDrillWhere(u.id, { followup: "overdue" }) });
    const ovDb = await prisma.lead.count({
      where: { ownerId: u.id, deletedAt: null, leadOrigin: { notIn: COLD_ORIGINS }, OR: WORKABLE_STATUS_OR, followupDate: { lt: new Date(), not: null } },
    });

    // ── CLOSABLE ──
    const clCard = await prisma.lead.count({ where: { ...workable(meScope), currentStatus: { in: CLOSING_STATUSES } } });
    const clDrill = await prisma.lead.count({ where: leadsDrillWhere(u.id, { smart: "visit_potential", followup: "all" }) });
    const clDb = await prisma.lead.count({
      where: { ownerId: u.id, deletedAt: null, leadOrigin: { notIn: COLD_ORIGINS }, OR: WORKABLE_STATUS_OR, currentStatus: { in: CLOSING_STATUSES } },
    });

    totals["Hot Untouched"] = [totals["Hot Untouched"][0] + hotCard, totals["Hot Untouched"][1] + hotDrill, totals["Hot Untouched"][2] + hotDb];
    totals["Overdue"] = [totals["Overdue"][0] + ovCard, totals["Overdue"][1] + ovDrill, totals["Overdue"][2] + ovDb];
    totals["Closable"] = [totals["Closable"][0] + clCard, totals["Closable"][1] + clDrill, totals["Closable"][2] + clDb];

    const rowOk = ok3(hotCard, hotDrill, hotDb) && ok3(ovCard, ovDrill, ovDb) && ok3(clCard, clDrill, clDb);
    if (!rowOk) allOk = false;
    if (hotCard || ovCard || clCard) {
      console.log(`--- ${u.name} (${u.role}${u.team ? " · " + u.team : ""}) ---`);
      console.log(`  Hot Leads Untouched      ${p(hotCard)}  ${p(hotDrill)}  ${p(hotDb)}   ${ok3(hotCard, hotDrill, hotDb) ? "✅" : "❌"}`);
      console.log(`  Overdue Follow-ups       ${p(ovCard)}  ${p(ovDrill)}  ${p(ovDb)}   ${ok3(ovCard, ovDrill, ovDb) ? "✅" : "❌"}`);
      console.log(`  Closable Deals           ${p(clCard)}  ${p(clDrill)}  ${p(clDb)}   ${ok3(clCard, clDrill, clDb) ? "✅" : "❌"}`);
    }
  }

  console.log(`\n===== COMPANY-WIDE TOTALS (sum across agents) =====`);
  for (const [k, [c, d, b]] of Object.entries(totals)) {
    console.log(`  ${k.padEnd(24)} CARD=${p(c)}  DRILL=${p(d)}  DB=${p(b)}   ${ok3(c, d, b) ? "✅" : "❌"}`);
  }

  // The headline: old buggy drill (ai=HOT&when=overdue + todue default) vs new.
  const oldDrillAll = await prisma.lead.count({
    where: {
      deletedAt: null, isColdCall: false, leadOrigin: { notIn: COLD_ORIGINS },
      aiScore: AIScore.HOT, lastTouchedAt: { lt: new Date(Date.now() - 5 * 24 * 3600 * 1000) },
      followupDate: { lt: new Date(Date.now() + 0), not: null }, AND: [{ OR: WORKABLE_STATUS_OR }],
    },
  });
  void UNTOUCHED_WHERE; // (referenced for import sanity)
  console.log(`\n  (context) OLD buggy Hot-Untouched drill company-wide (the 8-vs-0 path) = ${oldDrillAll}`);

  console.log(`\nRESULT: ${allOk ? "✅ ALL WIDGETS RECONCILE (count == drill == db)" : "❌ a widget still mismatches"}\n`);
  process.exit(allOk ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
