import { prisma } from "../src/lib/prisma";
import { writeFileSync, mkdirSync } from "node:fs";

// ════════════════════════════════════════════════════════════════════════════
// P0 CORRECTION — restore the leads a faulty team-tag round-robin took from Adil.
//
// CONTEXT: /api/admin/awaiting-team/assign ran round-robin unconditionally on a
// team tag, moving already-owned, actively-worked leads. India always resolves to
// a hardcoded Tanuj constant, so 22 of Adil Khan's India leads went to Tanuj.
// The code guard shipped in ecd5de8 (an eligible existing owner is now preserved),
// so a restored lead can no longer be bounced back by a re-tag.
//
// SCOPE: ONLY leads that are (a) still owned by the wrongly-assigned agent, and
// (b) have NO later legitimate manual assignment. Every precondition is RE-VERIFIED
// at run time — a lead that moved since the audit is skipped, not forced.
//
// HISTORY IS PRESERVED: Tanuj's Assignment rows are NEVER deleted. A new Assignment
// row records the correction. followupDate / call logs / notes / activities are all
// left untouched. Reversible via backup + REVERSAL sql + OperationLog.
// ════════════════════════════════════════════════════════════════════════════
const APPLY = process.argv.includes("--apply");
const STAMP = "2026-07-23";
const ADIL = "cmrn8wcre0000vpt07z8vgbq0";
const TANUJ = "cmpidrs1n0005vphgg1tj84pj";
const ACTOR = "cmplo0t6v0000vpxslasvbwuq"; // Lalit (admin authorising the correction)
const CORRECTION_REASON = "system correction — restored to prior owner after faulty team-tag round-robin (P0 2026-07-23)";

const TARGETS = [
  "cmrt9bkki008rj60ahrkhj2zo", // Kumail khan
  "cmrt9blap00alj60apzcmtyxk", // Pralhad Wagh
  "cmrt9bky1009lj60aju0e4fh8", // Udayan Patel
  "cmrt9bhpr0022j60a7h0e5i15", // M k jain
  "cmrt9bh8t0012j60a0pv8siv9", // Himanshu
  "cmrt9bjra006rj60aofm1f13m", // Rajesh Kumar Upadhyay
  "cmrt9bk76007rj60a9241fihk", // Chanchal
  "cmrt9bkbv0083j60a2e5jbbvi", // Vishu Kaushal
  "cmrt9bizn004rj60aohv703u8", // Kajl Kohli
];

