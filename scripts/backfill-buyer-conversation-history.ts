// ─────────────────────────────────────────────────────────────────────────────
// backfill-buyer-conversation-history.ts  (Lalit P0, 2026-06-27)
//
// The Dubai buyer sheets carry a "Conversation History" column = the REAL dated
// conversation. During import the admin mapped a short Status column to Remarks
// and left "Conversation History" unmapped, so it landed in extraFields → the
// Imported Fields card instead of the Conversation timeline. This moves it to its
// rightful home for every EXISTING buyer:
//   • rec.remarks   = the Conversation History (primary), with the old short
//                     status appended as a trailing line if not already contained.
//   • extraFields   = same, MINUS the conversation key (so it stops showing in
//                     Imported Fields). rawImport keeps the verbatim original row.
//   • BuyerActivity = imported-tagged rows DELETED + regenerated from the new
//                     remarks via the SAME Lead parser (buildBuyerTimelinePlan).
//                     LIVE agent-logged rows (no "(imported)" tag) are untouched.
//
// Idempotent: once the conversation key is moved out of extraFields, a re-run
// finds no target. DRY-RUN by default; `--apply` writes a JSON backup first.
// ─────────────────────────────────────────────────────────────────────────────
import { prisma } from "../src/lib/prisma";
import { buildBuyerTimelinePlan, isImportedActivityDescription } from "../src/lib/buyerRemarkTimeline";
import * as fs from "fs";
import * as path from "path";

// Mirror of CONVERSATION_KEYS in the import route — keep in sync.
const CONVERSATION_KEYS = [
  "conversation history", "conversation", "call history", "remark history",
  "interaction history", "communication history", "discussion", "chat history",
];
const APPLY = process.argv.includes("--apply");

function pickConv(extra: Record<string, unknown>): { key: string; value: string } | null {
  for (const k of Object.keys(extra)) {
    if (CONVERSATION_KEYS.includes(k.trim().toLowerCase()) && String(extra[k] ?? "").trim()) {
      return { key: k, value: String(extra[k]).trim() };
    }
  }
  return null;
}

(async () => {
  const buyers = await prisma.buyerRecord.findMany({
    where: { deletedAt: null },
    select: { id: true, clientName: true, remarks: true, extraFields: true, transactionDate: true, createdAt: true },
  });

  type Target = { id: string; name: string; oldRemarks: string | null; newRemarks: string; convKey: string; newExtra: Record<string, unknown>; fallback: Date };
  const targets: Target[] = [];
  for (const b of buyers) {
    const ef = b.extraFields as Record<string, unknown> | null;
    if (!ef || typeof ef !== "object" || Array.isArray(ef)) continue;
    const conv = pickConv(ef);
    if (!conv) continue;
    const cur = String(b.remarks ?? "").trim();
    const tail = cur && !conv.value.toLowerCase().includes(cur.toLowerCase()) ? cur : "";
    const newRemarks = tail ? `${conv.value}\n${tail}` : conv.value;
    const newExtra = { ...ef }; delete newExtra[conv.key];
    targets.push({ id: b.id, name: b.clientName, oldRemarks: b.remarks, newRemarks, convKey: conv.key, newExtra, fallback: b.transactionDate ?? b.createdAt });
  }

  console.log(`Buyers scanned: ${buyers.length}`);
  console.log(`Targets (stranded conversation column): ${targets.length}`);
  for (const t of targets.slice(0, 3)) {
    const plan = buildBuyerTimelinePlan(t.newRemarks, t.fallback, []);
    console.log(`\n• ${t.name} (${t.id}) [key="${t.convKey}"]`);
    console.log(`  old remarks: ${JSON.stringify(String(t.oldRemarks ?? "").slice(0, 45))}`);
    console.log(`  new remarks: ${JSON.stringify(t.newRemarks.slice(0, 90))}`);
    console.log(`  → ${plan.length} timeline rows; first: ${plan[0] ? `[${plan[0].createdAt.toISOString().slice(0,10)}] ${plan[0].type}` : "—"}`);
  }

  if (!APPLY) {
    console.log(`\n[DRY-RUN] No writes. Re-run with --apply to commit (a JSON backup is written first).`);
    process.exit(0);
  }

  // ── BACKUP first ──────────────────────────────────────────────────────────
  const ids = targets.map((t) => t.id);
  const backupDir = path.join(process.cwd(), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const beforeBuyers = await prisma.buyerRecord.findMany({ where: { id: { in: ids } }, select: { id: true, remarks: true, extraFields: true } });
  const beforeActs = await prisma.buyerActivity.findMany({ where: { buyerId: { in: ids } } });
  const file = path.join(backupDir, `buyer-convo-backfill-${ts}.json`);
  fs.writeFileSync(file, JSON.stringify({ when: ts, buyers: beforeBuyers, activities: beforeActs }, null, 2));
  console.log(`\n💾 Backup → ${file}  (${beforeBuyers.length} buyers, ${beforeActs.length} activities)`);

  // ── APPLY per buyer, each in its own transaction ───────────────────────────
  let done = 0, rowsAdded = 0, importedDeleted = 0;
  for (const t of targets) {
    // No interactive transaction — Neon free-tier interactive tx time out across
    // 438 sequential iterations. Each op is idempotent and the record update runs
    // LAST (removing the conversation key = the "done" marker), so a mid-way
    // failure leaves the buyer a clean re-run target with no data loss.
    const existing = await prisma.buyerActivity.findMany({ where: { buyerId: t.id }, select: { id: true, description: true } });
    const importedIds = existing.filter((a) => isImportedActivityDescription(a.description)).map((a) => a.id);
    if (importedIds.length) { await prisma.buyerActivity.deleteMany({ where: { id: { in: importedIds } } }); importedDeleted += importedIds.length; }
    const plan = buildBuyerTimelinePlan(t.newRemarks, t.fallback, []);
    if (plan.length) {
      await prisma.buyerActivity.createMany({ data: plan.map((p) => ({ buyerId: t.id, userId: null, type: p.type, description: p.description, createdAt: p.createdAt })) });
      rowsAdded += plan.length;
    }
    await prisma.buyerRecord.update({ where: { id: t.id }, data: { remarks: t.newRemarks, extraFields: t.newExtra as unknown as object } });
    done++;
  }
  console.log(`\n✅ Applied: ${done} buyers · ${importedDeleted} stale imported rows removed · ${rowsAdded} timeline rows regenerated.`);
  process.exit(0);
})().catch((e) => { console.error(String(e).slice(0, 600)); process.exit(1); });
