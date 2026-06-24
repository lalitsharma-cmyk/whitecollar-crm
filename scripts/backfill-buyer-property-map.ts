// ─────────────────────────────────────────────────────────────────────────────
// scripts/backfill-buyer-property-map.ts — map CLEAR property values that sit
// inert in BuyerRecord.extraFields into their real (currently-null) columns, so
// the buyer-detail Configuration / Size / Actual Size fields show real data
// instead of "—". Mirrors how a fresh import now maps these columns.
//
// SCOPE (only CLEAR, unambiguous mappings — see scripts/audit-buyer-propmap.ts):
//   extraFields["Flat Typology"]  → configuration   (e.g. "2 BR", "1.5 BR")
//   extraFields["Saleable Area"]  → size            (verbatim area as written)
//   extraFields["Size(MM)"]       → actualSize      (secondary size, verbatim)
//
// DELIBERATELY EXCLUDED (ambiguous / already-mapped / no source):
//   "Sub Project"  → tower   — it's a sub-PROJECT name, not a building/tower.
//   "Developer"    → tower   — a developer is not a tower.
//   "Property Type"→ propertyType — already mapped (0 gap).
//   transactionValue — no price/value column exists in extraFields → nothing to map.
//
// SAFETY CONTRACT (do not relax):
//   • Fills a column ONLY when it is currently NULL/blank — never overwrites a
//     value. extraFields/rawImport are LEFT INTACT (data is duplicated into the
//     column, the verbatim source is preserved). → IDEMPOTENT (re-run changes 0).
//   • Values copied VERBATIM. configuration/size/actualSize are free-text strings;
//     no parsing/normalisation. NEVER touches phone/email/passport/txn/unit/ids.
//   • Backs up every touched buyer's full before-state to backups/ before writing
//     (reversible). Read-back verifies after.
//   • Market-scoped to the Dubai Buyer module (market:"Dubai"), deletedAt:null.
//   • BuyerRecord has no per-field history table (LeadFieldHistory is leads-only);
//     the JSON backup IS the audit/rollback artifact, and a BuyerActivity NOTE row
//     (tagged imported) records the column-fill on each touched buyer.
//
//   npx tsx scripts/backfill-buyer-property-map.ts            # dry-run
//   npx tsx scripts/backfill-buyer-property-map.ts --apply    # write to prod
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const APPLY = process.argv.includes("--apply");
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
const JUNK = new Set(["", "na", "n/a", "none", "null", "-", "nil", "tbd"]);
const real = (v: unknown): string | null => {
  const s = String(v ?? "").trim();
  return s && !JUNK.has(s.toLowerCase()) ? s : null;
};

// extraFields key (exact, case-sensitive as stored) → target column. CLEAR only.
const MAP: Array<{ key: string; col: "configuration" | "size" | "actualSize" }> = [
  { key: "Flat Typology", col: "configuration" },
  { key: "Saleable Area", col: "size" },
  { key: "Size(MM)", col: "actualSize" },
];

const IMPORTED_TAG = " (imported)";

