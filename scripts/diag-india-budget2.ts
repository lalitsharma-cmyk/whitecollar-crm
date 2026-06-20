import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { displayBudget } from "../src/lib/budgetParse";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const mFmt = /\b\d[\d.,]*\s*(m|mn|million|aed|dhs)\b/i;
async function main(){
  const india = await prisma.lead.findMany({ where:{ deletedAt:null, forwardedTeam:"India" },
    select:{ name:true, forwardedTeam:true, budgetRaw:true, budgetMin:true, budgetMax:true, budgetCurrency:true } });
  let badTeam=0, badCcyOnly=0;
  for (const l of india) {
    if (mFmt.test(displayBudget(l))) badTeam++;                                   // with team passed
    const noTeam = { ...l, forwardedTeam: null };
    if (mFmt.test(displayBudget(noTeam))) badCcyOnly++;                           // caller w/o team (currency fallback)
  }
  console.log(`India leads (${india.length}) showing M/AED:`);
  console.log(`  WITH forwardedTeam passed: ${badTeam}  (should be 0 — formatter fix)`);
  console.log(`  WITHOUT team (currency-only fallback): ${badCcyOnly}  (= the AED-currency records needing backfill)`);
  // Which need the currency backfill
  const needFix = india.filter(l => (l.budgetCurrency ?? "").toUpperCase() !== "INR");
  console.log(`\nIndia leads with budgetCurrency != INR (backfill → INR): ${needFix.length}`);
  for (const l of needFix.slice(0,10)) console.log(`  ${l.name?.slice(0,24).padEnd(26)} ccy=${l.budgetCurrency} min=${l.budgetMin} → with team: "${displayBudget(l)}"`);
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
