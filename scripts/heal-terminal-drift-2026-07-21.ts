import { prisma } from "../src/lib/prisma";
import { writeFileSync, mkdirSync } from "node:fs";
import { terminalStatusSideEffects, isLostStatus } from "../src/lib/lostRejected";
import { TERMINAL_STATUSES, LOST_STATUSES } from "../src/lib/lead-statuses";

// One-off heal for the 2 leads that drifted via the now-fixed RC-1/RC-2 gaps.
// Applies the SHIPPED lost rule (terminalStatusSideEffects) — unassign + preserve
// Previous Owner + clear follow-up — to LOST leads that were re-owned/re-scheduled.
// Backup + before/after + reversal file. LEADS ONLY (buyers intentionally excluded).
const APPLY = process.argv.includes("--apply");

(async () => {
  // The exact drifted population (re-scanned at run time, not from an earlier read).
  const drifted = await prisma.lead.findMany({
    where: {
      deletedAt: null,
      OR: [
        { currentStatus: { in: [...LOST_STATUSES] }, ownerId: { not: null } },        // RC-2
        { currentStatus: { in: [...TERMINAL_STATUSES] }, followupDate: { not: null } }, // RC-1
      ],
    },
    select: {
      id: true, name: true, currentStatus: true, ownerId: true, previousOwnerId: true,
      assignedAt: true, followupDate: true, followupReminderSentAt: true,
      owner: { select: { name: true } },
    },
  });

  console.log(`drifted leads: ${drifted.length}`);
  const plan = drifted.map((l) => {
    // Lost → unassign + stash previous owner + clear follow-up. Closed/Won (terminal
    // but not lost, e.g. only a stray follow-up) → keep owner, clear follow-up only.
    const fx = terminalStatusSideEffects(l.currentStatus, { ownerId: l.ownerId, previousOwnerId: l.previousOwnerId });
    return { lead: l, after: fx, kind: isLostStatus(l.currentStatus) ? "LOST→unassign+clearFU" : "CLOSED→clearFU" };
  });
  for (const p of plan) {
    console.log(`  ${p.lead.name} · ${p.lead.currentStatus} · owner=${p.lead.owner?.name ?? "—"} · fu=${p.lead.followupDate?.toISOString().slice(0,16) ?? "—"}  →  ${p.kind}  ${JSON.stringify(p.after)}`);
  }

  // Snapshot BEFORE (full reversal source) + a ready-to-run reversal.
  const stamp = "2026-07-21T-heal";
  mkdirSync("backups/terminal-drift-heal", { recursive: true });
  const before = drifted.map((l) => ({
    id: l.id, name: l.name, currentStatus: l.currentStatus, ownerId: l.ownerId,
    previousOwnerId: l.previousOwnerId, assignedAt: l.assignedAt, followupDate: l.followupDate,
    followupReminderSentAt: l.followupReminderSentAt,
  }));
  writeFileSync(`backups/terminal-drift-heal/before-${stamp}.json`, JSON.stringify(before, null, 2));
  // Reversal: restore each row's exact prior ownership/follow-up.
  const reversal = before.map((b) =>
    `UPDATE "Lead" SET "ownerId"=${b.ownerId ? `'${b.ownerId}'` : "NULL"}, "assignedAt"=${b.assignedAt ? `'${b.assignedAt.toISOString()}'` : "NULL"}, "previousOwnerId"=${b.previousOwnerId ? `'${b.previousOwnerId}'` : "NULL"}, "followupDate"=${b.followupDate ? `'${b.followupDate.toISOString()}'` : "NULL"}, "followupReminderSentAt"=${b.followupReminderSentAt ? `'${b.followupReminderSentAt.toISOString()}'` : "NULL"} WHERE id='${b.id}';`
  ).join("\n");
  writeFileSync(`backups/terminal-drift-heal/REVERSAL-${stamp}.sql`, reversal + "\n");
  console.log(`\nsnapshot + reversal written to backups/terminal-drift-heal/`);

  if (!APPLY) { console.log("\nDRY RUN — re-run with --apply to write."); await prisma.$disconnect(); return; }

  let healed = 0;
  for (const p of plan) {
    await prisma.$transaction([
      prisma.lead.update({ where: { id: p.lead.id }, data: p.after }),
      ...Object.entries(p.after).filter(([, v]) => v !== undefined).map(([field, v]) =>
        prisma.leadFieldHistory.create({ data: {
          leadId: p.lead.id, field, oldValue: String((p.lead as Record<string, unknown>)[field] ?? ""),
          newValue: v === null ? "" : String(v), changedById: null, source: "terminal-drift-heal-2026-07-21",
        }})),
    ]);
    healed++;
  }
  console.log(`\nHEALED ${healed} leads.`);

  // Verify zero remain.
  const remainLost = await prisma.lead.count({ where: { deletedAt: null, currentStatus: { in: [...LOST_STATUSES] }, ownerId: { not: null } } });
  const remainFu = await prisma.lead.count({ where: { deletedAt: null, currentStatus: { in: [...TERMINAL_STATUSES] }, followupDate: { not: null } } });
  console.log(`post-heal: LOST+owned=${remainLost} · terminal+followup=${remainFu}  ${remainLost===0 && remainFu===0 ? "✅ CLEAN" : "❌ STILL DRIFTED"}`);
  await prisma.$disconnect();
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
