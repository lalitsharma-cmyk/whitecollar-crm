import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
async function main(){
  for (const kw of ["YASIR MIS.xlsx","Dinesh Gill MIS.xlsx"]) {
    const b = await prisma.importBatch.findFirst({ where:{ fileName: kw }, orderBy:{createdAt:"desc"} });
    if(!b) continue;
    const l = await prisma.lead.findFirst({ where:{ importBatchId:b.id, deletedAt:null, rawRemarks:{not:null} }, select:{ name:true, phone:true, rawRemarks:true, remarks:true } });
    console.log(`\n[${kw}] ${l?.name} (${l?.phone})`);
    console.log(`   rawRemarks (${l?.rawRemarks?.length} chars): ${JSON.stringify(l?.rawRemarks?.slice(0,160))}`);
    console.log(`   remarks set: ${(l?.remarks??"").length>0 ? "yes" : "no"}`);
  }
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
