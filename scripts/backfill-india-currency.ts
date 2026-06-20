// Correct budgetCurrency for India/Gurgaon-team leads → INR (market rule: India=INR).
// CURRENCY LABEL ONLY — budgetMin/Max/budgetRaw are NEVER touched (no value conversion).
//   npx tsx scripts/backfill-india-currency.ts [--apply]
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const APPLY = process.argv.includes("--apply");
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
async function main(){
  const rows = await prisma.lead.findMany({
    where: { deletedAt: null, forwardedTeam: { in: ["India","Gurgaon","Gurugram"] }, NOT: { budgetCurrency: "INR" } },
    select: { id:true, name:true, budgetCurrency:true, budgetMin:true, budgetRaw:true, owner:{select:{name:true}} },
  });
  console.log(`India-team leads with budgetCurrency != INR: ${rows.length}`);
  const withBudget = rows.filter(r => r.budgetMin != null);
  console.log(`  of which have a numeric budget (visibly affected): ${withBudget.length}`);
  for (const r of withBudget.slice(0,10)) console.log(`   ${(r.owner?.name??"—").slice(0,12).padEnd(13)} ${r.name?.slice(0,20).padEnd(22)} ${r.budgetCurrency} min=${r.budgetMin} raw=${JSON.stringify(r.budgetRaw)}`);
  if (!APPLY) { console.log("\nDRY-RUN — re-run with --apply."); await prisma.$disconnect(); return; }
  const stamp = new Date().toISOString().replace(/[:.]/g,"-");
  writeFileSync(new URL(`../backups/india-currency-${stamp}.json`, import.meta.url), JSON.stringify(rows, null, 2));
  const r = await prisma.lead.updateMany({ where: { id: { in: rows.map(x=>x.id) } }, data: { budgetCurrency: "INR" } });
  console.log(`✅ Set budgetCurrency=INR on ${r.count} India-team leads (values untouched). Backup saved.`);
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
