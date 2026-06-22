import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const last10 = (s?:string|null)=>(s??"").replace(/\D/g,"").slice(-10);
async function main(){
  // Find all Rohan Aggarwal records (incl. deleted) by name.
  const named = await prisma.lead.findMany({ where:{ name:{ contains:"Rohan", mode:"insensitive" } },
    select:{ id:true, name:true, phone:true, email:true, currentStatus:true, tags:true, createdAt:true, deletedAt:true, importBatchId:true } });
  const rohans = named.filter(l=>/aggarwal|agarwal/i.test(l.name??""));
  console.log(`"Rohan Aggarwal"-ish records: ${rohans.length}`);
  const phones = new Set(rohans.map(r=>last10(r.phone)).filter(Boolean));
  const emails = new Set(rohans.map(r=>(r.email??"").toLowerCase()).filter(Boolean));
  // All records matching those phones/emails (active + deleted)
  const all = await prisma.lead.findMany({ where:{ OR:[
      ...(phones.size?[{ phone:{ in:[...phones].flatMap(p=>[p,`+91${p}`,`91${p}`]) } }]:[]),
      ...(emails.size?[{ email:{ in:[...emails] } }]:[]),
      { name:{ contains:"Rohan Agg", mode:"insensitive" } },
    ] },
    select:{ id:true, name:true, phone:true, email:true, currentStatus:true, createdAt:true, deletedAt:true } });
  console.log(`\nrecord_id                       created_at        deleted_at        recycle_bin  status`);
  for (const r of all) {
    console.log(`${r.id}  ${r.createdAt.toISOString().slice(0,16)}  ${r.deletedAt?r.deletedAt.toISOString().slice(0,16):"—            "}  ${r.deletedAt?"YES":"no "}        ${r.currentStatus ?? "—"}   ${r.name}`);
  }
  console.log(`\nTotal matching: ${all.length}  ·  active: ${all.filter(r=>!r.deletedAt).length}  ·  deleted/recycled: ${all.filter(r=>r.deletedAt).length}`);
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
