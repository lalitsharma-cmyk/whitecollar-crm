import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const ist=(d:Date)=>new Intl.DateTimeFormat("en-GB",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Kolkata"}).format(d);
// Lalit (the actor for the audit trail)
const ACTOR_EMAIL = "LALITSHARMA@whitecollarrealty.com";
async function main(){
  const now = new Date();
  const actor = await prisma.user.findFirst({ where: { email: { equals: ACTOR_EMAIL, mode: "insensitive" } }, select: { id: true } });
  const future = await prisma.lead.findMany({ where:{ createdAt:{ gt: now } },
    select:{ id:true, name:true, createdAt:true, importBatchId:true } });
  console.log(`Future-dated leads to correct: ${future.length}`);
  const bIds = [...new Set(future.map(l=>l.importBatchId).filter(Boolean))] as string[];
  const batches = await prisma.importBatch.findMany({ where:{ id:{ in:bIds } }, select:{ id:true, createdAt:true } });
  const bMap = new Map(batches.map(b=>[b.id, b.createdAt]));
  let done = 0;
  for (const l of future) {
    const target = (l.importBatchId ? bMap.get(l.importBatchId) : null) ?? now;
    await prisma.$transaction([
      prisma.lead.update({ where:{ id:l.id }, data:{ createdAt: target, lastTouchedAt: target } }),
      prisma.leadFieldHistory.create({ data:{ leadId:l.id, field:"createdAt", oldValue:l.createdAt.toISOString(), newValue:target.toISOString(), changedById: actor?.id ?? null, source:"date-correction" } }),
    ]);
    done++;
  }
  console.log(`Updated ${done} leads (createdAt + lastTouchedAt → import time; audit row written).`);
  // VERIFY
  const remaining = await prisma.lead.count({ where:{ createdAt:{ gt: new Date() } } });
  console.log(`\nVERIFY — future-dated leads remaining: ${remaining}`);
  const sample = await prisma.lead.findMany({ where:{ id:{ in: future.slice(0,5).map(f=>f.id) } }, select:{ name:true, createdAt:true } });
  sample.forEach(s=>console.log(`  ${s.name?.padEnd(20)} now createdAt = ${ist(s.createdAt)}`));
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
