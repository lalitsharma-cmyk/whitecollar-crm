import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
for (const line of env.split("\n")) {
  const m = /^([A-Z_]+)="?([^"\n]*)"?/.exec(line.trim());
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
}
async function main() {
  const { runFollowupRollover } = await import("../src/lib/followupRollover");
  const r = await runFollowupRollover(new Date(), { dryRun: true });
  console.log(`DRY-RUN — would move ${r.moved} follow-ups → ${r.targetDateLabel}`);
  console.log(`cutoff (IST start of tomorrow): ${r.cutoffISO}`);
  r.examples.forEach(e => console.log(`  ${(e.name??"—").slice(0,22).padEnd(24)} ${e.from}  →  ${e.to}`));
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
