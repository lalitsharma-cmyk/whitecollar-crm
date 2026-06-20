import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { displayBudget } from "../src/lib/budgetParse";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const mFmt = /\b\d[\d.,]*\s*(m|mn|million|aed|dhs|k)\b/i;  // "shows millions/AED" pattern
async function main(){
  const india = await prisma.lead.findMany({
    where: { deletedAt: null, forwardedTeam: "India", OR:[{budgetRaw:{not:null}},{budgetMin:{not:null}}] },
    select: { name:true, forwardedTeam:true, budgetRaw:true, budgetMin:true, budgetMax:true, budgetCurrency:true, owner:{select:{name:true}} },
  });
  console.log(`India-team leads with a budget: ${india.length}`);
  // currency distribution
  const ccy: Record<string,number> = {};
  let badDisplay = 0;
  const samples: string[] = [];
  for (const l of india) {
    ccy[l.budgetCurrency ?? "null"] = (ccy[l.budgetCurrency ?? "null"]??0)+1;
    const disp = displayBudget(l);
    if (mFmt.test(disp)) { badDisplay++; if (samples.length<14) samples.push(`${(l.owner?.name??"—").slice(0,10).padEnd(11)} raw=${JSON.stringify(l.budgetRaw).padEnd(14)} min=${l.budgetMin} ccy=${l.budgetCurrency}  → shows "${disp}"`); }
  }
  console.log(`budgetCurrency distribution:`, ccy);
  console.log(`\nIndia leads whose budget DISPLAYS as M/AED/K (the bug): ${badDisplay}`);
  samples.forEach(s=>console.log("  "+s));
  // Tanuj specifically
  const tanuj = india.filter(l=>/tanuj/i.test(l.owner?.name??""));
  console.log(`\nTanuj India leads: ${tanuj.length}, showing M/AED: ${tanuj.filter(l=>mFmt.test(displayBudget(l))).length}`);
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
