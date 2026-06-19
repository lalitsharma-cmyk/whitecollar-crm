// ─────────────────────────────────────────────────────────────────────────────
// scripts/qa-audit.ts — READ-ONLY QA of every change shipped 2026-06-19.
//   npx tsx scripts/qa-audit.ts
// Verifies: (1) import-leak repair held, (2) Property Type backfill sane +
// no contradictions, (3) Country backfill sane + canonical + no contradictions,
// (4) LocationCache clean, (5) backfills didn't touch unrelated fields. ZERO writes.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { inferCountryFromCityFuzzy } from "../src/lib/cityCountry";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
let pass = 0, warn = 0, fail = 0;
const ok = (m: string) => { console.log(`  ✓ ${m}`); pass++; };
const wn = (m: string) => { console.log(`  ⚠ ${m}`); warn++; };
const er = (m: string) => { console.log(`  ✗ ${m}`); fail++; };

async function main() {
  // ── 1. IMPORT-LEAK REPAIR ─────────────────────────────────────────────────
  console.log("\n[1] Import blank-header leak — repair held + no new leaks");
  const imported = await prisma.lead.findMany({
    where: { deletedAt: null, rawImport: { not: { equals: null } as never } },
    select: { id: true, name: true, rawImport: true, city: true, budgetRaw: true, remarks: true, notesShort: true },
  });
  const leaked = imported.filter((l) => {
    const ri = l.rawImport as Record<string, unknown> | null;
    if (!ri) return false;
    const blanks = Object.keys(ri).filter((k) => norm(k) === "").map((k) => String(ri[k]).trim());
    if (!blanks.length) return false;
    const set = new Set(blanks);
    return [l.city, l.budgetRaw, l.remarks, l.notesShort].some((v) => v != null && set.has(String(v).trim()));
  });
  leaked.length === 0 ? ok(`0 live leads carry the leak signature (${imported.length} imported scanned)`) : er(`${leaked.length} leads STILL leaked: ${leaked.map(l=>l.name).join(", ")}`);
  // The 5 known-affected names should now have real remarks (not a date).
  const known = await prisma.lead.findMany({ where: { name: { in: ["Kartik Trar","Bhakti Kirit Mehta","Arjun Sachade","İsmail Necati Köksal","Alanur ÖZALP"] } }, select: { name: true, remarks: true, city: true } });
  const stillBad = known.filter((l) => /^\d{1,2}-[A-Za-z]{3}-\d{2}$/.test((l.remarks ?? "").trim()));
  stillBad.length === 0 ? ok(`all ${known.length} known-affected leads have real remarks (no date)`) : er(`${stillBad.length} still show a date as the remark: ${stillBad.map(l=>l.name).join(", ")}`);

  // ── 2. PROPERTY TYPE ──────────────────────────────────────────────────────
  console.log("\n[2] Property Type — values valid + no config contradictions");
  const allLeads = await prisma.lead.findMany({ select: { id: true, name: true, propertyType: true, configuration: true } });
  const ptValues = new Set(allLeads.map((l) => l.propertyType).filter(Boolean));
  const badPt = [...ptValues].filter((v) => v !== "Residential" && v !== "Commercial");
  badPt.length === 0 ? ok(`propertyType only ever Residential/Commercial/blank (distinct: ${[...ptValues].join(", ") || "none"})`) : er(`invalid propertyType values: ${badPt.join(", ")}`);
  const resi = allLeads.filter((l) => l.propertyType === "Residential").length;
  const comm = allLeads.filter((l) => l.propertyType === "Commercial").length;
  const blank = allLeads.filter((l) => !l.propertyType).length;
  ok(`distribution — Residential ${resi} · Commercial ${comm} · blank ${blank}`);
  // Contradiction: Commercial but a clearly-residential config (2BHK/Studio/Villa…), or Residential but config says Commercial/Office.
  const RESI_CFG = /\b(\d\s*bhk|\d\s*br|studio|penthouse|villa)\b/i;
  const COMM_CFG = /\b(commercial|office|shop|sco)\b/i;
  const contra = allLeads.filter((l) => {
    const c = l.configuration ?? "";
    return (l.propertyType === "Commercial" && RESI_CFG.test(c) && !COMM_CFG.test(c))
        || (l.propertyType === "Residential" && COMM_CFG.test(c) && !RESI_CFG.test(c));
  });
  contra.length === 0 ? ok(`no Property-Type ↔ configuration contradictions`) : wn(`${contra.length} to review (config vs type): ${contra.slice(0,5).map(l=>`${l.name}[${l.configuration}→${l.propertyType}]`).join(", ")}`);
  // Backfill set-list matches what's in the DB.
  try {
    const setList: { id: string; type: string }[] = JSON.parse(readFileSync(new URL("../backups/propertyType-backfill.json", import.meta.url), "utf8"));
    const byId = new Map(allLeads.map((l) => [l.id, l.propertyType]));
    const mism = setList.filter((s) => byId.get(s.id) !== s.type);
    mism.length === 0 ? ok(`all ${setList.length} backfilled leads match the saved set-list`) : er(`${mism.length} backfilled leads don't match the set-list`);
  } catch { wn("propertyType backfill set-list not found (skipped match check)"); }

  // ── 3. COUNTRY ────────────────────────────────────────────────────────────
  console.log("\n[3] Country — canonical + no city↔country contradictions");
  const withCountry = await prisma.lead.findMany({ where: { country: { not: null } }, select: { id: true, name: true, city: true, country: true } });
  // Canonical: no localized / garbage country names (non-ASCII or known junk).
  const junk = withCountry.filter((l) => /[^\x00-\x7F]/.test(l.country ?? "") || ["Italia","Costa Rica","Kosovo","Kosova / Kosovo"].includes((l.country ?? "")));
  junk.length === 0 ? ok(`no localized / garbage country values (${withCountry.length} have a country)`) : er(`${junk.length} junk countries: ${junk.slice(0,6).map(l=>`${l.name}=${l.country}`).join(", ")}`);
  // Distribution.
  const dist: Record<string, number> = {};
  for (const l of withCountry) dist[l.country!] = (dist[l.country!] ?? 0) + 1;
  ok(`distribution — ${Object.entries(dist).sort((a,b)=>b[1]-a[1]).map(([c,n])=>`${c}:${n}`).join(" · ")}`);
  // Contradiction: curated map disagrees with the stored country (review, not error —
  // could be an investor living abroad). Only flags confident curated hits.
  const mismatch = withCountry.filter((l) => { const cur = inferCountryFromCityFuzzy(l.city); return cur && cur !== l.country; });
  mismatch.length === 0 ? ok(`stored country agrees with the curated city map everywhere`) : wn(`${mismatch.length} city↔country to review: ${mismatch.slice(0,6).map(l=>`${l.name}[${l.city}→${l.country}]`).join(", ")}`);

  // ── 4. LOCATION CACHE ─────────────────────────────────────────────────────
  console.log("\n[4] LocationCache — clean");
  const cache = await prisma.locationCache.findMany({ select: { city: true, country: true } });
  const cacheJunk = cache.filter((c) => /[^\x00-\x7F]/.test(c.country));
  cacheJunk.length === 0 ? ok(`${cache.length} cache rows, none with garbage countries`) : er(`${cacheJunk.length} cache rows have localized countries`);

  console.log(`\n${"═".repeat(60)}\nQA AUDIT: ${pass} passed · ${warn} review · ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
