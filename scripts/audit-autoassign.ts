// READ-ONLY audit. Today's website lead(s) + the EXACT assignment trail. Zero writes.
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const ist = (d: Date|null) => d ? new Intl.DateTimeFormat("en-GB",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Kolkata"}).format(d) : "—";

async function main(){
  // IST "today" window → UTC bounds. Today = 2026-06-20 IST.
  const startIST = new Date("2026-06-20T00:00:00+05:30");
  const endIST   = new Date("2026-06-21T00:00:00+05:30");
  const leads = await prisma.lead.findMany({
    where: { createdAt: { gte: startIST, lt: endIST },
      OR: [{ source: "WEBSITE" }, { sourceRaw: { contains: "website", mode: "insensitive" } }] },
    orderBy: { createdAt: "desc" },
    select: { id:true, name:true, createdAt:true, source:true, sourceRaw:true, ownerId:true, assignedAt:true,
      forwardedTeam:true, leadOrigin:true, isColdCall:true, routingMethod:true, routingSource:true, routingReason:true,
      owner:{select:{name:true,email:true,team:true}}, importBatchId:true },
  });
  console.log(`\n═══ TODAY's WEBSITE LEADS (IST 2026-06-20): ${leads.length} ═══`);
  for (const l of leads) {
    console.log(`\n▸ ${l.name}  [${l.id}]`);
    console.log(`   created:     ${ist(l.createdAt)} IST`);
    console.log(`   source:      ${l.source}  · sourceRaw: ${JSON.stringify(l.sourceRaw)}`);
    console.log(`   ASSIGNED TO: ${l.owner ? `${l.owner.name} (${l.owner.email}, team ${l.owner.team})` : "— UNASSIGNED —"}  · assignedAt: ${ist(l.assignedAt)}`);
    console.log(`   team: ${l.forwardedTeam}  origin: ${l.leadOrigin}  cold: ${l.isColdCall}  importBatch: ${l.importBatchId ?? "none (real-time)"}`);
    console.log(`   routingMethod: ${JSON.stringify(l.routingMethod)}  routingSource: ${JSON.stringify(l.routingSource)}`);
    console.log(`   routingReason: ${JSON.stringify(l.routingReason)}`);
    // ownerId history
    const hist = await prisma.leadFieldHistory.findMany({ where: { leadId: l.id, field: "ownerId" }, orderBy:{changedAt:"asc"}, select:{ oldValue:true, newValue:true, source:true, changedById:true, changedAt:true } });
    console.log(`   ownerId history (${hist.length}):`);
    for (const h of hist) console.log(`      ${ist(h.changedAt)}  ${h.oldValue ?? "∅"} → ${h.newValue ?? "∅"}  via "${h.source}"  by ${h.changedById ?? "system"}`);
    // audit logs for this lead
    const al = await prisma.auditLog.findMany({ where: { entityId: l.id }, orderBy:{createdAt:"asc"},
      select: { action:true, userId:true, createdAt:true, meta:true } });
    console.log(`   audit logs (${al.length}):`);
    for (const a of al) console.log(`      ${ist(a.createdAt)}  ${a.action}  by ${a.userId ?? "system"}  ${JSON.stringify(a.meta).slice(0,120)}`);
  }
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
