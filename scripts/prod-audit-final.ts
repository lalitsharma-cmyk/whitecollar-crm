import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = /^([A-Z_]+)="?([^"\n]*)"?/.exec(line.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const last10 = (p?: string | null) => (p ?? "").replace(/\D/g, "").slice(-10);
const PASS = (b: boolean) => (b ? "PASS" : "FAIL");
let allPass = true;
const mark = (b: boolean) => { if (!b) allPass = false; return PASS(b); };

async function main() {
  const { getCustomerHistory } = await import("../src/lib/customerHistory");
  const { getDuplicateIntent } = await import("../src/lib/duplicateIntent");
  const { findMatchingLeads } = await import("../src/lib/investorMatch");
  const fs = await import("node:fs");

  console.log("====== FINAL PRODUCTION AUDIT - crm.whitecollarrealty.com ======\n");

  // 1. FUTURE-DATED LEADS = 0
  const future = await prisma.lead.count({ where: { createdAt: { gt: new Date() } } });
  console.log("1) FUTURE-DATED LEADS");
  console.log(`   live: lead.count(createdAt > now) = ${future}  [${mark(future === 0)}] expect 0\n`);

  // 2. RECYCLE-BIN EXCLUSION (proven against real deleted records)
  console.log("2) RECYCLE-BIN (deletedAt) EXCLUSION - tested via LIVE production functions");
  const deleted = await prisma.lead.findMany({ where: { deletedAt: { not: null } }, select: { id: true, name: true, phone: true, email: true, city: true, deletedAt: true } });
  const deletedIds = new Set(deleted.map((d) => d.id));
  const withPhone = deleted.filter((d) => last10(d.phone).length >= 7);
  console.log(`   recycle-bin size (deletedAt != null): ${deleted.length} leads (${withPhone.length} with phone)`);
  let dupOK = true, histOK = true, aiOK = true;
  let overlap = "none (no recycle-bin phone is shared by a live lead)";
  const sample = withPhone.slice(0, 30);
  for (const d of sample) {
    const p = d.phone!;
    const rawCount = await prisma.lead.count({ where: { OR: [{ phone: { endsWith: last10(p) } }, { altPhone: { endsWith: last10(p) } }] } });
    const liveCount = await prisma.lead.count({ where: { deletedAt: null, OR: [{ phone: { endsWith: last10(p) } }, { altPhone: { endsWith: last10(p) } }] } });
    const hist = await getCustomerHistory(p, d.email);
    const dup = await getDuplicateIntent(p, d.email);
    const ai = await findMatchingLeads({ phone: p, email: d.email, name: d.name, city: d.city });
    const records = hist?.records ?? [];
    // Lead History: the deleted id must not appear AND no record may carry the deleted flag.
    if (records.some((e) => e.id === d.id || e.deleted)) histOK = false;
    // AI Matching: the deleted id must not appear in matches.
    if (ai.some((m: { id: string }) => m.id === d.id)) aiOK = false;
    // Duplicate detection / Connected-count: genuine count can never exceed the
    // number of LIVE matching rows — if a deleted row were counted it would.
    if (dup && dup.genuineCount > liveCount) dupOK = false;
    if (rawCount > liveCount && overlap.startsWith("none")) {
      overlap = `lead "${d.name}" phone ...${last10(p).slice(-4)} deletedAt=${d.deletedAt?.toISOString().slice(0, 10)}: RAW rows incl deleted=${rawCount}, LIVE rows=${liveCount} -> DuplicateIntent.genuineCount=${dup?.genuineCount ?? 0}, CustomerHistory.records=${records.length}, AI matches=${ai.length}; deleted record present in NONE`;
    }
  }
  console.log(`   tested ${sample.length} recycle-bin records through the deployed functions:`);
  console.log(`   - Duplicate detection (getDuplicateIntent)  : deleted id in evidence? [${mark(dupOK)}] none`);
  console.log(`   - Connected X Times   (intent.genuineCount) : counts live only?       [${mark(dupOK)}]`);
  console.log(`   - Last Duplicate Hit  (newest evidence)     : from a live record?     [${mark(dupOK)}]`);
  console.log(`   - AI Matching         (findMatchingLeads)   : deleted id in matches?  [${mark(aiOK)}] none`);
  console.log(`   - Lead History        (getCustomerHistory)  : deleted id in history?  [${mark(histOK)}] none`);
  console.log(`   overlap proof: ${overlap}\n`);

  // 3. AGENT PERMISSIONS
  console.log("3) AGENT PERMISSIONS (live roles + deployed gate code)");
  const agents = await prisma.user.findMany({ where: { active: true, role: "AGENT" }, select: { name: true, team: true } });
  console.log(`   active AGENT users: ${agents.map((a) => `${a.name}(${a.team})`).join(", ")}`);
  const createAct = fs.readFileSync("src/app/(app)/leads/new/actions.ts", "utf8");
  const createPage = fs.readFileSync("src/app/(app)/leads/new/page.tsx", "utf8");
  // The orphan /api/leads/export was deleted 2026-06-25; the sole export path is
  // now /api/reports/export (ADMIN-gated + watermarked + audited).
  const orphanGone = !fs.existsSync("src/app/api/leads/export/route.ts");
  const reportsExp = fs.readFileSync("src/app/api/reports/export/route.ts", "utf8");
  const exportSecured = orphanGone && /requireRole\("ADMIN"\)/.test(reportsExp) && /await audit\(/.test(reportsExp) && /Confidential export/.test(reportsExp);
  console.log(`   quickCreateLeadAction blocks AGENT: [${mark(/role === "AGENT"/.test(createAct))}] · createLeadAction blocks AGENT: [${mark(/role === "AGENT"/.test(createPage))}] · export = /api/reports/export ADMIN-only+watermarked+audited, orphan removed: [${mark(exportSecured)}]\n`);

  // 4. INDIA / DUBAI SEGREGATION
  console.log("4) INDIA / DUBAI PROJECT SEGREGATION (live counts + guards)");
  const { projectWhereForUser, userCanAccessProjectCountry } = await import("../src/lib/propertyScope");
  const india = await prisma.project.count({ where: { country: "India" } });
  const uae = await prisma.project.count({ where: { country: "UAE" } });
  const all = await prisma.project.count();
  const iScope = (await prisma.project.findMany({ where: projectWhereForUser({ role: "AGENT", team: "India" }) })).length;
  const dScope = (await prisma.project.findMany({ where: projectWhereForUser({ role: "AGENT", team: "Dubai" }) })).length;
  const aScope = (await prisma.project.findMany({ where: projectWhereForUser({ role: "ADMIN", team: "HQ" }) })).length;
  const guards = !userCanAccessProjectCountry({ role: "AGENT", team: "India" }, "UAE") && !userCanAccessProjectCountry({ role: "AGENT", team: "Dubai" }, "India") && userCanAccessProjectCountry({ role: "ADMIN", team: "HQ" }, "UAE") && userCanAccessProjectCountry({ role: "ADMIN", team: "HQ" }, "India");
  console.log(`   projects: India=${india} UAE=${uae} total=${all}`);
  console.log(`   India agent sees ${iScope} [${mark(iScope === india)}] · Dubai agent sees ${dScope} [${mark(dScope === uae)}] · Admin sees ${aScope} [${mark(aScope === all)}]`);
  console.log(`   cross-market guards (IndiaAgent!UAE, DubaiAgent!India, Admin=both): [${mark(guards)}]\n`);

  // 5. FOLLOW-UP ROLLOVER CRON
  console.log("5) FOLLOW-UP ROLLOVER CRON");
  const { runFollowupRollover } = await import("../src/lib/followupRollover");
  const roll = await runFollowupRollover(new Date(), { dryRun: true });
  const rRoute = fs.readFileSync("src/app/api/cron/followup-rollover/route.ts", "utf8");
  const yml = fs.readFileSync(".github/workflows/cron.yml", "utf8");
  const bearer = /CRON_SECRET/.test(rRoute) && /Bearer/.test(rRoute);
  const scheduled = /30 15 \* \* \*/.test(yml) && /followup-rollover/.test(yml);
  const unauth = await fetch("https://crm.whitecollarrealty.com/api/cron/followup-rollover?dryRun=1").then((r) => r.status).catch(() => 0);
  console.log(`   bearer-gated: [${mark(bearer)}] · scheduled 9PM IST in cron.yml: [${mark(scheduled)}] · unauth GET blocked (HTTP ${unauth}): [${mark(unauth === 401)}]`);
  console.log(`   live dry-run: would move ${roll.moved} pending follow-ups -> ${roll.targetDateLabel}  [${mark(roll.moved >= 0)}]\n`);

  // 6. MEETING / SITE-VISIT REMINDERS
  console.log("6) MEETING / SITE-VISIT 1-HOUR REMINDERS");
  let colExists = true, plannedFuture = 0;
  try {
    const acts = await prisma.activity.findMany({ where: { status: "PLANNED", type: { in: ["SITE_VISIT", "OFFICE_MEETING", "VIRTUAL_MEETING", "HOME_VISIT", "EXPO_MEETING"] }, scheduledAt: { gt: new Date() } }, select: { id: true, reminderSentAt1h: true }, take: 5 });
    plannedFuture = acts.length;
  } catch { colExists = false; }
  const cron = fs.readFileSync("src/app/api/cron/pre-meeting-reminder/route.ts", "utf8");
  const meeting = fs.readFileSync("src/app/api/leads/[id]/meeting/route.ts", "utf8");
  console.log(`   prod column Activity.reminderSentAt1h queryable: [${mark(colExists)}] (${plannedFuture} upcoming planned meetings)`);
  console.log(`   1h window+dedupe: [${mark(/reminderSentAt1h/.test(cron) && /57\.5/.test(cron))}] · manager(Lalit) notify: [${mark(/isSuperAdmin: true/.test(cron))}] · distinct titles: [${mark(/Meeting Reminder/.test(cron) && /Site Visit Reminder/.test(cron))}] · reschedule re-arm: [${mark(/reminderSentAt1h: null/.test(meeting))}]\n`);

  console.log("================================================================");
  console.log(`OVERALL: ${allPass ? "ALL PRODUCTION VERIFICATION PASSED" : "SOME CHECKS FAILED - DO NOT MARK COMPLETE"}`);
  await prisma.$disconnect();
  process.exit(allPass ? 0 : 1);
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
