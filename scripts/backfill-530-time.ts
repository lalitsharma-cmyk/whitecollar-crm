import { readFileSync, writeFileSync } from "node:fs";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m=/^([A-Z_]+)="?([^"\n]*)"?/.exec(line.trim()); if (m && !process.env[m[1]]) process.env[m[1]]=m[2]; }
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const apply = process.argv.includes("--apply");
(async () => {
  const all = await p.lead.findMany({ where: { deletedAt: null }, select: { id:true, createdAt:true, lastTouchedAt:true } });
  // exactly 00:00:00 UTC = the fabricated 05:30 IST
  const hit = all.filter(l => l.createdAt.getUTCHours()===0 && l.createdAt.getUTCMinutes()===0 && l.createdAt.getUTCSeconds()===0);
  console.log(`${apply?"APPLY":"DRY-RUN"} — ${hit.length} leads at 00:00 UTC (05:30 IST) → noon IST (06:30 UTC), same date`);
  if (!apply) { console.log("re-run with --apply to write"); await p.$disconnect(); return; }
  // backup
  writeFileSync(new URL("../backups/backfill-530-backup.json", import.meta.url), JSON.stringify(hit.map(h=>({id:h.id, createdAt:h.createdAt.toISOString()})), null, 0));
  let done = 0;
  for (const l of hit) {
    const d = l.createdAt;
    const noon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 6, 30, 0)); // noon IST
    const data: any = { createdAt: noon };
    // if lastTouchedAt was also the midnight artifact, lift it too
    if (l.lastTouchedAt && l.lastTouchedAt.getUTCHours()===0 && l.lastTouchedAt.getUTCMinutes()===0) data.lastTouchedAt = noon;
    await p.lead.update({ where: { id: l.id }, data });
    done++;
  }
  const remain = (await p.lead.findMany({ where: { deletedAt: null }, select: { createdAt:true } })).filter(l=>l.createdAt.getUTCHours()===0&&l.createdAt.getUTCMinutes()===0&&l.createdAt.getUTCSeconds()===0).length;
  console.log(`updated ${done}; remaining at 05:30 IST: ${remain} (expect 0); backup → backups/backfill-530-backup.json`);
  await p.$disconnect();
})().catch(e=>{console.error(e);return p.$disconnect().then(()=>process.exit(1));});
