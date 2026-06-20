import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
async function main(){
  const subs = await prisma.pushSubscription.groupBy({ by:["userId"], _count:{_all:true} });
  console.log(`pushSubscription rows: ${subs.reduce((a,s)=>a+s._count._all,0)} across ${subs.length} users`);
  for (const s of subs.slice(0,12)) { const u = await prisma.user.findUnique({where:{id:s.userId},select:{name:true,role:true}}); console.log(`  ${u?.name} (${u?.role}): ${s._count._all} device(s)`); }
  await prisma.$disconnect();
}
main().catch(e=>{console.error(String(e).slice(0,200));return prisma.$disconnect().then(()=>process.exit(1));});
