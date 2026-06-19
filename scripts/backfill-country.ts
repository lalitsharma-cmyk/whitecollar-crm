// ─────────────────────────────────────────────────────────────────────────────
// scripts/backfill-country.ts — fill Lead.country for existing leads with a city
// but no country. Curated map → LocationCache → free Nominatim (rate-limited,
// cached). Same resolution the live CRM uses → old == new.
//   npx tsx scripts/backfill-country.ts            (DRY-RUN)
//   npx tsx scripts/backfill-country.ts --apply
// CONSERVATIVE: only fills where country is blank; never overwrites.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { inferCountryFromCityFuzzy } from "../src/lib/cityCountry";

const APPLY = process.argv.includes("--apply");
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

const key = (c: string) => c.toLowerCase().trim().replace(/\s+/g, " ").replace(/[^a-z ]/g, "");

async function resolveCountry(city: string, cache: Map<string, string | null>): Promise<{ country: string | null; via: string }> {
  // 1. Curated.
  const curated = inferCountryFromCityFuzzy(city);
  if (curated) return { country: curated, via: "curated" };
  const k = key(city);
  if (!k) return { country: null, via: "blank" };
  // 2. In-run memo.
  if (cache.has(k)) return { country: cache.get(k) ?? null, via: "memo" };
  // 3. LocationCache (DB) — Nominatim results previously confirmed.
  const hit = await prisma.locationCache.findUnique({ where: { cityKey: k } }).catch(() => null);
  if (hit?.country) { cache.set(k, hit.country); return { country: hit.country, via: "cache" }; }
  // NOTE: NO live Nominatim in the bulk backfill. On messy historical city strings
  // ("FALSE", "Rohini", bare sectors) Nominatim mis-resolves (→ Italy / Nepal), which
  // would CORRUPT the country field. Unknowns stay blank (safe); the live update path
  // uses the supervised, English Nominatim fallback where the user can see + override.
  cache.set(k, null);
  return { country: null, via: "unresolved" };
}

async function main() {
  const leads = await prisma.lead.findMany({
    where: { AND: [{ city: { not: null } }, { OR: [{ country: null }, { country: "" }] }] },
    select: { id: true, name: true, city: true },
  });
  console.log(`\n${APPLY ? "APPLY" : "DRY-RUN"} — ${leads.length} leads have a city but no country\n`);

  const memo = new Map<string, string | null>();
  const resolved: { id: string; country: string }[] = [];
  const viaCount: Record<string, number> = {};
  const byCountry: Record<string, number> = {};
  const samples: string[] = [];

  for (const l of leads) {
    const { country, via } = await resolveCountry(l.city!, memo);
    viaCount[via] = (viaCount[via] ?? 0) + 1;
    if (country) {
      resolved.push({ id: l.id, country });
      byCountry[country] = (byCountry[country] ?? 0) + 1;
      if (samples.length < 18) samples.push(`   ${country.padEnd(14)} ${(l.city ?? "").slice(0, 22).padEnd(24)} (${via})  ${l.name.slice(0, 20)}`);
    }
  }

  console.log(`Resolved ${resolved.length} / ${leads.length}:`);
  for (const [c, n] of Object.entries(byCountry).sort((a, b) => b[1] - a[1])) console.log(`   ${c.padEnd(16)} ${n}`);
  console.log(`\nResolution path: ${JSON.stringify(viaCount)}`);
  console.log(`\nSamples:`); samples.forEach((s) => console.log(s));

  if (APPLY && resolved.length) {
    mkdirSync(new URL("../backups/", import.meta.url), { recursive: true });
    writeFileSync(new URL("../backups/country-backfill.json", import.meta.url), JSON.stringify(resolved, null, 2));
    console.log(`\n🔒 Saved set-list → backups/country-backfill.json`);
    const byC = new Map<string, string[]>();
    for (const r of resolved) { const a = byC.get(r.country) ?? []; a.push(r.id); byC.set(r.country, a); }
    for (const [country, ids] of byC) await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { country } });
    console.log(`✅ APPLIED — ${resolved.length} leads got a country.`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
