// ─────────────────────────────────────────────────────────────────────────────
// scripts/normalize-country.ts — normalize EXISTING Lead.country values to one
// canonical form (global data-consistency rule). Fixes:
//   • variants:  "UK" / "United Kindon" / "United Kingdom " → "United Kingdom"
//   • localized: "United Arab Emirates" → "UAE"
//   • city-in-country: "Istanbul" → "Turkey", "Dubai" → "UAE"
//   npx tsx scripts/normalize-country.ts            (DRY-RUN)
//   npx tsx scripts/normalize-country.ts --apply
// Never blanks a country; only rewrites to the canonical/correct value.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { inferCountryFromCity, canonicalCountry } from "../src/lib/cityCountry";

const APPLY = process.argv.includes("--apply");
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

async function main() {
  const leads = await prisma.lead.findMany({ where: { country: { not: null } }, select: { id: true, name: true, country: true } });
  const changes: { id: string; from: string; to: string }[] = [];
  for (const l of leads) {
    const cur = (l.country ?? "").trim();
    if (!cur) continue;
    // A country value that is actually a known city → its real country; else canonicalize.
    const cityAsCountry = inferCountryFromCity(cur);
    const next = cityAsCountry ?? canonicalCountry(cur)!;
    if (next && next !== l.country) changes.push({ id: l.id, from: l.country!, to: next });
  }

  console.log(`\n${APPLY ? "APPLY" : "DRY-RUN"} — ${leads.length} leads have a country · ${changes.length} need normalizing\n`);
  const summary: Record<string, number> = {};
  for (const c of changes) { const k = `${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`; summary[k] = (summary[k] ?? 0) + 1; }
  for (const [k, n] of Object.entries(summary).sort((a, b) => b[1] - a[1])) console.log(`   ${n.toString().padStart(3)}  ${k}`);

  if (APPLY && changes.length) {
    mkdirSync(new URL("../backups/", import.meta.url), { recursive: true });
    writeFileSync(new URL("../backups/country-normalize.json", import.meta.url), JSON.stringify(changes, null, 2));
    console.log(`\n🔒 Saved before→after → backups/country-normalize.json`);
    const byTo = new Map<string, string[]>();
    for (const c of changes) { const a = byTo.get(c.to) ?? []; a.push(c.id); byTo.set(c.to, a); }
    for (const [to, ids] of byTo) await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { country: to } });
    console.log(`✅ APPLIED — ${changes.length} country values normalized.`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
