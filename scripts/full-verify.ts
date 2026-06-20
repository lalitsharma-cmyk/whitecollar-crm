import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const dbUrl = /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1]!;
const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
const t = async (label: string, fn: () => Promise<any>) => {
  const s = Date.now(); const r = await fn(); const ms = Date.now() - s;
  console.log(`  ${ms.toString().padStart(5)}ms  ${label}${typeof r === "number" || typeof r === "string" ? `  → ${r}` : ""}`);
  return r;
};
async function main(){
  const { leadSortTier, isFreshStatus, TERMINAL_STATUSES } = await import("../src/lib/lead-statuses");
  const { projectWhereForUser, userCanAccessProjectCountry } = await import("../src/lib/propertyScope");
  const { runFollowupRollover } = await import("../src/lib/followupRollover");

  console.log("═══ SPEED (prod DB, cold) ═══");
  await t("lead.count() total", () => prisma.lead.count());
  await t("project.count() total", () => prisma.project.count());
  const workableWhere = { deletedAt: null, currentStatus: { notIn: TERMINAL_STATUSES }, isColdCall: false };
  await t("6-tier pre-query (all workable, id+status+fu+created)", async () =>
    (await prisma.lead.findMany({ where: workableWhere, select: { id:true, currentStatus:true, followupDate:true, createdAt:true } })).length);
  await t("project scope query (India agent)", async () =>
    (await prisma.project.findMany({ where: projectWhereForUser({ role:"AGENT", team:"India" }), select:{id:true} })).length);
  const now = new Date();
  const istW = { gte: new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate(),-5,30)), lt: new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1,-5,30)) };
  await t("dashboard meetings-today count", () => prisma.activity.count({ where: { type:{ in:["OFFICE_MEETING","HOME_VISIT","EXPO_MEETING"] }, status:"PLANNED", scheduledAt: istW } }));

  console.log("\n═══ PROJECT MARKET SEGREGATION (real data) ═══");
  const india = await prisma.project.count({ where: { country: "India" } });
  const uae = await prisma.project.count({ where: { country: "UAE" } });
  const total = await prisma.project.count();
  console.log(`  Projects: India=${india}  UAE=${uae}  total=${total}`);
  console.log(`  India agent scope count = ${(await prisma.project.findMany({ where: projectWhereForUser({role:"AGENT",team:"India"}) })).length} (expect ${india})`);
  console.log(`  Dubai agent scope count = ${(await prisma.project.findMany({ where: projectWhereForUser({role:"AGENT",team:"Dubai"}) })).length} (expect ${uae})`);
  console.log(`  Admin scope count       = ${(await prisma.project.findMany({ where: projectWhereForUser({role:"ADMIN",team:"HQ"}) })).length} (expect ${total})`);
  console.log(`  Guard: IndiaAgent→UAE=${userCanAccessProjectCountry({role:"AGENT",team:"India"},"UAE")} (expect false) · DubaiAgent→India=${userCanAccessProjectCountry({role:"AGENT",team:"Dubai"},"India")} (expect false) · Admin→both=${userCanAccessProjectCountry({role:"ADMIN",team:"HQ"},"UAE")&&userCanAccessProjectCountry({role:"ADMIN",team:"HQ"},"India")} (expect true)`);

  console.log("\n═══ 6-TIER SORT (real Yasir=India-agent leads) ═══");
  const yasir = await prisma.user.findFirst({ where: { email: { contains: "saleswhitecollar", mode:"insensitive" } }, select:{id:true,name:true} });
  if (yasir) {
    const rows = await prisma.lead.findMany({ where: { ownerId: yasir.id, deletedAt:null, currentStatus:{ notIn: TERMINAL_STATUSES } }, select:{ name:true, currentStatus:true, followupDate:true, createdAt:true } });
    const tally: Record<number,number> = {1:0,2:0,3:0,4:0,5:0,6:0};
    rows.forEach(r => tally[leadSortTier(r, istW)]++);
    console.log(`  ${yasir.name}: ${rows.length} workable leads → tiers ${JSON.stringify(tally)}`);
    const sorted = [...rows].sort((a,b)=>{const pa=leadSortTier(a,istW),pb=leadSortTier(b,istW); return pa!==pb?pa-pb:b.createdAt.getTime()-a.createdAt.getTime();});
    console.log("  top 5 (what Yasir sees first):");
    sorted.slice(0,5).forEach(r=>console.log(`    [tier ${leadSortTier(r,istW)}] ${(r.name??"—").slice(0,20).padEnd(22)} status=${r.currentStatus??"(fresh)"}`));
  }

  console.log("\n═══ DATA INTEGRITY ═══");
  console.log(`  future-dated leads (should be 0): ${await prisma.lead.count({ where: { createdAt: { gt: new Date() } } })}`);
  const roll = await runFollowupRollover(new Date(), { dryRun: true });
  console.log(`  follow-up rollover would move tonight: ${roll.moved} → ${roll.targetDateLabel}`);

  await prisma.$disconnect();
}
main().catch(e=>{console.error(e);return prisma.$disconnect().then(()=>process.exit(1));});
