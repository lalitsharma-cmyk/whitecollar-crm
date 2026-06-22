import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
async function main(){
  const p = "7428085010";
  // Replicate getDuplicateIntent's match with ADMIN scope ({}) — i.e. NO deletedAt filter.
  const adminView = await prisma.lead.findMany({ where:{ OR:[{ phone:{ endsWith:p } },{ altPhone:{ endsWith:p } }] },
    select:{ id:true, name:true, phone:true, currentStatus:true, leadOrigin:true, createdAt:true, deletedAt:true } });
  console.log(`ADMIN view (no deletedAt filter) — phone/altPhone endsWith ${p}: ${adminView.length}`);
  for (const r of adminView) console.log(`  ${r.id} created=${r.createdAt.toISOString().slice(0,10)} deleted=${r.deletedAt?r.deletedAt.toISOString().slice(0,10):"no"} origin=${r.leadOrigin} status=${r.currentStatus} ${r.name} ${r.phone}`);
  const withFilter = adminView.filter(r=>!r.deletedAt);
  console.log(`\nWith deletedAt:null filter (CORRECT): ${withFilter.length}  ·  deleted being wrongly counted: ${adminView.length-withFilter.length}`);
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
