/**
 * scripts/diag-warfear-impact.ts   (READ-ONLY — ZERO writes)
 *
 * Impact assessment for reclassifying "War Fear" from a LOST/terminal status to a
 * WORKABLE one CRM-wide. Reports exactly which leads flip from "lost / Master-Data"
 * to "workable / active Leads", so the change can be approved with eyes open.
 *
 * Usage:  npx tsx scripts/diag-warfear-impact.ts
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { TERMINAL_STATUSES } from "../src/lib/lead-statuses";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const COLD = ["COLD", "REVIVAL"];

async function main() {
  console.log("🪖  'War Fear' → WORKABLE — impact assessment (READ-ONLY, no changes)");
  console.log("═".repeat(78));

  // 1. Every live War Fear lead (these all flip terminal→workable).
  const live = await prisma.lead.count({ where: { deletedAt: null, currentStatus: "War Fear" } });
  const deleted = await prisma.lead.count({ where: { deletedAt: { not: null }, currentStatus: "War Fear" } });
  console.log(`\nLive leads with currentStatus = "War Fear": ${live}   (soft-deleted, unaffected: ${deleted})`);

  // 2. Where they live today (leadOrigin) — ACTIVE_LEAD ones will re-enter the
  //    working Leads view; COLD/REVIVAL stay in the Revival Engine either way.
  const byOrigin = await prisma.lead.groupBy({
    by: ["leadOrigin"], where: { deletedAt: null, currentStatus: "War Fear" }, _count: true,
  });
  console.log("\nBy section (leadOrigin) — ACTIVE_LEAD ones newly appear in the working Leads list:");
  for (const r of byOrigin.sort((a, b) => (b._count as number) - (a._count as number))) {
    console.log(`   ${String(r.leadOrigin).padEnd(14)} ${r._count}`);
  }

  // 3. Team + ownership split.
  const byTeam = await prisma.lead.groupBy({ by: ["forwardedTeam"], where: { deletedAt: null, currentStatus: "War Fear" }, _count: true });
  console.log("\nBy team:");
  for (const r of byTeam) console.log(`   ${String(r.forwardedTeam ?? "—").padEnd(14)} ${r._count}`);
  const unassigned = await prisma.lead.count({ where: { deletedAt: null, currentStatus: "War Fear", ownerId: null } });
  console.log(`   (unassigned: ${unassigned})`);

  // 4. How many War Fear leads currently carry a follow-up (the board-pollution set)
  //    and how many were put into War Fear via the REJECT flow (rejectedAt set).
  const withFollowup = await prisma.lead.count({ where: { deletedAt: null, currentStatus: "War Fear", followupDate: { not: null } } });
  const rejectedFlagged = await prisma.lead.count({ where: { deletedAt: null, currentStatus: "War Fear", rejectedAt: { not: null } } });
  console.log(`\nWar Fear leads with a follow-up date (become legit once workable): ${withFollowup}`);
  console.log(`War Fear leads carrying a stale rejectedAt (were reject-flagged):   ${rejectedFlagged}`);

  // 5. Leads rejected with REASON = War Fear anywhere (historical label must still resolve).
  const reasonWarFear = await prisma.lead.count({ where: { rejectionReason: "WAR_FEAR" } });
  console.log(`Leads whose rejectionReason = "WAR_FEAR" (any state): ${reasonWarFear}`);

  // 6. The active-Leads workable count BEFORE vs AFTER (admin scope, non-cold).
  //    Mirrors workableWhere: non-cold origin + status not terminal.
  const TERM = TERMINAL_STATUSES;
  const TERM_NO_WARFEAR = TERM.filter((s) => s !== "War Fear");
  const workableBefore = await prisma.lead.count({
    where: { deletedAt: null, leadOrigin: { notIn: COLD }, OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERM } }] },
  });
  const workableAfter = await prisma.lead.count({
    where: { deletedAt: null, leadOrigin: { notIn: COLD }, OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERM_NO_WARFEAR } }] },
  });
  console.log(`\nWorkable active-Leads count (admin scope):  before ${workableBefore}  →  after ${workableAfter}   (+${workableAfter - workableBefore})`);

  // 7. After the reclassification, what terminal+followup leads remain? (Should be
  //    only the non-War-Fear straggler, Gagan — handled separately.)
  const remainingTerminalFollowup = await prisma.lead.findMany({
    where: { deletedAt: null, currentStatus: { in: TERM_NO_WARFEAR }, followupDate: { not: null } },
    select: { id: true, name: true, currentStatus: true, ownerId: true },
  });
  console.log(`\nTerminal+followup leads STILL remaining after War Fear→workable: ${remainingTerminalFollowup.length}`);
  for (const l of remainingTerminalFollowup) console.log(`   • ${l.name} [${l.id}] — ${l.currentStatus}  (needs separate handling)`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
