import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const ist=(d:Date)=>new Intl.DateTimeFormat("en-GB",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Kolkata"}).format(d);
async function main(){
  const now = new Date();
  const future = await prisma.lead.findMany({ where:{ createdAt:{ gt: now } },
    select:{ id:true, name:true, createdAt:true, lastTouchedAt:true, importBatchId:true, rawImport:true },
    orderBy:{ createdAt:"asc" } });
  // Correction target = the real import moment (when the lead actually entered the CRM),
  // taken from its ImportBatch.createdAt. Truthful + non-destructive; rawImport keeps the
  // original sheet "Date" so the true lead-gen date can be set manually later.
  const batchIds = [...new Set(future.map(l=>l.importBatchId).filter(Boolean))] as string[];
  const batches = await prisma.importBatch.findMany({ where:{ id:{ in: batchIds } }, select:{ id:true, createdAt:true, fileName:true } });
  const bMap = new Map(batches.map(b=>[b.id, b]));
  const plan = future.map(l=>{
    const b = l.importBatchId ? bMap.get(l.importBatchId) : null;
    const target = b?.createdAt ?? now;
    const ri = l.rawImport as Record<string,unknown> | null;
    const sheetDate = ri ? (Object.entries(ri).find(([k])=>/^date$/i.test(k))?.[1] ?? Object.entries(ri).find(([k])=>/date/i.test(k))?.[1]) : undefined;
    return { id:l.id, name:l.name, before:l.createdAt, after:target, sheetDate, batch:b?.fileName };
  });
  // Backup BEFORE values
  const backup = { takenAt: now.toISOString(), reason:"fix future-dated createdAt (YASIR MIS import)", rows: plan.map(p=>({id:p.id, name:p.name, createdAt:p.before.toISOString(), targetCreatedAt:p.after.toISOString(), sheetDate:p.sheetDate})) };
  const path = `backups/future-dates-backup.json`;
  writeFileSync(new URL(`../${path}`, import.meta.url), JSON.stringify(backup,null,2));
  console.log(`DRY-RUN — ${plan.length} future-dated leads. Backup → ${path}\n`);
  console.log("BEFORE (stored)            →  AFTER (proposed)          | sheet Date | name");
  plan.slice(0,12).forEach(p=>console.log(`  ${ist(p.before).padEnd(24)} →  ${ist(p.after).padEnd(24)} | ${String(p.sheetDate??"?").padEnd(10)} | ${p.name}`));
  if (plan.length>12) console.log(`  …and ${plan.length-12} more (all in backup file)`);
  const months = new Map<string,number>();
  plan.forEach(p=>{ const k=new Intl.DateTimeFormat("en-GB",{month:"short",year:"numeric",timeZone:"Asia/Kolkata"}).format(p.before); months.set(k,(months.get(k)||0)+1); });
  console.log(`\nBy (wrong) month: ${[...months].map(([k,v])=>`${k}:${v}`).join("  ")}`);
  console.log(`Batches affected: ${[...new Set(plan.map(p=>p.batch))].join(", ")}`);
  console.log("\nNO WRITES PERFORMED. Awaiting approval to apply.");
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
