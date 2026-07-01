// ────────────────────────────────────────────────────────────────────────────
// scripts/actor-owner-analysis.ts — READ-ONLY historical analysis
//
//   npx tsx scripts/actor-owner-analysis.ts
//
// Sizes the "Activity Actor vs Lead Owner" data-integrity problem BEFORE any
// reconciliation. Produces the deliverables Lalit requested: total affected,
// module breakdown, oldest/newest, auto-fixable vs manual-review split, and a
// 10-row before/after sample.
//
// HARD CONSTRAINT: READ-ONLY. Zero writes — only counts / findMany(select) /
// read-only $queryRaw SELECTs. Safe to run against production Neon any number
// of times. NO create/update/delete, NO $executeRaw.
// ────────────────────────────────────────────────────────────────────────────
import { prisma } from "../src/lib/prisma";

function line() { console.log("─".repeat(72)); }

async function main() {
  console.log("\n╔══ ACTOR-vs-OWNER HISTORICAL ANALYSIS (READ-ONLY) ══╗\n");

  // ── A. Confirmed write-path bug rows (owner wrongly stored as actor) ────────
  // These three Activity kinds were created by SYSTEM/import code that stamped
  // userId = lead.ownerId. They are identifiable by their title prefix.
  line();
  console.log("A. WRITE-PATH BUG ROWS (Activity.userId currently = a real user, but should not be the owner)\n");

  const dupIntake = await prisma.activity.count({
    where: { title: { startsWith: "Duplicate intake from" }, userId: { not: null } },
  });
  const workflowTask = await prisma.activity.count({
    where: { title: { startsWith: "🤖 " }, userId: { not: null } },
  });
  const revivalImport = await prisma.activity.count({
    where: { title: { startsWith: "Revival import — re-engaged from" }, userId: { not: null } },
  });

  console.log(`  Duplicate-intake notes   (auto-fixable → System/null): ${dupIntake}`);
  console.log(`  Workflow auto-tasks '🤖' (auto-fixable → System/null): ${workflowTask}`);
  console.log(`  Revival-import notes     (needs importer id; manual): ${revivalImport}`);

  // Date span of the auto-fixable set
  for (const [label, where] of [
    ["duplicate-intake", { title: { startsWith: "Duplicate intake from" }, userId: { not: null } }],
    ["workflow-task", { title: { startsWith: "🤖 " }, userId: { not: null } }],
    ["revival-import", { title: { startsWith: "Revival import — re-engaged from" }, userId: { not: null } }],
  ] as const) {
    const oldest = await prisma.activity.findFirst({ where: where as any, orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    const newest = await prisma.activity.findFirst({ where: where as any, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    console.log(`    ${label}: oldest=${oldest?.createdAt?.toISOString() ?? "—"}  newest=${newest?.createdAt?.toISOString() ?? "—"}`);
  }

  // How many of the bug rows actually have userId == the lead's CURRENT owner
  // (confirms the owner-stamp; some owners may have changed since).
  const dupRows = await prisma.activity.findMany({
    where: { title: { startsWith: "Duplicate intake from" }, userId: { not: null } },
    select: { userId: true, lead: { select: { ownerId: true } } },
  });
  const dupStillOwner = dupRows.filter(r => r.userId && r.userId === r.lead?.ownerId).length;
  console.log(`\n  Of ${dupRows.length} duplicate-intake rows, userId still == current owner: ${dupStillOwner}`);
  console.log(`  (the rest had userId==owner-at-creation but ownership has since changed — same root cause)`);

  // ── B. Acefone owner-fallback calls (cannot identify with certainty) ────────
  line();
  console.log("B. ACEFONE INBOUND owner-fallback CallLogs (heuristic upper bound — NOT certain)\n");
  const inbound = await prisma.callLog.findMany({
    where: { direction: "INBOUND" },
    select: { id: true, userId: true, attributedAgentName: true, lead: { select: { ownerId: true } } },
  });
  const inboundOwnerStamped = inbound.filter(c => c.userId && c.lead?.ownerId && c.userId === c.lead.ownerId).length;
  console.log(`  Inbound CallLogs total: ${inbound.length}`);
  console.log(`  ...where userId == current lead owner (possible owner-fallback): ${inboundOwnerStamped}`);
  console.log(`  → CANNOT distinguish "owner genuinely took the call" from "owner-fallback". Per rule: leave unchanged, no guess.`);

  // ── C. Rendering-only mis-display (data is correctly null; UI paints owner) ─
  line();
  console.log("C. RENDERING-ONLY mis-display (userId IS NULL → UI currently shows owner). Fixed by Phase A UI, NO data change.\n");
  const nullActivities = await prisma.activity.count({ where: { userId: null, type: { not: "STATUS_CHANGE" } } });
  const nullStatusChange = await prisma.activity.count({ where: { userId: null, type: "STATUS_CHANGE" } });
  const nullNotes = await prisma.note.count({ where: { userId: null } });
  const outboundWA = await prisma.whatsAppMessage.count({ where: { direction: "OUTBOUND" } });
  console.log(`  Activities userId=NULL, non-status (shows owner today): ${nullActivities}`);
  console.log(`  Activities userId=NULL, STATUS_CHANGE (already 'System'): ${nullStatusChange}`);
  console.log(`  Notes userId=NULL (shows owner today):                   ${nullNotes}`);
  console.log(`  OUTBOUND WhatsApp (all show owner; no actor column):     ${outboundWA}`);

  // ── D. Baseline totals ──────────────────────────────────────────────────────
  line();
  console.log("D. BASELINE TOTALS\n");
  const totalAct = await prisma.activity.count();
  const totalNotes = await prisma.note.count();
  const totalCalls = await prisma.callLog.count();
  const totalWA = await prisma.whatsAppMessage.count();
  console.log(`  Activity: ${totalAct}   Note: ${totalNotes}   CallLog: ${totalCalls}   WhatsAppMessage: ${totalWA}`);

  // ── E. Before/after sample (10 auto-fixable rows) ───────────────────────────
  line();
  console.log("E. BEFORE/AFTER SAMPLE — 10 auto-fixable rows (dup-intake + workflow-task)\n");
  const sample = await prisma.activity.findMany({
    where: {
      userId: { not: null },
      OR: [
        { title: { startsWith: "Duplicate intake from" } },
        { title: { startsWith: "🤖 " } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, title: true, createdAt: true, user: { select: { name: true } } },
  });
  for (const s of sample) {
    console.log(`  ${s.id} | "${s.title.slice(0, 40)}" | ${s.createdAt.toISOString().slice(0, 10)}`);
    console.log(`     BEFORE actor: ${s.user?.name ?? "—"}   →   AFTER actor: System (userId=null)`);
  }

  line();
  console.log("\nDONE (read-only — nothing was modified).\n");
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
