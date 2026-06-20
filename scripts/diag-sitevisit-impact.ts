// READ-ONLY: how many leads' remark-derived Site-Visit count drops under the new
// rule? Replicates the OLD loose SITE_VISIT_DONE (pre-fix) and compares to the
// NEW classifyText, per remark segment, across all live leads.
import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { parseRemarksTimeline, classifyText } from "../src/lib/remarkParser";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });

// OLD logic (verbatim pre-fix loose patterns) — the parts that caused false visits.
const DONE = "(?:done|completed|complete|finished|happened|conducted|concluded|wrapped\s*up)\b";
const AUX = "(?:is\s+|was\s+|are\s+|were\s+|got\s+|has\s+been\s+|have\s+been\s+|already\s+|just\s+|now\s+|successfully\s+)?";
const OLD_SV = new RegExp(
  `site\s*visit\s+${AUX}${DONE}`
  + `|(?:did|completed|finished|conducted|attended)\s+(?:the\s+|a\s+|his\s+|her\s+|their\s+)?site\s*visit`
  + `|visited\s+(?:the\s+)?(?:site|project|property|flat|apartment|unit|sample\s*flat|tower)`
  + `|(?:site|project)\s+visited`
  + `|came\s+(?:to|down\s+to)\s+(?:the\s+)?(?:site|project)`
  + `|came\s+for\s+(?:the\s+|a\s+)?(?:site\s*)?visit\b`
  + `|went\s+to\s+(?:the\s+)?(?:site|project)\b`
  + `|saw\s+(?:the\s+|a\s+)?(?:sample|actual|model|show)\s*(?:flat|apartment|apt|unit|home|villa|house|property)?\b`
  + `|shown\s+(?:the\s+|a\s+)?(?:sample|actual|model)?\s*(?:flat|apartment|apt|unit|home|villa|property)\b`
  + `|(?:sample|actual|model)\s*(?:flat|apartment|apt|unit|home|villa)?\s+(?:was\s+|got\s+)?shown\b`
  + `|\bsv\s+done\b`, "i");

async function main(){
  const leads = await prisma.lead.findMany({ where: { deletedAt: null, remarks: { not: null } },
    select: { id: true, name: true, remarks: true } });
  let affected = 0, falseSegs = 0; const samples: string[] = [];
  for (const l of leads) {
    const entries = parseRemarksTimeline(l.remarks ?? "", []);
    let oldC = 0, newC = 0; let firstBad = "";
    for (const e of entries) {
      const t = (e.text ?? "").toLowerCase();
      const oldSV = OLD_SV.test(t);                 // old: any sample/saw/shown proxy counted
      const newSV = classifyText(e.text) === "SITE_VISIT";
      if (oldSV) oldC++;
      if (newSV) newC++;
      if (oldSV && !newSV && !firstBad) firstBad = e.text.slice(0, 70);
    }
    if (newC < oldC) { affected++; falseSegs += (oldC - newC); if (samples.length < 12) samples.push(`${l.name?.slice(0,22).padEnd(24)} − ${oldC}→${newC}  ${JSON.stringify(firstBad)}`); }
  }
  console.log(`Live leads scanned: ${leads.length}`);
  console.log(`Leads whose Site-Visit count DROPS (false visits removed): ${affected}`);
  console.log(`Total false Site-Visit segments removed: ${falseSegs}`);
  console.log(`\nSamples (lead · old→new · offending remark):`);
  samples.forEach(s => console.log(`  ${s}`));
  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
