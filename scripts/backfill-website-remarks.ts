// Seed existing WEBSITE leads' form message into Conversation History (rawRemarks)
// at the lead-generated time (IST). Skips source-echoes + blanks + leads that
// already have rawRemarks. Also strips a leading source-echo line if present (#3).
//   npx tsx scripts/backfill-website-remarks.ts [--apply]
import { readFileSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { websiteMessageRemark, isSourceEcho } from "../src/lib/websiteRemark";
import { parseRemarksTimeline } from "../src/lib/remarkParser";
const APPLY = process.argv.includes("--apply");
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
async function main(){
  const leads = await prisma.lead.findMany({ where:{ deletedAt:null, source:"WEBSITE" },
    select:{ id:true, name:true, createdAt:true, notesShort:true, rawRemarks:true, remarks:true, sourceRaw:true, sourceDetail:true } });
  const plan: { id:string; name:string; remark:string }[] = [];
  let skipEcho=0, skipBlank=0, skipHasRaw=0;
  for (const l of leads) {
    if ((l.rawRemarks ?? "").trim()) { skipHasRaw++; continue; }   // already has conversation
    const msg = (l.notesShort ?? "").trim();
    if (!msg) { skipBlank++; continue; }
    if (isSourceEcho(msg, l.sourceRaw, l.sourceDetail)) { skipEcho++; continue; }
    const remark = websiteMessageRemark(msg, l.createdAt, { tag:"Website / Client Message", sourceRaw:l.sourceRaw, sourceDetail:l.sourceDetail });
    if (remark) plan.push({ id:l.id, name:l.name ?? "—", remark });
  }
  console.log(`WEBSITE leads: ${leads.length}`);
  console.log(`  → backfill message into Conversation History: ${plan.length}`);
  console.log(`  skipped: ${skipHasRaw} already have rawRemarks · ${skipBlank} no message · ${skipEcho} message was just the source/campaign name`);
  // verify the Smart Timeline dates the first few correctly
  for (const p of plan.slice(0,4)) {
    const ev = parseRemarksTimeline(p.remark, [])[0];
    const ist = ev?.date ? new Intl.DateTimeFormat("en-GB",{dateStyle:"medium",timeStyle:"short",timeZone:"Asia/Kolkata"}).format(ev.date) : "∅";
    console.log(`   ${p.name.slice(0,20).padEnd(22)} → timeline ${ist}  ${JSON.stringify(p.remark.slice(0,60))}`);
  }
  if (!APPLY) { console.log("\nDRY-RUN — re-run with --apply."); await prisma.$disconnect(); return; }
  const stamp = new Date().toISOString().replace(/[:.]/g,"-");
  const backup = await prisma.lead.findMany({ where:{ id:{ in: plan.map(p=>p.id) } }, select:{ id:true, rawRemarks:true, remarks:true } });
  writeFileSync(new URL(`../backups/website-remarks-${stamp}.json`, import.meta.url), JSON.stringify(backup, null, 2));
  let n=0; for (const p of plan) { await prisma.lead.update({ where:{ id:p.id }, data:{ rawRemarks:p.remark, remarks:p.remark } }); n++; }
  console.log(`✅ Backfilled ${n} website leads' Conversation History. Backup saved.`);
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
