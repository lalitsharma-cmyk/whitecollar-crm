import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
async function main(){
  for (const kw of ["YASIR","Yasir","Dinesh","DINESH"]) {
    const bs = await prisma.importBatch.findMany({ where: { fileName: { contains: kw } }, orderBy:{createdAt:"desc"},
      select:{ id:true, fileName:true, createdAt:true, createdCount:true, updatedCount:true } });
    for (const b of bs) {
      const total = await prisma.lead.count({ where:{ importBatchId:b.id, deletedAt:null } });
      const empty = await prisma.lead.count({ where:{ importBatchId:b.id, deletedAt:null, OR:[{rawRemarks:null},{rawRemarks:""}] } });
      console.log(`[${kw}] ${b.createdAt.toISOString().slice(0,16)} "${b.fileName}" created:${b.createdCount} upd:${b.updatedCount} · leads:${total} · EMPTY-conv:${empty}  [${b.id}]`);
    }
  }
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
