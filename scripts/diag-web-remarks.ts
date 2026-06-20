import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
async function main(){
  const leads = await prisma.lead.findMany({ where:{ deletedAt:null, source:"WEBSITE" }, orderBy:{createdAt:"desc"}, take:8,
    select:{ id:true, name:true, createdAt:true, sourceRaw:true, sourceDetail:true, notesShort:true, rawRemarks:true, remarks:true } });
  for (const l of leads) {
    console.log(`\n▸ ${l.name}  ${l.createdAt.toISOString().slice(0,16)}`);
    console.log(`   sourceRaw=${JSON.stringify(l.sourceRaw)}  sourceDetail=${JSON.stringify(l.sourceDetail)}`);
    console.log(`   notesShort=${JSON.stringify(l.notesShort)}`);
    console.log(`   rawRemarks=${JSON.stringify(l.rawRemarks)}  remarks=${JSON.stringify(l.remarks)}`);
    const acts = await prisma.activity.findMany({ where:{ leadId:l.id }, select:{ type:true, title:true, description:true, completedAt:true }, take:4, orderBy:{createdAt:"asc"} });
    for (const a of acts) console.log(`     act ${a.type}: title=${JSON.stringify(a.title)} desc=${JSON.stringify(a.description)}`);
  }
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
