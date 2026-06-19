// ─────────────────────────────────────────────────────────────────────────────
// scripts/backfill-state.ts — fill Lead.state for existing leads with a city but
// no state, using the curated City→State map (same one the live CRM uses).
//   npx tsx scripts/backfill-state.ts            (DRY-RUN)
//   npx tsx scripts/backfill-state.ts --apply
// CONSERVATIVE: only fills where state is blank; never overwrites.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { inferStateFromCity } from "../src/lib/cityCountry";

const APPLY = process.argv.includes("--apply");
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
if (!dbUrl) throw new Error("DATABASE_URL not found in .env");
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

async function main() {
  const leads = await prisma.lead.findMany({
    where: { AND: [{ city: { not: null } }, { OR: [{ state: null }, { state: "" }] }] },
    select: { id: true, name: true, city: true },
  });
  const set: { id: string; state: string }[] = [];
  const byState: Record<string, number> = {};
  for (const l of leads) {
    const st = inferStateFromCity(l.city);
    if (st) { set.push({ id: l.id, state: st }); byState[st] = (byState[st] ?? 0) + 1; }
  }
  console.log(`\n${APPLY ? "APPLY" : "DRY-RUN"} — ${leads.length} leads have a city but no state · ${set.length} resolvable\n`);
  for (const [s, n] of Object.entries(byState).sort((a, b) => b[1] - a[1])) console.log(`   ${n.toString().padStart(3)}  ${s}`);

  if (APPLY && set.length) {
    mkdirSync(new URL("../backups/", import.meta.url), { recursive: true });
    writeFileSync(new URL("../backups/state-backfill.json", import.meta.url), JSON.stringify(set, null, 2));
    console.log(`\n🔒 Saved set-list → backups/state-backfill.json`);
    const byVal = new Map<string, string[]>();
    for (const r of set) { const a = byVal.get(r.state) ?? []; a.push(r.id); byVal.set(r.state, a); }
    for (const [state, ids] of byVal) await prisma.lead.updateMany({ where: { id: { in: ids } }, data: { state } });
    console.log(`✅ APPLIED — ${set.length} leads got a state.`);
  }
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
