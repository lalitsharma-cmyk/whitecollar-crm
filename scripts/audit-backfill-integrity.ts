// ─────────────────────────────────────────────────────────────────────────────
// scripts/audit-backfill-integrity.ts — READ-ONLY existing-data backfill audit.
//
// For each recent change, runs a REAL prod COUNT to determine whether EXISTING
// records already comply. Prints a per-change status block + the markdown report
// table. WRITES NOTHING. Run before any backfill to size the genuine gaps.
//
//   npx tsx scripts/audit-backfill-integrity.ts
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { normalizeNameList } from "../src/lib/nameFormat";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

// ── helpers ──────────────────────────────────────────────────────────────────
function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function jsonArr(raw: string | null): string[] {
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
}
function uncased(s: string | null | undefined): boolean {
  if (!s) return false;
  // whole-cell would change under the same transform the migration uses
  return normalizeNameList(s) !== s;
}

const rows: Record<string, string>[] = [];
function pushRow(change: string, existing: string, migration: string) {
  rows.push({ change, existing, migration });
}

async function main() {
  console.log("EXISTING-DATA BACKFILL AUDIT — read-only prod counts");
  console.log("=".repeat(78));

  const totalLeads = await prisma.lead.count({ where: { deletedAt: null } });
  const totalLeadsAll = await prisma.lead.count();
  const totalBuyers = await prisma.buyerRecord.count({ where: { deletedAt: null } });
  console.log(`Live leads: ${totalLeads} (all incl. deleted: ${totalLeadsAll}) · Live buyers: ${totalBuyers}\n`);

  // ── 1. SOURCE + MEDIUM SPLIT ────────────────────────────────────────────────
  const legacySource = await prisma.lead.count({
    where: { deletedAt: null, source: { in: ["WHATSAPP", "INBOUND_CALL"] } },
  });
  // sourceRaw indicating call/whatsapp/email but source != WEBSITE (would-be split)
  const srcRawCandidates = await prisma.lead.findMany({
    where: {
      deletedAt: null,
      source: { not: "WEBSITE" },
      OR: [
        { sourceRaw: { contains: "whatsapp", mode: "insensitive" } },
        { sourceRaw: { contains: "inbound", mode: "insensitive" } },
        { sourceRaw: { contains: "call", mode: "insensitive" } },
        { sourceRaw: { contains: "email", mode: "insensitive" } },
      ],
    },
    select: { id: true, source: true, sourceRaw: true },
  });
  // medium-coverage sanity
  const withMedium = await prisma.lead.count({ where: { deletedAt: null, medium: { not: null } } });
  console.log("1. SOURCE + MEDIUM SPLIT");
  console.log(`   legacy source (WHATSAPP/INBOUND_CALL) on live leads: ${legacySource}`);
  console.log(`   source!=WEBSITE but sourceRaw mentions call/whatsapp/email: ${srcRawCandidates.length}`);
  if (srcRawCandidates.length) {
    for (const c of srcRawCandidates.slice(0, 8)) console.log(`      ${c.source}  raw=${JSON.stringify(c.sourceRaw)}`);
  }
  console.log(`   (info) live leads with medium set: ${withMedium}`);
  pushRow(
    "1. Source + Medium split",
    legacySource === 0 && srcRawCandidates.length === 0
      ? `0 legacy source, 0 sourceRaw mismatches (${withMedium} have medium)`
      : `${legacySource} legacy + ${srcRawCandidates.length} raw-mismatch`,
    legacySource === 0 && srcRawCandidates.length === 0 ? "No (already migrated)" : "YES — split source→WEBSITE+medium",
  );

  // ── 2. PROPER-CASE NAMES ────────────────────────────────────────────────────
  const leadsForNames = await prisma.lead.findMany({ where: { deletedAt: null }, select: { id: true, name: true, altName: true } });
  let leadNameBad = 0;
  for (const l of leadsForNames) { if (uncased(l.name)) leadNameBad++; if (uncased(l.altName)) leadNameBad++; }
  const buyersForNames = await prisma.buyerRecord.findMany({
    where: { deletedAt: null },
    select: { id: true, clientName: true, coBuyerNames: true, ownerName: true, agentName: true },
  });
  let buyerNameBad = 0;
  for (const b of buyersForNames) {
    if (uncased(b.clientName)) buyerNameBad++;
    for (const co of jsonArr(b.coBuyerNames)) if (uncased(co)) buyerNameBad++;
    if (uncased(b.ownerName)) buyerNameBad++;
    if (uncased(b.agentName)) buyerNameBad++;
  }
  console.log("\n2. PROPER-CASE NAMES");
  console.log(`   leads with un-cased name/altName: ${leadNameBad}`);
  console.log(`   buyers with un-cased clientName/coBuyer/ownerName/agentName: ${buyerNameBad}`);
  pushRow(
    "2. Proper Case names",
    `${leadNameBad} lead + ${buyerNameBad} buyer name-fields un-cased`,
    leadNameBad === 0 && buyerNameBad === 0 ? "No (already normalized)" : "YES — normalize stragglers",
  );

  // ── 3. SMART TIMELINE (LEADS): imported remarks → timeline coverage ──────────
  // The Lead Smart Timeline (ConversationStreamCard) parses rawRemarks at RENDER
  // time → imported remarks ALREADY appear as timeline entries without any stored
  // Activity rows. This counts the picture both ways for the report.
  const leadsWithRemarks = await prisma.lead.count({
    where: { deletedAt: null, OR: [{ rawRemarks: { not: null } }, { remarks: { not: null } }] },
  });
  // leads that have remark content but ZERO Activity rows at all
  const remarkLeads = await prisma.lead.findMany({
    where: {
      deletedAt: null,
      OR: [{ rawRemarks: { not: null } }, { remarks: { not: null } }],
    },
    select: { id: true, rawRemarks: true, remarks: true, _count: { select: { activities: true } } },
  });
  let remarkNoActivity = 0, remarkSubstantive = 0;
  for (const l of remarkLeads) {
    const txt = ((l.rawRemarks ?? l.remarks) ?? "").trim();
    if (txt.length >= 2) remarkSubstantive++;
    if (l._count.activities === 0 && txt.length >= 2) remarkNoActivity++;
  }
  console.log("\n3. SMART TIMELINE — LEADS (render-time parse of rawRemarks)");
  console.log(`   live leads with rawRemarks/remarks content: ${leadsWithRemarks}`);
  console.log(`   ↳ substantive remark text: ${remarkSubstantive}`);
  console.log(`   leads w/ substantive remarks but ZERO stored Activity rows: ${remarkNoActivity}`);
  console.log(`   NOTE: Smart Timeline renders from rawRemarks directly — these still SHOW in the timeline.`);
  pushRow(
    "3a. Smart Timeline — LEADS (imported remarks)",
    `${remarkSubstantive} leads w/ remarks render in timeline at read-time (Activity rows NOT required)`,
    "No (render-time parse; no Activity backfill needed)",
  );

  // ── 3b. SMART TIMELINE (BUYERS): the 4 backfilled — confirm ──────────────────
  const buyersWithRemarks = await prisma.buyerRecord.count({ where: { deletedAt: null, remarks: { not: null } } });
  const buyersWithActivity = await prisma.buyerRecord.count({
    where: { deletedAt: null, activities: { some: {} } },
  });
  // buyers with substantive remarks but no activity rows
  const buyerRemarkRows = await prisma.buyerRecord.findMany({
    where: { deletedAt: null, remarks: { not: null } },
    select: { id: true, clientName: true, remarks: true, _count: { select: { activities: true } } },
  });
  let buyerRemarkNoActivity = 0;
  for (const b of buyerRemarkRows) {
    if ((b.remarks ?? "").trim().length >= 2 && b._count.activities === 0) buyerRemarkNoActivity++;
  }
  const importedBuyerActivities = await prisma.buyerActivity.count({ where: { description: { contains: "(imported)" } } });
  console.log("\n3b. SMART TIMELINE — BUYERS (stored BuyerActivity)");
  console.log(`   live buyers with remarks: ${buyersWithRemarks}`);
  console.log(`   live buyers with >=1 BuyerActivity: ${buyersWithActivity}`);
  console.log(`   buyers w/ substantive remarks but ZERO BuyerActivity: ${buyerRemarkNoActivity}`);
  console.log(`   total imported-tagged BuyerActivity rows: ${importedBuyerActivities}`);
  pushRow(
    "3b. Smart Timeline — BUYERS",
    `${buyersWithActivity}/${buyersWithRemarks} buyers have timeline rows; ${buyerRemarkNoActivity} remark-w/o-activity; ${importedBuyerActivities} imported rows`,
    buyerRemarkNoActivity === 0 ? "No (backfilled)" : "YES — run backfill-buyer-history",
  );

  // ── 4. BUYER MARKET + LABEL ─────────────────────────────────────────────────
  const buyerMarkets = await prisma.buyerRecord.groupBy({ by: ["market"], _count: true });
  const nonDubaiMarket = await prisma.buyerRecord.count({ where: { market: { not: "Dubai" } } });
  console.log("\n4. DUBAI BUYER MARKET");
  for (const m of buyerMarkets) console.log(`   market=${JSON.stringify(m.market)}: ${m._count}`);
  console.log(`   non-Dubai market rows: ${nonDubaiMarket}`);
  pushRow(
    "4. Dubai Buyer market + rename",
    `${buyerMarkets.map((m) => `${m.market}=${m._count}`).join(", ")} (non-Dubai=${nonDubaiMarket})`,
    nonDubaiMarket === 0 ? "No (all Dubai; label is code-only)" : "YES — set market=Dubai",
  );

  // ── 5. BUYER PROPERTY MAPPING (extraFields → real columns) ───────────────────
  // header variants that mean each column
  const KEYMAP: Record<string, string[]> = {
    tower: ["tower", "towerbuilding", "building", "block"],
    unitNumber: ["unit", "unitnumber", "unitno", "apartment", "apartmentno", "flat", "flatno", "villa", "villano"],
    configuration: ["configuration", "config", "type", "unittype", "bedrooms", "bhk", "bedroom"],
    transactionValue: ["transactionvalue", "dealprice", "price", "value", "amount", "saleprice", "purchaseprice", "totalprice"],
    projectName: ["project", "projectname", "property", "propertyname", "development"],
    propertyType: ["propertytype", "assettype", "category"],
  };
  const allBuyers = await prisma.buyerRecord.findMany({
    where: { deletedAt: null },
    select: {
      id: true, clientName: true, projectName: true, tower: true, unitNumber: true,
      configuration: true, propertyType: true, transactionValue: true, extraFields: true, rawImport: true,
    },
  });
  const gapCount: Record<string, number> = { tower: 0, unitNumber: 0, configuration: 0, transactionValue: 0, projectName: 0, propertyType: 0 };
  const gapSamples: string[] = [];
  let anyBuyerGap = 0;
  for (const b of allBuyers) {
    const blob = { ...asObj(b.rawImport), ...asObj(b.extraFields) };
    const blobKeys = Object.keys(blob);
    let hadGap = false;
    for (const [col, variants] of Object.entries(KEYMAP)) {
      const cur = (b as Record<string, unknown>)[col];
      const isNull = cur == null || (typeof cur === "string" && cur.trim() === "");
      if (!isNull) continue;
      // find an extraFields/rawImport key that maps to this column with a real value
      const hitKey = blobKeys.find((k) => variants.includes(norm(k)) && String(blob[k] ?? "").trim() && !["na", "n/a", "-", "none", "null", "nil"].includes(norm(String(blob[k]))));
      if (hitKey) {
        gapCount[col]++;
        hadGap = true;
        if (gapSamples.length < 12) gapSamples.push(`${b.clientName}: ${col} ← "${blob[hitKey]}" (key "${hitKey}")`);
      }
    }
    if (hadGap) anyBuyerGap++;
  }
  console.log("\n5. BUYER PROPERTY MAPPING (column null but value sits in extraFields/rawImport)");
  console.log(`   buyers with at least one mappable gap: ${anyBuyerGap}`);
  for (const [col, n] of Object.entries(gapCount)) if (n) console.log(`      ${col}: ${n}`);
  if (gapSamples.length) { console.log("   samples:"); for (const s of gapSamples) console.log(`      ${s}`); }
  pushRow(
    "5. Property mapping (buyers)",
    anyBuyerGap === 0 ? "0 — all mappable values already in real columns" : `${anyBuyerGap} buyers have ${Object.entries(gapCount).filter(([, n]) => n).map(([c, n]) => `${c}:${n}`).join(",")} in extraFields only`,
    anyBuyerGap === 0 ? "No" : "YES — backfill columns from extraFields",
  );

  // ── 6. IMPORT DATE CORRECTION ───────────────────────────────────────────────
  // Find leads whose createdAt is suspiciously a future date OR exactly equals the
  // batch timestamp while rawImport carries a real (different) date column.
  const now = new Date();
  const futureLeads = await prisma.lead.count({ where: { deletedAt: null, createdAt: { gt: now } } });
  // 05:30 IST (= 00:00 UTC) artifact — the old import-date leak signature
  const midnightUtc = await prisma.lead.findMany({
    where: { deletedAt: null },
    select: { id: true, createdAt: true },
    take: 20000,
  });
  let midnightCount = 0;
  for (const l of midnightUtc) {
    if (l.createdAt.getUTCHours() === 0 && l.createdAt.getUTCMinutes() === 0 && l.createdAt.getUTCSeconds() === 0) midnightCount++;
  }
  console.log("\n6. IMPORT DATE CORRECTION");
  console.log(`   live leads with future createdAt: ${futureLeads}`);
  console.log(`   live leads with exact-midnight-UTC createdAt (5:30am IST artifact): ${midnightCount}`);
  pushRow(
    "6. Import date correction",
    `${futureLeads} future-dated, ${midnightCount} midnight-UTC artifact`,
    futureLeads === 0 ? "No (held; spot-check only)" : "YES — correct from rawImport date",
  );

  // ── 7. PROPERTY ENQUIRED AUTO-MAP ───────────────────────────────────────────
  const WANTED = ["Project", "Project Name", "Property", "Property Name", "Enquired Property", "Interested Project", "Requirement Project", "Tower/Project", "Tower"].map(norm);
  const JUNK = new Set(["", "na", "n/a", "none", "null", "-", "nil", "tbd", "notapplicable"]);
  const blankSD = await prisma.lead.findMany({
    where: { deletedAt: null, OR: [{ sourceDetail: null }, { sourceDetail: "" }] },
    select: { id: true, name: true, rawImport: true, customFields: true },
  });
  let propEnqGap = 0;
  const propEnqSamples: string[] = [];
  for (const l of blankSD) {
    const blob = { ...asObj(l.customFields), ...asObj(l.rawImport) };
    const hit = Object.entries(blob).find(([k, v]) => WANTED.includes(norm(k)) && String(v ?? "").trim() && !JUNK.has(norm(String(v))));
    if (hit) { propEnqGap++; if (propEnqSamples.length < 8) propEnqSamples.push(`${l.name}: "${hit[1]}" (key "${hit[0]}")`); }
  }
  console.log("\n7. PROPERTY ENQUIRED AUTO-MAP");
  console.log(`   live leads with blank sourceDetail but project/property in rawImport: ${propEnqGap}`);
  if (propEnqSamples.length) for (const s of propEnqSamples) console.log(`      ${s}`);
  pushRow(
    "7. Property Enquired auto-map",
    `${propEnqGap} blank sourceDetail with mappable project in rawImport`,
    propEnqGap === 0 ? "No (backfilled)" : "YES — backfill sourceDetail",
  );

  // ── 8. READ-TIME LOGIC (deleted exclusion etc.) ─────────────────────────────
  const deletedLeads = await prisma.lead.count({ where: { deletedAt: { not: null } } });
  const deletedBuyers = await prisma.buyerRecord.count({ where: { deletedAt: { not: null } } });
  console.log("\n8. READ-TIME LOGIC (deleted exclusion / dashboard / editability)");
  console.log(`   soft-deleted leads (must be hidden from active lists/counts): ${deletedLeads}`);
  console.log(`   soft-deleted buyers (must be hidden from pool/rollup): ${deletedBuyers}`);
  pushRow(
    "8. Follow-up gate / Deleted excl / Dashboard / Editability",
    `${deletedLeads} deleted leads + ${deletedBuyers} deleted buyers excluded at read-time`,
    "No (read-time logic — no backfill needed)",
  );

  // ── MARKDOWN REPORT TABLE ───────────────────────────────────────────────────
  console.log("\n" + "=".repeat(78));
  console.log("REPORT TABLE (Change | Existing Data Status | Migration Needed)\n");
  console.log("| Change | Existing Data Status | Migration Needed |");
  console.log("|---|---|---|");
  for (const r of rows) console.log(`| ${r.change} | ${r.existing} | ${r.migration} |`);

  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); return prisma.$disconnect().then(() => process.exit(1)); });