async function main() {
  console.log(`\n${APPLY ? "APPLY" : "DRY-RUN"} — Buyer property-map backfill (extraFields → null columns)\n`);

  const buyers = await prisma.buyerRecord.findMany({
    where: { deletedAt: null, market: "Dubai" },
    select: { id: true, clientName: true, configuration: true, size: true, actualSize: true, extraFields: true, rawImport: true },
  });

  type Fill = { id: string; name: string; sets: Partial<Record<"configuration" | "size" | "actualSize", string>> };
  const plan: Fill[] = [];
  const perCol: Record<string, number> = { configuration: 0, size: 0, actualSize: 0 };

  for (const b of buyers) {
    const blob = { ...asObj(b.rawImport), ...asObj(b.extraFields) };
    const sets: Fill["sets"] = {};
    for (const { key, col } of MAP) {
      const cur = (b as Record<string, unknown>)[col];
      const isNull = cur == null || (typeof cur === "string" && cur.trim() === "");
      if (!isNull) continue;                // never overwrite — idempotent
      const val = real(blob[key]);
      if (!val) continue;
      sets[col] = val;
      perCol[col]++;
    }
    if (Object.keys(sets).length) plan.push({ id: b.id, name: b.clientName, sets });
  }

  console.log(`Scanned ${buyers.length} live Dubai buyers.`);
  console.log(`Buyers to fill: ${plan.length}`);
  console.log(`Per-column fills: configuration=${perCol.configuration} · size=${perCol.size} · actualSize=${perCol.actualSize}\n`);
  for (const p of plan.slice(0, 12)) {
    console.log(`  ▸ ${p.name}: ${Object.entries(p.sets).map(([c, v]) => `${c}="${v}"`).join(" · ")}`);
  }
  if (plan.length > 12) console.log(`  … and ${plan.length - 12} more`);

  if (!APPLY) { console.log(`\nDRY-RUN — nothing written. Re-run with --apply.`); await prisma.$disconnect(); return; }
  if (plan.length === 0) { console.log(`\n✅ APPLY — 0 changes (idempotent). Nothing written.`); await prisma.$disconnect(); return; }

  // ── BACKUP full before-state of every touched buyer (reversible) ────────────
  mkdirSync(new URL("../backups/", import.meta.url), { recursive: true });
  const TS = new Date().toISOString().replace(/[:.]/g, "-");
  const backup = await prisma.buyerRecord.findMany({
    where: { id: { in: plan.map((p) => p.id) } },
    select: { id: true, clientName: true, configuration: true, size: true, actualSize: true, extraFields: true },
  });
  const backupUrl = new URL(`../backups/backfill-buyer-property-map-${TS}.json`, import.meta.url);
  writeFileSync(backupUrl, JSON.stringify({ generatedAt: new Date().toISOString(), plan, before: backup }, null, 2));
  console.log(`\n🔒 Backed up ${backup.length} buyers → backups/backfill-buyer-property-map-${TS}.json`);

  // ── APPLY — per-buyer column fill + an imported-tagged NOTE recording it ─────
  let written = 0, notes = 0;
  for (const p of plan) {
    await prisma.$transaction(async (tx) => {
      await tx.buyerRecord.update({ where: { id: p.id }, data: p.sets });
      written++;
      // Idempotent audit note: only add if an identical one isn't already present.
      const desc = `Property fields mapped from import: ${Object.entries(p.sets).map(([c, v]) => `${c}=${v}`).join(", ")}${IMPORTED_TAG}`;
      const exists = await tx.buyerActivity.findFirst({ where: { buyerId: p.id, description: desc }, select: { id: true } });
      if (!exists) { await tx.buyerActivity.create({ data: { buyerId: p.id, userId: null, type: "NOTE", description: desc } }); notes++; }
    });
  }
  console.log(`✅ APPLIED — ${written} buyers updated · ${notes} audit NOTE row(s) added.`);

  // ── READ-BACK VERIFY ────────────────────────────────────────────────────────
  console.log(`\n🔎 Read-back verify…`);
  let stillNull = 0;
  for (const p of plan) {
    const b = await prisma.buyerRecord.findUnique({ where: { id: p.id }, select: { configuration: true, size: true, actualSize: true } });
    for (const col of Object.keys(p.sets) as Array<"configuration" | "size" | "actualSize">) {
      const v = b?.[col];
      if (v == null || String(v).trim() === "") stillNull++;
    }
  }
  console.log(`   columns still null after fill (want 0): ${stillNull}`);
  // Idempotency proof: re-derive the plan against current data → must be empty.
  const after = await prisma.buyerRecord.findMany({
    where: { deletedAt: null, market: "Dubai" },
    select: { id: true, configuration: true, size: true, actualSize: true, extraFields: true, rawImport: true },
  });
  let wouldChangeAgain = 0;
  for (const b of after) {
    const blob = { ...asObj(b.rawImport), ...asObj(b.extraFields) };
    for (const { key, col } of MAP) {
      const cur = (b as Record<string, unknown>)[col];
      const isNull = cur == null || (typeof cur === "string" && cur.trim() === "");
      if (isNull && real(blob[key])) wouldChangeAgain++;
    }
  }
  console.log(`   re-run would change (want 0): ${wouldChangeAgain}`);
  if (stillNull === 0 && wouldChangeAgain === 0) console.log(`   ✅ VERIFIED — all mapped; idempotent (re-run = 0).`);
  else process.exitCode = 1;

  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e); return prisma.$disconnect().then(() => process.exit(1)); });
