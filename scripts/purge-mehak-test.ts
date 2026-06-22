// ONE-TIME guarded HARD DELETE of the Mehak MIS-3 test import (user-approved:
// "entire Mehak MIS import was test data only"). Removes the 82 leads + EVERY
// child/loose-reference row (incl. AI indexes) + the batch, in a transaction.
// Aborts unless the scope is EXACTLY Mehak's batch. Touches no other user's data.
import { prisma } from "../src/lib/prisma";
import { SUPPRESSED_STATUSES } from "../src/lib/lead-statuses";

const BATCH_ID = "cmqalfzd90008l104oebiwjb6";
const MEHAK_ID = "cmpidrrjp0002vphgqb432xq7";
const EXPECT_FILE = "Mehak MIS-3";
const CONFIRM = true; // user confirmed "Execute now" — delete Mehak's 82, preserve Lalit's Ashwath

function assert(c: boolean, m: string) { if (!c) throw new Error(`GUARD FAILED → ${m}`); }
const activeWhere = (id: string) => ({ ownerId: id, deletedAt: null, leadOrigin: { notIn: ["COLD", "REVIVAL"] }, currentStatus: { notIn: SUPPRESSED_STATUSES } });

async function main() {
  const batch = await prisma.importBatch.findUnique({ where: { id: BATCH_ID } });
  assert(!!batch, `batch ${BATCH_ID} not found`);
  assert(batch!.fileName.includes(EXPECT_FILE), `fileName "${batch!.fileName}" != "${EXPECT_FILE}"`);

  // Scope guards — the batch's leads must be EXACTLY Mehak's, and Mehak must own
  // nothing outside this batch (so "complete Mehak dataset" == this batch).
  const batchTotal      = await prisma.lead.count({ where: { importBatchId: BATCH_ID } });
  const batchNotMehak   = await prisma.lead.count({ where: { importBatchId: BATCH_ID, ownerId: { not: MEHAK_ID } } });
  const mehakTotal      = await prisma.lead.count({ where: { ownerId: MEHAK_ID } });
  const mehakNotInBatch = await prisma.lead.count({ where: { ownerId: MEHAK_ID, importBatchId: { not: BATCH_ID } } });
  assert(mehakNotInBatch === 0, `Mehak owns ${mehakNotInBatch} leads OUTSIDE this batch — refuse (need explicit scope)`);

  // The batch may contain leads reassigned to OTHER users — never delete those.
  // Show them so the user can decide separately; the purge scopes to Mehak only.
  if (batchNotMehak > 0) {
    const others = await prisma.lead.findMany({ where: { importBatchId: BATCH_ID, ownerId: { not: MEHAK_ID } }, select: { id: true, name: true, phone: true, ownerId: true, currentStatus: true, source: true, deletedAt: true } });
    const owners = await prisma.user.findMany({ where: { id: { in: others.map(o => o.ownerId!).filter(Boolean) } }, select: { id: true, name: true } });
    const onm = Object.fromEntries(owners.map(o => [o.id, o.name]));
    console.log(`⚠ ${batchNotMehak} batch lead(s) NOT owned by Mehak — these will be PRESERVED:`);
    for (const o of others) console.log(`    "${o.name}"  owner=${o.ownerId ? (onm[o.ownerId] ?? o.ownerId) : "UNASSIGNED"}  status=${o.currentStatus ?? "—"}  src=${o.source}  ${o.deletedAt ? "DELETED" : "live"}`);
  }

  const ids = (await prisma.lead.findMany({ where: { importBatchId: BATCH_ID, ownerId: MEHAK_ID }, select: { id: true } })).map(l => l.id);

  // Blast radius across EVERY table that references a lead.
  const w = { leadId: { in: ids } };
  const radius: Record<string, number> = {
    activity:            await prisma.activity.count({ where: w }),
    callLog:             await prisma.callLog.count({ where: w }),
    note:                await prisma.note.count({ where: w }),
    whatsAppMessage:     await prisma.whatsAppMessage.count({ where: w }),
    assignment:          await prisma.assignment.count({ where: w }),
    leadProperty:        await prisma.leadProperty.count({ where: w }),
    leadProject:         await prisma.leadProject.count({ where: w }),
    leadInterestNote:    await prisma.leadInterestNote.count({ where: w }),
    stickyNote:          await prisma.stickyNote.count({ where: w }),
    remarkVisibility:    await prisma.remarkVisibility.count({ where: w }),
    remarkAuditLog:      await prisma.remarkAuditLog.count({ where: w }),
    unmatchedMention:    await prisma.unmatchedMention.count({ where: w }),
    workflowRun:         await prisma.workflowRun.count({ where: w }),
    notification:        await prisma.notification.count({ where: w }),
    aiAnalysis:          await prisma.aiAnalysis.count({ where: w }),
    aiSuggestionFeedback:await prisma.aiSuggestionFeedback.count({ where: w }),
    aiExtraction:        await prisma.aiExtraction.count({ where: w }),
    aiUsageLog:          await prisma.aiUsageLog.count({ where: w }),
    aiTrialItem:         await prisma.aiTrialItem.count({ where: w }),
    intelligenceMatch:   await prisma.intelligenceMatch.count({ where: w }),
  };

  const beforeMehakLive = await prisma.lead.count({ where: { ownerId: MEHAK_ID, deletedAt: null } });
  const beforeSysLive   = await prisma.lead.count({ where: { deletedAt: null } });
  const beforeSysTotal  = await prisma.lead.count();

  console.log(`TARGET   batch=${BATCH_ID} "${batch!.fileName}"  leads=${ids.length}  (all Mehak, none outside)`);
  console.log(`BLAST    ${Object.entries(radius).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  console.log(`BEFORE   Mehak live=${beforeMehakLive}  system live=${beforeSysLive}  system total=${beforeSysTotal}`);
  if (!CONFIRM) { console.log("\nCONFIRM=false → dry run, nothing deleted."); return; }

  console.log(`\nExecuting transaction…`);
  const deleted: Record<string, number> = {};
  await prisma.$transaction(async (tx) => {
    deleted.activity            = (await tx.activity.deleteMany({ where: w })).count;
    deleted.callLog             = (await tx.callLog.deleteMany({ where: w })).count;
    deleted.note                = (await tx.note.deleteMany({ where: w })).count;
    deleted.whatsAppMessage     = (await tx.whatsAppMessage.deleteMany({ where: w })).count;
    deleted.assignment          = (await tx.assignment.deleteMany({ where: w })).count;
    deleted.leadProperty        = (await tx.leadProperty.deleteMany({ where: w })).count;
    deleted.leadProject         = (await tx.leadProject.deleteMany({ where: w })).count;
    deleted.leadInterestNote    = (await tx.leadInterestNote.deleteMany({ where: w })).count;
    deleted.stickyNote          = (await tx.stickyNote.deleteMany({ where: w })).count;
    deleted.remarkVisibility    = (await tx.remarkVisibility.deleteMany({ where: w })).count;
    deleted.remarkAuditLog      = (await tx.remarkAuditLog.deleteMany({ where: w })).count;
    deleted.unmatchedMention    = (await tx.unmatchedMention.deleteMany({ where: w })).count;
    deleted.workflowRun         = (await tx.workflowRun.deleteMany({ where: w })).count;
    deleted.notification        = (await tx.notification.deleteMany({ where: w })).count;
    deleted.aiAnalysis          = (await tx.aiAnalysis.deleteMany({ where: w })).count;
    deleted.aiSuggestionFeedback= (await tx.aiSuggestionFeedback.deleteMany({ where: w })).count;
    deleted.aiExtraction        = (await tx.aiExtraction.deleteMany({ where: w })).count;
    deleted.aiUsageLog          = (await tx.aiUsageLog.deleteMany({ where: w })).count;
    deleted.aiTrialItem         = (await tx.aiTrialItem.deleteMany({ where: w })).count;
    deleted.intelligenceMatch   = (await tx.intelligenceMatch.deleteMany({ where: w })).count;
    deleted.lead                = (await tx.lead.deleteMany({ where: { importBatchId: BATCH_ID, ownerId: MEHAK_ID } })).count;
    // Only remove the batch row if NO leads remain (a reassigned non-Mehak lead keeps it).
    const remaining = await tx.lead.count({ where: { importBatchId: BATCH_ID } });
    if (remaining === 0) await tx.importBatch.delete({ where: { id: BATCH_ID } });
    else console.log(`  (batch row kept — ${remaining} non-Mehak lead(s) still reference it)`);
    await tx.auditLog.create({ data: { userId: null, action: "admin.purge.mehak-test", entity: "ImportBatch", entityId: BATCH_ID,
      meta: JSON.stringify({ fileName: batch!.fileName, leadsPurged: deleted.lead, children: deleted, reason: "One-time approved hard delete — Mehak MIS-3 test import" }) } });
  });

  const afterMehakTotal = await prisma.lead.count({ where: { ownerId: MEHAK_ID } });
  const afterSysLive    = await prisma.lead.count({ where: { deletedAt: null } });
  const afterSysTotal   = await prisma.lead.count();
  const batchGone       = !(await prisma.importBatch.findUnique({ where: { id: BATCH_ID } }));

  console.log(`\nDELETED  ${Object.entries(deleted).map(([k, v]) => `${k}=${v}`).join("  ")}  batchRowGone=${batchGone}`);
  console.log(`AFTER    Mehak total=${afterMehakTotal} (live ${beforeMehakLive}→0)  system live=${beforeSysLive}→${afterSysLive}  system total=${beforeSysTotal}→${afterSysTotal}`);

  console.log(`\n=== RECONCILIATION (active counts) ===`);
  for (const nm of ["Lalit", "Tanuj", "Mehak"]) {
    const u = await prisma.user.findFirst({ where: { name: { contains: nm, mode: "insensitive" } }, select: { id: true, name: true } });
    if (!u) continue;
    const active = await prisma.lead.count({ where: activeWhere(u.id) });
    const total  = await prisma.lead.count({ where: { ownerId: u.id, deletedAt: null, leadOrigin: { notIn: ["COLD", "REVIVAL"] } } });
    console.log(`  ${u.name.padEnd(14)} total=${total}  active=${active}`);
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
