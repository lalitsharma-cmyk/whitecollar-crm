import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const ist = (d: Date|null) => d ? new Intl.DateTimeFormat("en-GB",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Kolkata"}).format(d) : "—";
async function main(){
  const ids = { "Tanishk Garg":"cmqlzb04u0003l104gwrcfele", "Aleena":"cmqlufuas0019jl04h41ja8xf", "Jayakrishna":"cmqlns1vw0014l404143t18t4" };
  for (const [name,id] of Object.entries(ids)) {
    const a = await prisma.assignment.findMany({ where:{ leadId:id }, orderBy:{ assignedAt:"asc" }, select:{ userId:true, reason:true, assignedAt:true } });
    console.log(`\n▸ ${name}  — Assignment rows (${a.length}):`);
    for (const r of a) {
      const u = await prisma.user.findUnique({ where:{ id:r.userId }, select:{ name:true } });
      console.log(`   ${ist(r.assignedAt)}  → ${u?.name ?? r.userId}   reason: ${JSON.stringify(r.reason)}`);
    }
    // also notifications of kind AUTO_ASSIGN_FIRED / LEAD_ASSIGNED for this lead
    const n = await prisma.notification.findMany({ where:{ leadId:id, kind:{ in:["AUTO_ASSIGN_FIRED","LEAD_ASSIGNED"] } }, select:{ kind:true, title:true, createdAt:true } });
    for (const x of n) console.log(`     notif: ${ist(x.createdAt)} ${x.kind} — ${x.title}`);
  }
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
