/**
 * scripts/diag-terminal-followup-stragglers.ts   (READ-ONLY)
 *
 * Root-cause diagnostic for the `data-integrity-jun25` regression failure:
 *   "N terminal lead(s) still carry a followupDate".
 *
 * A lead in a TERMINAL status (isTerminalStatus) must have followupDate = null,
 * else it pollutes the Action-List follow-up board (which applies no status
 * filter). The prior backfill (backfill-terminal-followup.ts, task #165) cleared
 * the existing ~99; a NEW straggler set has appeared, so a status-change path is
 * setting a terminal status WITHOUT clearing followupDate.
 *
 * This script identifies the offending leads and, for each, reads the
 * LeadFieldHistory to prove WHICH path did it:
 *   • a currentStatus history row with source "bulk"             → leads/bulk set_current_status
 *   • a currentStatus history row with source "master-data-bulk" → master-data/bulk set_status
 *   • NO currentStatus history row                               → created terminal (importer)
 *   • source "reject" / "inline-edit"                            → those paths (should already clear)
 *
 * ZERO writes. Safe on prod. Usage:  npx tsx scripts/diag-terminal-followup-stragglers.ts
 */
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { TERMINAL_STATUSES, isTerminalStatus } from "../src/lib/lead-statuses";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const istStr = (d: Date | null | undefined) =>
  d ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) + " IST" : "—";

async function main() {
  console.log("🔎 Terminal-lead followupDate stragglers — root-cause diagnostic (READ-ONLY)");
  console.log("═".repeat(80));

  const leads = await prisma.lead.findMany({
    where: { deletedAt: null, currentStatus: { in: TERMINAL_STATUSES }, followupDate: { not: null } },
    select: {
      id: true, name: true, currentStatus: true, followupDate: true, followupReminderSentAt: true,
      leadOrigin: true, forwardedTeam: true, ownerId: true, createdAt: true, importBatchId: true,
      rejectedAt: true, rejectionReason: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\nLive terminal leads still carrying a followupDate: ${leads.length}\n`);
  if (leads.length === 0) { await prisma.$disconnect(); return; }

  const byStatus = new Map<string, number>();
  const byOrigin = new Map<string, number>();
  const byCulprit = new Map<string, number>();

  for (const l of leads) {
    byStatus.set(l.currentStatus ?? "(null)", (byStatus.get(l.currentStatus ?? "(null)") ?? 0) + 1);
    byOrigin.set(l.leadOrigin ?? "(null)", (byOrigin.get(l.leadOrigin ?? "(null)") ?? 0) + 1);

    // Full history for this lead's currentStatus + followupDate fields.
    const hist = await prisma.leadFieldHistory.findMany({
      where: { leadId: l.id, field: { in: ["currentStatus", "followupDate"] } },
      select: { field: true, oldValue: true, newValue: true, source: true, changedAt: true },
      orderBy: { changedAt: "asc" },
    });

    // The transition that PUT this lead into its current terminal status: the last
    // currentStatus history row whose newValue is the current (terminal) status.
    const statusRows = hist.filter((h) => h.field === "currentStatus");
    const terminalTransition = [...statusRows].reverse().find((h) => h.newValue === l.currentStatus);
    // followupDate history — when/how the surviving follow-up was last set.
    const fuRows = hist.filter((h) => h.field === "followupDate");
    const lastFu = fuRows[fuRows.length - 1];

    let culprit: string;
    if (!terminalTransition) {
      culprit = statusRows.length === 0
        ? "CREATED-terminal (no status history → importer / ingest)"
        : `status-history-but-no-match (last source: ${statusRows[statusRows.length - 1]?.source ?? "?"})`;
    } else {
      culprit = `status→terminal via source="${terminalTransition.source ?? "(null)"}"`;
    }
    byCulprit.set(culprit, (byCulprit.get(culprit) ?? 0) + 1);

    console.log("─".repeat(80));
    console.log(`• ${l.name ?? "(no name)"}  [${l.id}]`);
    console.log(`    currentStatus : ${l.currentStatus}   (isTerminal=${isTerminalStatus(l.currentStatus)})`);
    console.log(`    leadOrigin    : ${l.leadOrigin}   forwardedTeam: ${l.forwardedTeam ?? "—"}   owner: ${l.ownerId ? "assigned" : "—"}`);
    console.log(`    createdAt     : ${istStr(l.createdAt)}   importBatch: ${l.importBatchId ?? "—"}`);
    console.log(`    followupDate  : ${istStr(l.followupDate)}   reminderSentAt: ${istStr(l.followupReminderSentAt)}`);
    console.log(`    rejectedAt    : ${istStr(l.rejectedAt)}   rejectionReason: ${l.rejectionReason ?? "—"}`);
    console.log(`    ▶ CULPRIT     : ${culprit}`);
    if (terminalTransition) {
      console.log(`        status→"${terminalTransition.newValue}" (from "${terminalTransition.oldValue ?? "null"}") · source="${terminalTransition.source}" · ${istStr(terminalTransition.changedAt)}`);
    }
    if (lastFu) {
      console.log(`        last followupDate write: "${lastFu.oldValue ?? "null"}"→"${lastFu.newValue ?? "null"}" · source="${lastFu.source}" · ${istStr(lastFu.changedAt)}`);
    } else {
      console.log(`        followupDate: NO history row (set at import/create or never audited)`);
    }
  }

  console.log("\n" + "═".repeat(80));
  console.log("SUMMARY");
  console.log("\nBy current (terminal) status:");
  for (const [s, n] of [...byStatus.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${s.padEnd(34)} ${n}`);
  console.log("\nBy leadOrigin:");
  for (const [s, n] of [...byOrigin.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${s.padEnd(34)} ${n}`);
  console.log("\nBy ROOT-CAUSE path (how it became terminal):");
  for (const [s, n] of [...byCulprit.entries()].sort((a, b) => b[1] - a[1])) console.log(`   ${String(n).padStart(3)}  ${s}`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
