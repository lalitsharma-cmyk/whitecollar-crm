import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const ALLOWED = new Set(["Residential","Commercial","Mixed Use"]);
async function main(){
  const rows = await prisma.lead.groupBy({ by:["propertyType"], _count:{_all:true}, where:{deletedAt:null} });
  console.log("DISTINCT Lead.propertyType (deletedAt:null):");
  for (const r of rows.sort((a,b)=>b._count._all-a._count._all)) {
    const v = r.propertyType; const bad = v && !ALLOWED.has(v) ? "  ⚠ NOT ALLOWED" : "";
    console.log(`  ${String(r._count._all).padStart(4)}  ${JSON.stringify(v)}${bad}`);
  }
  // Bad ones: correlate with source / origin / batch
  const bad = await prisma.lead.findMany({ where:{ deletedAt:null, propertyType:{notIn:["Residential","Commercial","Mixed Use"], not:null} },
    select:{ name:true, propertyType:true, source:true, sourceRaw:true, leadOrigin:true, forwardedTeam:true,
      importBatch:{select:{fileName:true}} }, take:15 });
  console.log(`\nSAMPLE BAD propertyType leads (${bad.length} shown):`);
  for (const l of bad) console.log(`  pt=${JSON.stringify(l.propertyType).padEnd(12)} src=${l.source} raw=${JSON.stringify(l.sourceRaw||"").slice(0,18)} origin=${l.leadOrigin} team=${l.forwardedTeam} batch=${l.importBatch?.fileName??"—"}  ${l.name}`);
  const totalBad = await prisma.lead.count({ where:{ deletedAt:null, propertyType:{notIn:["Residential","Commercial","Mixed Use"], not:null} } });
  console.log(`\nTOTAL bad-propertyType leads: ${totalBad}`);
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
