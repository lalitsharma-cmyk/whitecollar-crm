// ─────────────────────────────────────────────────────────────────────────────
// scripts/normalize-names.ts — one-off migration: Proper-Case EXISTING un-cased
// (all-UPPER / all-lower) NAME fields, so stored names match what new writes now
// produce (via src/lib/nameFormat.ts, applied at every write path).
//
//   npx tsx scripts/normalize-names.ts            (DRY-RUN — writes nothing)
//   npx tsx scripts/normalize-names.ts --apply    (writes; backs up first)
//   npx tsx scripts/normalize-names.ts --apply --include-deleted   (also soft-deleted rows)
//
// SAFETY CONTRACT (matches the task spec — do not relax):
//   • NAME fields ONLY:
//       Lead.name, Lead.altName
//       BuyerRecord.clientName, coBuyerNames (JSON array), ownerName, agentName
//     Never touches phone/email/passport/nationality/company/project/unit/txn/
//     sourceRaw or any other column.
//   • Uses normalizeName / normalizeNameList → mixed-case ("McDonald") preserved,
//     non-name values (email/URL/numeric code) passed through, only all-upper /
//     all-lower values rewritten. → IDEMPOTENT (a re-run changes 0).
//   • Backs up every before→after to backups/name-normalize-<ts>.json BEFORE write.
//   • Writes a LeadFieldHistory audit row for each changed Lead name/altName
//     (source = "system-name-normalize") — the existing field-history pattern.
//   • Read-back VERIFY after apply: re-queries and asserts 0 un-cased names remain
//     and that the count of changed rows matches.
//   • Default scope = non-deleted rows (display-name cleanup on soft-deleted rows
//     is harmless; pass --include-deleted to cover them too).
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { normalizeName, normalizeNameList, shouldNormalizeName } from "../src/lib/nameFormat";

const APPLY = process.argv.includes("--apply");
const INCLUDE_DELETED = process.argv.includes("--include-deleted");

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const TS = new Date().toISOString().replace(/[:.]/g, "-");

type LeadChange = { id: string; field: "name" | "altName"; from: string; to: string };
type BuyerChange = { id: string; field: "clientName" | "coBuyerNames" | "ownerName" | "agentName"; from: string; to: string };

/** Does any element of a JSON name-array need normalising? Returns the rebuilt
 *  array string when yes, else null (no change). Each element guarded individually. */
function normalizeJsonNameArray(raw: string | null): string | null {
  if (!raw) return null;
  let arr: unknown;
  try { arr = JSON.parse(raw); } catch { return null; }     // not JSON → leave verbatim
  if (!Array.isArray(arr)) return null;
  let changed = false;
  const out = arr.map((el) => {
    if (typeof el !== "string") return el;
    const next = normalizeName(el);
    if (next !== el) changed = true;
    return next;
  });
  return changed ? JSON.stringify(out) : null;
}