(async () => {
  const leads = await prisma.lead.findMany({
    where: { id: { in: TARGETS } },
    select: { id: true, name: true, ownerId: true, assignedAt: true, forwardedTeam: true,
              deletedAt: true, followupDate: true, currentStatus: true,
              _count: { select: { callLogs: true, activities: true, notes: true } } },
  });

  const ok: typeof leads = [];
  const skipped: { id: string; name: string | null; why: string }[] = [];
  for (const l of leads) {
    if (l.deletedAt) { skipped.push({ id: l.id, name: l.name, why: "lead deleted" }); continue; }
    if (l.ownerId !== TANUJ) { skipped.push({ id: l.id, name: l.name, why: `owner changed since audit (now ${l.ownerId ?? "unassigned"})` }); continue; }
    // Re-verify: no legitimate manual assignment after the faulty team-tag move.
    const bad = await prisma.assignment.findFirst({
      where: { leadId: l.id, reason: { contains: "team tagging", mode: "insensitive" } },
      orderBy: { assignedAt: "desc" }, select: { assignedAt: true },
    });
    if (!bad) { skipped.push({ id: l.id, name: l.name, why: "no team-tag assignment found" }); continue; }
    const laterManual = await prisma.assignment.count({
      where: {
        leadId: l.id,
        assignedAt: { gt: bad.assignedAt },
        // Anything that is NOT another team-tag routing row counts as a human decision
        // we must respect. A null reason also lands here — conservative on purpose.
        NOT: { reason: { contains: "team tagging", mode: "insensitive" } },
      },
    });
    if (laterManual > 0) { skipped.push({ id: l.id, name: l.name, why: `${laterManual} later manual assignment(s) — respect the human decision` }); continue; }
    ok.push(l);
  }

  console.log(`RESTORE CANDIDATES verified: ${ok.length} / ${TARGETS.length}`);
  for (const l of ok) console.log(`   ${l.id} "${l.name}" | Tanuj -> Adil | followup=${l.followupDate?.toISOString() ?? "none"} calls=${l._count.callLogs} acts=${l._count.activities}`);
  if (skipped.length) { console.log(`\nSKIPPED (${skipped.length}):`); for (const s of skipped) console.log(`   ${s.id} "${s.name}": ${s.why}`); }
  if (!ok.length) { console.log("\nNothing to restore."); await prisma.$disconnect(); return; }

  mkdirSync("backups/p0-teamtag-restore", { recursive: true });
  writeFileSync(`backups/p0-teamtag-restore/before-${STAMP}.json`,
    JSON.stringify(ok.map(l => ({ id: l.id, name: l.name, ownerId: l.ownerId, assignedAt: l.assignedAt })), null, 2));
  writeFileSync(`backups/p0-teamtag-restore/REVERSAL-${STAMP}.sql`,
    [`-- Reverse the P0 team-tag ownership correction ${STAMP} (back to Tanuj)`,
     ...ok.map(l => `UPDATE "Lead" SET "ownerId"='${TANUJ}', "assignedAt"=${l.assignedAt ? `'${l.assignedAt.toISOString()}'` : "NULL"} WHERE id='${l.id}';`)].join("\n") + "\n");
  console.log(`\nsnapshot + reversal -> backups/p0-teamtag-restore/`);

  if (!APPLY) { console.log("\nDRY RUN — re-run with --apply."); await prisma.$disconnect(); return; }

  const now = new Date();
  let done = 0;
  for (const l of ok) {
    // Direct update on purpose: assignLeadTo() would reset the owner-specific
    // attempt/ghosting counters again and fire a "new lead" notification. This is a
    // correction, not a fresh assignment — ownership moves, working history does not.
    await prisma.lead.update({ where: { id: l.id }, data: { ownerId: ADIL, assignedAt: now } });
    // Tanuj's rows are LEFT INTACT; this row records the correction in the trail.
    await prisma.assignment.create({ data: { leadId: l.id, userId: ADIL, reason: CORRECTION_REASON } });
    done++;
  }
  console.log(`RESTORED ${done} leads to Adil Khan (follow-ups, calls, notes, activities untouched).`);

  await prisma.operationLog.create({ data: {
    operation: "lead.transfer", entityType: "Lead", module: "Routing", field: "ownerId",
    summary: `P0 correction — ${done} lead(s) restored to Adil Khan after faulty team-tag round-robin`,
    status: "EXECUTED", affectedCount: done, affectedIds: ok.map(l => l.id),
    beforeState: ok.map(l => ({ id: l.id, ownerId: l.ownerId, assignedAt: l.assignedAt })),
    afterState: { ownerId: ADIL, reason: CORRECTION_REASON }, createdById: ACTOR,
  } }).catch(e => console.error("OperationLog failed:", e.message));
  try {
    const { audit } = await import("../src/lib/audit");
    await audit({ userId: ACTOR, action: "lead.owner.correction", entity: "Lead", entityId: "batch",
      meta: { restored: done, from: TANUJ, to: ADIL, cause: "faulty team-tag round-robin (P0 2026-07-23)", leadIds: ok.map(l => l.id) } });
  } catch (e) { console.error("audit failed:", (e as Error).message); }

  const after = await prisma.lead.findMany({ where: { id: { in: ok.map(l => l.id) } }, select: { id: true, ownerId: true, followupDate: true } });
  const wrong = after.filter(a => a.ownerId !== ADIL);
  const lostFollowup = after.filter(a => !a.followupDate);
  console.log(`\nVERIFY: owned-by-Adil=${after.length - wrong.length}/${after.length} · follow-ups intact=${after.length - lostFollowup.length}/${after.length}`);
  console.log(wrong.length === 0 ? "✅ RESTORATION COMPLETE" : "❌ CHECK ABOVE");
  await prisma.$disconnect();
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
