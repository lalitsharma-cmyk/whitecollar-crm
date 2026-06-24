// ─────────────────────────────────────────────────────────────────────────────
// backfill-buyer-history.ts — retroactively give EXISTING BuyerRecords the same
// Raw History + Smart Timeline a fresh import now produces.
//
// WHY: buyers imported before the import-route overhaul have remarks-like data
// sitting inert in extraFields (Status / Status 2 / Follow-Up / Notes / Remarks)
// and ZERO BuyerActivity, so their detail page shows no Raw History and an empty
// Smart Timeline. This script, for every LIVE buyer (deletedAt:null):
//   1. Populates BuyerRecord.remarks (verbatim) — preferring an existing free-text
//      remarks/notes extra column, else composing from the short status columns
//      (same composer the import route uses). Only fills when remarks is empty, so a
//      later manual edit is never clobbered.
//   2. Generates BuyerActivity Smart-Timeline rows from that remark via the SHARED
//      buildBuyerTimelinePlan() (historical dates honored; else createdAt fallback).
//
// IDEMPOTENT: every generated row is tagged "(imported)". On a re-run we DELETE the
// buyer's existing imported-tagged BuyerActivity rows and regenerate from the
// current remark — converging to the same state, never doubling. Live agent-logged
// rows (no tag) are never touched.
//
// SAFE: backs up every touched buyer first; read-back verifies after writing.
//
//   npx tsx scripts/backfill-buyer-history.ts            # dry-run (no writes)
//   npx tsx scripts/backfill-buyer-history.ts --apply    # write to prod
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  buildBuyerTimelinePlan,
  composeRemarkFromFields,
  isImportedActivityDescription,
} from "../src/lib/buyerRemarkTimeline";

const APPLY = process.argv.includes("--apply");

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

// Keys (case-insensitive) in extraFields that carry remark/history-like data.
// Free-text columns (remarks/notes/comments/activity) WIN as the whole remark;
// otherwise the short status columns are composed into one labeled line.
const FREE_TEXT = ["remark", "remarks", "notes", "note", "comments", "comment", "activity", "activity history", "conversation", "history", "follow-up notes", "followup notes"];
const STATUS_LIKE = ["status", "status 2", "status2", "follow-up", "followup", "follow up"];

function pickFreeText(extra: Record<string, string>): string | null {
  for (const [k, v] of Object.entries(extra)) {
    if (FREE_TEXT.includes(k.trim().toLowerCase()) && String(v ?? "").trim()) return String(v).trim();
  }
  return null;
}
function composeStatus(extra: Record<string, string>): string {
  const picked: Record<string, string> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (STATUS_LIKE.includes(k.trim().toLowerCase()) && String(v ?? "").trim()) picked[k] = v;
  }
  return composeRemarkFromFields(picked);
}

async function main() {
  const buyers = await prisma.buyerRecord.findMany({
    where: { deletedAt: null },
    select: { id: true, clientName: true, remarks: true, extraFields: true, createdAt: true, transactionDate: true },
  });
  console.log(`Live buyers: ${buyers.length}\n`);

  type Plan = { id: string; name: string; remark: string; setRemark: boolean; activityCount: number; fallback: Date };
  const plan: Plan[] = [];
  let noData = 0, alreadyHadRemark = 0;

  for (const b of buyers) {
    const extra = (b.extraFields && typeof b.extraFields === "object" && !Array.isArray(b.extraFields)
      ? (b.extraFields as Record<string, string>) : {});
    // Existing remarks win as the source; else free-text extra; else composed status.
    const existingRemark = (b.remarks ?? "").trim();
    const remark = existingRemark || pickFreeText(extra) || composeStatus(extra);
    if (!remark) { noData++; continue; }
    if (existingRemark) alreadyHadRemark++;

    const fallback = b.transactionDate ?? b.createdAt ?? new Date();
    const activities = buildBuyerTimelinePlan(remark, fallback);
    plan.push({
      id: b.id,
      name: b.clientName,
      remark,
      setRemark: existingRemark.length === 0, // only fill when empty
      activityCount: activities.length,
      fallback,
    });
  }

  console.log(`PLAN: ${plan.length} buyers get history · ${noData} have no remark-like data (skipped) · ${alreadyHadRemark} already had a remark (kept; timeline still (re)generated)`);
  for (const p of plan) {
    console.log(`  ▸ ${p.name}: ${p.setRemark ? "SET remarks" : "remarks kept"} · ${p.activityCount} timeline row(s)`);
    console.log(`      remark: ${JSON.stringify(p.remark.slice(0, 110))}`);
  }

  if (!APPLY) { console.log(`\nDRY-RUN — re-run with --apply to write.`); await prisma.$disconnect(); return; }

  // Backup every touched buyer (remarks + its current activities) before writing.
  const touchedIds = plan.map((p) => p.id);
  const backup = await prisma.buyerRecord.findMany({
    where: { id: { in: touchedIds } },
    select: { id: true, clientName: true, remarks: true, activities: { select: { id: true, type: true, description: true, createdAt: true } } },
  });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupUrl = new URL(`../backups/backfill-buyer-history-${stamp}.json`, import.meta.url);
  writeFileSync(backupUrl, JSON.stringify(backup, null, 2));
  console.log(`\nBackup: ${decodeURIComponent(backupUrl.pathname)}`);

  let setRemarks = 0, createdActs = 0;
  for (const p of plan) {
    await prisma.$transaction(async (tx) => {
      // 1) Fill remarks (verbatim) only when currently empty.
      if (p.setRemark) {
        await tx.buyerRecord.update({ where: { id: p.id }, data: { remarks: p.remark } });
        setRemarks++;
      }
      // 2) Idempotent regen: drop existing imported-tagged activities, then recreate.
      const existing = await tx.buyerActivity.findMany({ where: { buyerId: p.id }, select: { id: true, description: true } });
      const toDelete = existing.filter((a) => isImportedActivityDescription(a.description)).map((a) => a.id);
      if (toDelete.length) await tx.buyerActivity.deleteMany({ where: { id: { in: toDelete } } });
      const activities = buildBuyerTimelinePlan(p.remark, p.fallback);
      if (activities.length) {
        await tx.buyerActivity.createMany({
          data: activities.map((a) => ({ buyerId: p.id, userId: null, type: a.type, description: a.description, createdAt: a.createdAt })),
        });
        createdActs += activities.length;
      }
    });
  }
  console.log(`✅ Wrote: ${setRemarks} remarks set · ${createdActs} BuyerActivity rows (re)generated.`);

  // ── Read-back verification ──────────────────────────────────────────────────
  console.log(`\nREAD-BACK:`);
  for (const id of touchedIds) {
    const b = await prisma.buyerRecord.findUnique({
      where: { id },
      select: { clientName: true, remarks: true, _count: { select: { activities: true } } },
    });
    const imported = await prisma.buyerActivity.count({ where: { buyerId: id } });
    console.log(`  ${b?.clientName}: remarks=${(b?.remarks ?? "").length} chars · activities=${b?._count.activities} (total ${imported})`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); return prisma.$disconnect().then(() => process.exit(1)); });