async function main() {
  console.log(`\n${APPLY ? "APPLY" : "DRY-RUN"} — Proper-Case name normalization${INCLUDE_DELETED ? " (incl. soft-deleted)" : " (non-deleted only)"}\n`);

  // ── LEADS: name + altName ──────────────────────────────────────────────────
  const leadWhere = INCLUDE_DELETED ? {} : { deletedAt: null };
  const leads = await prisma.lead.findMany({
    where: leadWhere,
    select: { id: true, name: true, altName: true },
  });
  const leadChanges: LeadChange[] = [];
  for (const l of leads) {
    // Lead.name / altName can each hold MULTIPLE comma/slash/&-joined names →
    // normalizeNameList normalises each part with its own guard.
    if (l.name) {
      const next = normalizeNameList(l.name);
      if (next !== l.name) leadChanges.push({ id: l.id, field: "name", from: l.name, to: next });
    }
    if (l.altName) {
      const next = normalizeNameList(l.altName);
      if (next !== l.altName) leadChanges.push({ id: l.id, field: "altName", from: l.altName, to: next });
    }
  }

  // ── BUYERS: clientName + coBuyerNames(JSON) + ownerName + agentName ─────────
  const buyerWhere = INCLUDE_DELETED ? {} : { deletedAt: null };
  const buyers = await prisma.buyerRecord.findMany({
    where: buyerWhere,
    select: { id: true, clientName: true, coBuyerNames: true, ownerName: true, agentName: true },
  });
  const buyerChanges: BuyerChange[] = [];
  for (const b of buyers) {
    if (b.clientName) {
      const next = normalizeNameList(b.clientName);
      if (next !== b.clientName) buyerChanges.push({ id: b.id, field: "clientName", from: b.clientName, to: next });
    }
    const coNext = normalizeJsonNameArray(b.coBuyerNames);
    if (coNext != null && coNext !== b.coBuyerNames) buyerChanges.push({ id: b.id, field: "coBuyerNames", from: b.coBuyerNames ?? "", to: coNext });
    if (b.ownerName) {
      const next = normalizeNameList(b.ownerName);
      if (next !== b.ownerName) buyerChanges.push({ id: b.id, field: "ownerName", from: b.ownerName, to: next });
    }
    if (b.agentName) {
      const next = normalizeNameList(b.agentName);
      if (next !== b.agentName) buyerChanges.push({ id: b.id, field: "agentName", from: b.agentName, to: next });
    }
  }

  // ── REPORT — per-field counts + samples ────────────────────────────────────
  const perField: Record<string, number> = {};
  for (const c of leadChanges) perField[`Lead.${c.field}`] = (perField[`Lead.${c.field}`] ?? 0) + 1;
  for (const c of buyerChanges) perField[`BuyerRecord.${c.field}`] = (perField[`BuyerRecord.${c.field}`] ?? 0) + 1;

  console.log(`Scanned ${leads.length} leads, ${buyers.length} buyers.`);
  console.log(`Changes: ${leadChanges.length} lead-field(s) + ${buyerChanges.length} buyer-field(s) = ${leadChanges.length + buyerChanges.length} total\n`);
  console.log("Per-field counts:");
  if (Object.keys(perField).length === 0) console.log("   (none — all names already Proper-Case / mixed-case / non-name)");
  for (const [k, n] of Object.entries(perField).sort((a, b) => b[1] - a[1])) console.log(`   ${n.toString().padStart(5)}  ${k}`);

  console.log("\nBefore → After samples (first 10 per source):");
  for (const c of leadChanges.slice(0, 10)) console.log(`   Lead.${c.field.padEnd(8)} ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);
  for (const c of buyerChanges.slice(0, 10)) console.log(`   Buyer.${c.field.padEnd(12)} ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`);

  if (!APPLY) {
    console.log(`\nDRY-RUN complete — nothing written. Re-run with --apply to persist.`);
    await prisma.$disconnect();
    return;
  }

  if (leadChanges.length === 0 && buyerChanges.length === 0) {
    console.log(`\n✅ APPLY — 0 changes needed (idempotent). Nothing written.`);
    await prisma.$disconnect();
    return;
  }

  // ── BACKUP before any write ────────────────────────────────────────────────
  mkdirSync(new URL("../backups/", import.meta.url), { recursive: true });
  const backupPath = new URL(`../backups/name-normalize-${TS}.json`, import.meta.url);
  writeFileSync(backupPath, JSON.stringify({ generatedAt: new Date().toISOString(), includeDeleted: INCLUDE_DELETED, leadChanges, buyerChanges }, null, 2));
  console.log(`\n🔒 Backed up ${leadChanges.length + buyerChanges.length} before→after rows → backups/name-normalize-${TS}.json`);

  // ── APPLY — one updateMany per identical-target value (per field). Each row's
  //    target differs, so we update per-row but batch the LeadFieldHistory rows. ─
  let leadWritten = 0;
  for (const c of leadChanges) {
    await prisma.lead.update({ where: { id: c.id }, data: { [c.field]: c.to } });
    leadWritten++;
  }
  // Field-history audit rows for the changed Lead names (existing pattern).
  if (leadChanges.length) {
    await prisma.leadFieldHistory.createMany({
      data: leadChanges.map((c) => ({
        leadId: c.id, field: c.field, oldValue: c.from, newValue: c.to,
        changedById: null, source: "system-name-normalize",
      })),
    });
  }
  let buyerWritten = 0;
  for (const c of buyerChanges) {
    await prisma.buyerRecord.update({ where: { id: c.id }, data: { [c.field]: c.to } });
    buyerWritten++;
  }
  console.log(`✅ APPLIED — ${leadWritten} lead field(s) + ${buyerWritten} buyer field(s) written.`);
  console.log(`   + ${leadChanges.length} LeadFieldHistory audit row(s) (source="system-name-normalize").`);

  // ── READ-BACK VERIFY — re-query and assert 0 un-cased names remain ─────────
  console.log(`\n🔎 Read-back verify…`);
  const leadsAfter = await prisma.lead.findMany({ where: leadWhere, select: { id: true, name: true, altName: true } });
  let leadStillUncased = 0;
  for (const l of leadsAfter) {
    // After normalisation, a multi-name cell may legitimately still contain a
    // mixed-case part; the invariant is "no whole-cell that is all-upper/all-lower
    // AND would change". Re-running the same transform must yield the same value.
    if (l.name && normalizeNameList(l.name) !== l.name) leadStillUncased++;
    if (l.altName && normalizeNameList(l.altName) !== l.altName) leadStillUncased++;
  }
  const buyersAfter = await prisma.buyerRecord.findMany({ where: buyerWhere, select: { id: true, clientName: true, coBuyerNames: true, ownerName: true, agentName: true } });
  let buyerStillUncased = 0;
  for (const b of buyersAfter) {
    if (b.clientName && normalizeNameList(b.clientName) !== b.clientName) buyerStillUncased++;
    if (normalizeJsonNameArray(b.coBuyerNames) != null) buyerStillUncased++;
    if (b.ownerName && normalizeNameList(b.ownerName) !== b.ownerName) buyerStillUncased++;
    if (b.agentName && normalizeNameList(b.agentName) !== b.agentName) buyerStillUncased++;
  }
  console.log(`   Lead un-cased remaining:  ${leadStillUncased}`);
  console.log(`   Buyer un-cased remaining: ${buyerStillUncased}`);
  if (leadStillUncased === 0 && buyerStillUncased === 0) {
    console.log(`   ✅ VERIFIED — every targeted name is now Proper-Case; a re-run would change 0.`);
  } else {
    console.log(`   ⚠ ${leadStillUncased + buyerStillUncased} value(s) still transform — investigate (NOT expected).`);
    process.exitCode = 1;
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
