// ONE-TIME guarded hard-delete of the mistaken cold-data batch (user-approved
// exception). Deletes ONLY the soft-deleted leads of this exact batch + the
// batch row. Aborts immediately if ANY guard fails. Nothing else is touched.
import { prisma } from "../src/lib/prisma";

const BATCH_ID = "cmqdhizp10001lb04fd3mni3t";
const TANUJ_ID = "cmpidrs1n0005vphgg1tj84pj";
const EXPECT_FILE = "Silverglades";
const CONFIRM = true; // user gave explicit one-time approval for THIS batch only

function assert(cond: boolean, msg: string) { if (!cond) { throw new Error(`GUARD FAILED → ${msg}`); } }

async function main() {
  const batch = await prisma.importBatch.findUnique({ where: { id: BATCH_ID } });
  assert(!!batch, `batch ${BATCH_ID} not found`);
  assert(batch!.fileName.includes(EXPECT_FILE), `fileName "${batch!.fileName}" does not contain "${EXPECT_FILE}"`);
  assert(batch!.importType === "COLD", `importType is "${batch!.importType}", expected COLD`);
  assert(batch!.status === "DELETED", `status is "${batch!.status}", expected DELETED (must be trashed first)`);

  const total   = await prisma.lead.count({ where: { importBatchId: BATCH_ID } });
  const live    = await prisma.lead.count({ where: { importBatchId: BATCH_ID, deletedAt: null } });
  const softDel = await prisma.lead.count({ where: { importBatchId: BATCH_ID, deletedAt: { not: null } } });
  const notTanuj= await prisma.lead.count({ where: { importBatchId: BATCH_ID, ownerId: { not: TANUJ_ID } } });
  const notCold = await prisma.lead.count({ where: { importBatchId: BATCH_ID, isColdCall: false, leadOrigin: { not: "COLD" } } });

  // Hard guards — refuse to proceed unless the target is exactly the cold batch.
  assert(live === 0, `${live} leads in this batch are LIVE — refuse to hard-delete live leads`);
  assert(notTanuj === 0, `${notTanuj} leads in this batch are NOT owned by Tanuj`);
  assert(notCold === 0, `${notCold} leads in this batch are NOT cold`);
  assert(total === softDel, `total(${total}) != soft-deleted(${softDel})`);

  // Blast radius — child rows that will cascade-delete with these leads.
  const ids = (await prisma.lead.findMany({ where: { importBatchId: BATCH_ID }, select: { id: true } })).map(l => l.id);
  const [acts, calls, notes, wa, assigns, props, projs] = await Promise.all([
    prisma.activity.count({ where: { leadId: { in: ids } } }),
    prisma.callLog.count({ where: { leadId: { in: ids } } }),
    prisma.note.count({ where: { leadId: { in: ids } } }),
    prisma.whatsAppMessage.count({ where: { leadId: { in: ids } } }),
    prisma.assignment.count({ where: { leadId: { in: ids } } }),
    prisma.leadProperty.count({ where: { leadId: { in: ids } } }),
    prisma.leadProject.count({ where: { leadId: { in: ids } } }),
  ]);

  // Baseline that MUST stay unchanged (already at post-delete values since soft-deleted).
  const tLiveBefore   = await prisma.lead.count({ where: { ownerId: TANUJ_ID, deletedAt: null } });
  const tActiveBefore = await prisma.lead.count({ where: { ownerId: TANUJ_ID, deletedAt: null, isColdCall: false, leadOrigin: { not: "COLD" } } });
  const sysLiveBefore = await prisma.lead.count({ where: { deletedAt: null } });

  console.log(`TARGET   batch=${BATCH_ID}  file="${batch!.fileName}"  type=${batch!.importType}  status=${batch!.status}`);
  console.log(`LEADS    total=${total}  live=${live}  softDeleted=${softDel}  notTanuj=${notTanuj}  notCold=${notCold}`);
  console.log(`CASCADE  activities=${acts} callLogs=${calls} notes=${notes} whatsapp=${wa} assignments=${assigns} leadProps=${props} leadProjects=${projs}`);
  console.log(`BASELINE Tanuj live=${tLiveBefore}  Tanuj active(non-cold)=${tActiveBefore}  system live=${sysLiveBefore}`);

  if (!CONFIRM) { console.log("\nCONFIRM=false → dry run only, nothing deleted."); return; }

  console.log(`\nExecuting guarded purge…`);
  const purged = await prisma.lead.deleteMany({ where: { importBatchId: BATCH_ID, deletedAt: { not: null } } });
  await prisma.importBatch.delete({ where: { id: BATCH_ID } });
  await prisma.auditLog.create({
    data: {
      userId: null, // system action (one-time approved exception); detail in meta
      action: "import.purge.manual",
      entity: "ImportBatch",
      entityId: BATCH_ID,
      meta: JSON.stringify({
        fileName: batch!.fileName, leadsPurged: purged.count,
        reason: "One-time user-approved hard delete of mistaken Silverglades cold import under Tanuj",
        cascade: { acts, calls, notes, wa, assigns, props, projs },
      }),
    },
  }).catch((e) => console.log("(audit write skipped:", String(e).slice(0, 80), ")"));

  // After — prove the leads/batch are gone and nothing active changed.
  const remain        = await prisma.lead.count({ where: { importBatchId: BATCH_ID } });
  const batchGone     = await prisma.importBatch.findUnique({ where: { id: BATCH_ID } });
  const tLiveAfter    = await prisma.lead.count({ where: { ownerId: TANUJ_ID, deletedAt: null } });
  const tActiveAfter  = await prisma.lead.count({ where: { ownerId: TANUJ_ID, deletedAt: null, isColdCall: false, leadOrigin: { not: "COLD" } } });
  const sysLiveAfter  = await prisma.lead.count({ where: { deletedAt: null } });

  console.log(`\nRESULT   leadsPurged=${purged.count}  batchRowGone=${!batchGone}  leadsRemainingForBatch=${remain}`);
  console.log(`VERIFY   Tanuj live ${tLiveBefore}→${tLiveAfter}  Tanuj active ${tActiveBefore}→${tActiveAfter}  system live ${sysLiveBefore}→${sysLiveAfter}`);
  console.log(`         ${tLiveAfter === tLiveBefore && tActiveAfter === tActiveBefore && sysLiveAfter === sysLiveBefore ? "✅ all active counts UNCHANGED" : "❌ an active count moved — investigate"}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
