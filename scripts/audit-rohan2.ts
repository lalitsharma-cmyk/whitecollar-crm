import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const last10 = (s?:string|null)=>(s??"").replace(/\D/g,"").slice(-10);
async function main(){
  const rohan = await prisma.lead.findFirst({ where:{ name:{ contains:"Rohan Agg", mode:"insensitive" } },
    select:{ id:true, name:true, phone:true, email:true, deletedAt:true } });
  if(!rohan){ console.log("no Rohan"); return; }
  console.log(`Active Rohan: ${rohan.id} phone=${JSON.stringify(rohan.phone)} email=${JSON.stringify(rohan.email)} deleted=${!!rohan.deletedAt}`);
  const pk = last10(rohan.phone), ek = (rohan.email??"").toLowerCase();
  // Scan ALL leads (active+deleted), match by normalized last10 phone OR email.
  const all = await prisma.lead.findMany({ select:{ id:true, name:true, phone:true, email:true, currentStatus:true, createdAt:true, deletedAt:true } });
  const matches = all.filter(l => (pk && last10(l.phone)===pk) || (ek && (l.email??"").toLowerCase()===ek));
  console.log(`\nMatches by normalized phone(${pk})/email(${ek}): ${matches.length}`);
  console.log(`record_id                       created_at        deleted_at        status               name`);
  for (const r of matches) console.log(`${r.id}  ${r.createdAt.toISOString().slice(0,16)}  ${r.deletedAt?r.deletedAt.toISOString().slice(0,16):"—            "}  ${(r.currentStatus??"—").padEnd(20)} ${r.name}`);
  console.log(`\nactive: ${matches.filter(r=>!r.deletedAt).length} · deleted: ${matches.filter(r=>r.deletedAt).length}`);
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
