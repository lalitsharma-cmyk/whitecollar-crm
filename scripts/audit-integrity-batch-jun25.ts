/**
 * scripts/audit-integrity-batch-jun25.ts  — READ-ONLY
 *
 * Pre-flight audit for the 2026-06-25 data-integrity batch. ZERO writes.
 * Reports the real prod counts that drive each of the 4 fixes + the
 * Action-List-Overdue vs Leads-Overdue reconciliation, so we know exactly
 * what each backfill will touch before running it.
 *
 *   npx tsx scripts/audit-integrity-batch-jun25.ts
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { TERMINAL_STATUSES, canonicalStatus } from "../src/lib/lead-statuses";
import { sourceEnumLabel } from "../src/lib/sourceLabel";
import { istDayRange } from "../src/lib/datetime";

// leadScope.ts imports "server-only" (bare tsx can't resolve), so mirror the two
// constants inline — kept byte-for-byte equivalent to src/lib/leadScope.ts.
const COLD_ORIGINS = ["COLD", "REVIVAL"];
const WORKABLE_STATUS_OR = [
  { currentStatus: null },
  { currentStatus: "" },
  { currentStatus: { notIn: TERMINAL_STATUSES } },
];

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

function h(s: string) { console.log("\n" + "═".repeat(64) + "\n" + s + "\n" + "═".repeat(64)); }

async function main() {
  h("FIX 1 — Activity.outcome backfill candidates (CALL activities ↔ CallLog)");
  const callActsTotal = await prisma.activity.count({ where: { type: "CALL" } });
  const callActsNullOutcome = await prisma.activity.count({ where: { type: "CALL", outcome: null } });
  const callActsSetOutcome = await prisma.activity.count({ where: { type: "CALL", outcome: { not: null } } });
  const callLogsTotal = await prisma.callLog.count();
  console.log(`CALL activities total:                 ${callActsTotal}`);
  console.log(`  with outcome already set:            ${callActsSetOutcome}`);
  console.log(`  with outcome NULL (candidates):      ${callActsNullOutcome}`);
  console.log(`CallLog rows total:                    ${callLogsTotal}`);
  // How many null-outcome CALL activities have a same-lead+same-user CallLog at all?
  const nullActs = await prisma.activity.findMany({
    where: { type: "CALL", outcome: null, userId: { not: null } },
    select: { id: true, leadId: true, userId: true, createdAt: true, completedAt: true, scheduledAt: true },
  });
  // Build per (leadId,userId) CallLog index.
  const logs = await prisma.callLog.findMany({
    where: { leadId: { not: null } },
    select: { id: true, leadId: true, userId: true, outcome: true, startedAt: true, createdAt: true },
  });
  const logIdx = new Map<string, { outcome: string; t: number }[]>();
  for (const l of logs) {
    const k = `${l.leadId}|${l.userId}`;
    const t = (l.startedAt ?? l.createdAt).getTime();
    (logIdx.get(k) ?? logIdx.set(k, []).get(k)!).push({ outcome: l.outcome, t });
  }
  let matchable = 0;
  const histo = new Map<string, number>();
  for (const a of nullActs) {
    const k = `${a.leadId}|${a.userId}`;
    const cands = logIdx.get(k);
    if (!cands || cands.length === 0) continue;
    matchable++;
    // nearest by time (activity anchor = completedAt ?? createdAt)
    const anchor = (a.completedAt ?? a.createdAt).getTime();
    let best = cands[0];
    for (const c of cands) if (Math.abs(c.t - anchor) < Math.abs(best.t - anchor)) best = c;
    histo.set(best.outcome, (histo.get(best.outcome) ?? 0) + 1);
  }
  console.log(`null-outcome CALL acts w/ user:        ${nullActs.length}`);
  console.log(`  → matchable to a CallLog (same lead+user): ${matchable}`);
  console.log(`  outcome distribution that WOULD be written:`);
  for (const [o, n] of [...histo.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${o.padEnd(16)} ${n}`);

  h("FIX 2 — Terminal leads carrying a followupDate (pollute Action List Overdue)");
  const termWithFollowup = await prisma.lead.count({
    where: { deletedAt: null, currentStatus: { in: TERMINAL_STATUSES }, followupDate: { not: null } },
  });
  console.log(`Live terminal leads w/ followupDate != null: ${termWithFollowup}`);
  const termBreakdown = await prisma.lead.groupBy({
    by: ["currentStatus"],
    where: { deletedAt: null, currentStatus: { in: TERMINAL_STATUSES }, followupDate: { not: null } },
    _count: true,
  });
  for (const r of termBreakdown.sort((a, b) => (b._count as number) - (a._count as number)))
    console.log(`   ${(r.currentStatus ?? "(null)").padEnd(28)} ${r._count}`);

  // Reconciliation numbers — Action-List Overdue vs Leads Overdue chip (ADMIN scope = all non-deleted).
  h("RECONCILIATION — Action-List Overdue vs Leads Overdue chip (admin scope)");
  const startToday = istDayRange().start;
  const now = new Date();
  // Action List overdue (current behavior): scope(deletedAt:null) + followupDate < startOfTodayIST, NO status filter.
  const alOverdueNow = await prisma.lead.count({ where: { deletedAt: null, followupDate: { lt: startToday } } });
  // Leads chip overdue (current behavior): workableWhere + followupDate < now (not null).
  const leadsOverdueNow = await prisma.lead.count({
    where: { deletedAt: null, leadOrigin: { notIn: COLD_ORIGINS }, OR: WORKABLE_STATUS_OR, followupDate: { lt: now, not: null } },
  });
  // Apples-to-apples: Action List overdue AFTER terminal leads lose followupDate (simulate by adding workable status filter on the SAME window).
  const alOverdueAfter = await prisma.lead.count({
    where: { deletedAt: null, OR: WORKABLE_STATUS_OR, followupDate: { lt: startToday } },
  });
  // Same window + workable + non-cold (true apples-to-apples with the Leads chip envelope, on the Action-List window).
  const alOverdueAfterEnvelope = await prisma.lead.count({
    where: { deletedAt: null, leadOrigin: { notIn: COLD_ORIGINS }, OR: WORKABLE_STATUS_OR, followupDate: { lt: startToday } },
  });
  console.log(`Action-List Overdue NOW  (no status filter, < startOfTodayIST): ${alOverdueNow}`);
  console.log(`Leads Overdue chip NOW   (workable, < now):                    ${leadsOverdueNow}`);
  console.log(`Action-List Overdue AFTER backfill (terminal lose followup):   ${alOverdueAfter}`);
  console.log(`   …same but +non-cold envelope (matches Leads chip filters):  ${alOverdueAfterEnvelope}`);
  console.log(`Δ removed from Action-List Overdue by the fix:                 ${alOverdueNow - alOverdueAfter}`);
  console.log(`(note: residual gap vs Leads chip = time boundary <now vs <startOfTodayIST + cold-origin)`);

  // Do any cold/revival leads carry an overdue followupDate (origin-only gap)?
  const coldOverdue = await prisma.lead.count({
    where: { deletedAt: null, leadOrigin: { in: COLD_ORIGINS }, followupDate: { lt: startToday } },
  });
  console.log(`Cold/Revival-origin leads w/ overdue followup (origin-only gap): ${coldOverdue}`);

  h("FIX 3 — sourceRaw NULL (source enum is non-nullable, always set)");
  // Lead.source is `LeadSource @default(WEBSITE)` — never null. So the only gap is
  // sourceRaw IS NULL: those leads are silently omitted from the Source column
  // filter (built from distinct non-null sourceRaw).
  const nullSourceRaw = await prisma.lead.count({ where: { deletedAt: null, sourceRaw: null } });
  console.log(`Live leads sourceRaw NULL (source always set): ${nullSourceRaw}`);
  const bySrc = await prisma.lead.groupBy({
    by: ["source"],
    where: { deletedAt: null, sourceRaw: null },
    _count: true,
  });
  for (const r of bySrc.sort((a, b) => (b._count as number) - (a._count as number)))
    console.log(`   ${String(r.source).padEnd(16)} → "${sourceEnumLabel(r.source)}"   ${r._count}`);

  h("FIX 4 — Mis-cased / variant statuses that fragment chips & fall outside dropdown");
  // Show all distinct currentStatus that differ from their canonical form, OR are the known offenders.
  const KNOWN = ["Long Term Followup", "Long-term Followup", "Long Follow Up", "Fund Issue", "Other"];
  const allStatuses = await prisma.lead.groupBy({
    by: ["currentStatus"],
    where: { deletedAt: null, currentStatus: { not: null } },
    _count: true,
  });
  console.log(`Distinct non-null currentStatus values: ${allStatuses.length}`);
  console.log(`\nVariants where canonicalStatus() ALREADY folds (alias would take effect):`);
  let foldable = 0;
  for (const r of allStatuses) {
    const cur = r.currentStatus!;
    const can = canonicalStatus(cur);
    if (can && can !== cur) { console.log(`   "${cur}"  →  "${can}"   (${r._count})`); foldable += r._count as number; }
  }
  console.log(`   foldable-by-existing-canonical total: ${foldable}`);
  console.log(`\nKnown offenders (need NEW aliases) present in data:`);
  for (const k of KNOWN) {
    const n = await prisma.lead.count({ where: { deletedAt: null, currentStatus: k } });
    if (n > 0) console.log(`   "${k}"   ${n}   (canonical today → "${canonicalStatus(k)}")`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
