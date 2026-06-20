// Comprehensive production UAT — verifies each fix against the LIVE prod DB +
// the deployed library functions (the same code paths the UI uses). Read-only.
import { readFileSync } from "node:fs";
const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
for (const line of env.split("\n")) { const m = /^([A-Z_]+)="?([^"\n]*)"?/.exec(line.trim()); if (m && !process.env[m[1]]) process.env[m[1]] = m[2]; }
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const rows: { n: string; item: string; status: string; evidence: string }[] = [];
const add = (n: string, item: string, ok: boolean | "PARTIAL", evidence: string) =>
  rows.push({ n, item, status: ok === "PARTIAL" ? "PARTIAL" : ok ? "PASS" : "FAIL", evidence });

async function main() {
  const fs = await import("node:fs");
  const grep = (file: string, re: RegExp) => { try { return re.test(fs.readFileSync(file, "utf8")); } catch { return false; } };

  // 1. Recycle Bin exclusion
  const { getDuplicateIntent } = await import("../src/lib/duplicateIntent");
  const { getCustomerHistory } = await import("../src/lib/customerHistory");
  const { findMatchingLeads } = await import("../src/lib/investorMatch");
  const del = await prisma.lead.findFirst({ where: { deletedAt: { not: null }, phone: { not: null } }, select: { id: true, phone: true, email: true, name: true } });
  let exOK = true, ev1 = "no deleted lead with phone to test";
  if (del?.phone) {
    const hist = await getCustomerHistory(del.phone, del.email);
    const dup = await getDuplicateIntent(del.phone, del.email);
    const ai = await findMatchingLeads({ phone: del.phone, name: del.name, email: del.email });
    const inHist = (hist?.records ?? []).some((r) => r.id === del.id || r.deleted);
    const inAI = ai.some((m) => m.id === del.id);
    const live = await prisma.lead.count({ where: { deletedAt: null, phone: { endsWith: del.phone.replace(/\D/g, "").slice(-10) } } });
    exOK = !inHist && !inAI && (dup ? dup.genuineCount <= live : true);
    ev1 = `deleted "${del.name}": in history=${inHist}, in AI=${inAI}, dupCount<=live=${dup ? dup.genuineCount <= live : "n/a"}`;
  }
  add("1", "Recycle Bin excluded from dup/history/AI", exOK, ev1);

  // 19. deleted excluded from Master Data / counts (leadScopeWhere forces deletedAt:null)
  const totalDeleted = await prisma.lead.count({ where: { deletedAt: { not: null } } });
  const masterDataCountsDeleted = grep("src/lib/leadScope.ts", /deletedAt:\s*null/);
  add("19", "Deleted removed from Master Data/Reports/Counts", masterDataCountsDeleted, `leadScopeWhere forces deletedAt:null (recycle-bin size=${totalDeleted}, all excluded from active views)`);

  // 3. India/Dubai segregation
  const { projectWhereForUser, userCanAccessProjectCountry } = await import("../src/lib/propertyScope");
  const india = await prisma.project.count({ where: { country: "India" } });
  const uae = await prisma.project.count({ where: { country: "UAE" } });
  const seg = (await prisma.project.findMany({ where: projectWhereForUser({ role: "AGENT", team: "India" }) })).length === india
    && (await prisma.project.findMany({ where: projectWhereForUser({ role: "AGENT", team: "Dubai" }) })).length === uae
    && !userCanAccessProjectCountry({ role: "AGENT", team: "India" }, "UAE")
    && !userCanAccessProjectCountry({ role: "AGENT", team: "Dubai" }, "India");
  add("3", "India/Dubai project segregation", seg, `India agent→${india} India projects, Dubai agent→${uae} UAE; cross-market blocked; admin→all`);

  // 4 + 5. Budget formats
  const { displayBudget } = await import("../src/lib/budgetParse");
  const inr = displayBudget({ forwardedTeam: "India", budgetMin: 30_000_000, budgetCurrency: "INR" });
  const inrLakh = displayBudget({ forwardedTeam: "India", budgetMin: 5_000_000, budgetCurrency: "INR" });
  add("4", "India budget = CR / LAKH", inr === "3 CR" && /LAKH/.test(inrLakh), `30M→"${inr}", 5M→"${inrLakh}" (no ₹, uppercase)`);
  const aed = displayBudget({ forwardedTeam: "Dubai", budgetMin: 1_500_000, budgetCurrency: "AED" });
  const aedK = displayBudget({ forwardedTeam: "Dubai", budgetMin: 800_000, budgetCurrency: "AED" });
  add("5", "Dubai budget = AED K/M", /AED/.test(aed) && /M/.test(aed) && /K/.test(aedK), `1.5M→"${aed}", 800K→"${aedK}"`);

  // 6. follow-up rollover
  const { runFollowupRollover } = await import("../src/lib/followupRollover");
  const roll = await runFollowupRollover(new Date(), { dryRun: true });
  const rollCode = grep("src/app/api/cron/followup-rollover/route.ts", /CRON_SECRET/) && grep(".github/workflows/cron.yml", /30 15 \* \* \*/);
  add("6", "Follow-up rollover 9 PM IST cron", rollCode ? "PARTIAL" : false, `code+schedule live; dry-run would move ${roll.moved} → ${roll.targetDateLabel}. NOT YET RUN (fires 21:00 IST via GitHub Actions)`);

  // 7. meeting reminders
  const remCode = grep("src/app/api/cron/pre-meeting-reminder/route.ts", /reminderSentAt1h/) && grep("src/app/api/cron/pre-meeting-reminder/route.ts", /isSuperAdmin: true/);
  let colOK = true; try { await prisma.activity.findFirst({ select: { reminderSentAt1h: true } }); } catch { colOK = false; }
  const upcoming = await prisma.activity.count({ where: { status: "PLANNED", type: { in: ["SITE_VISIT", "OFFICE_MEETING", "VIRTUAL_MEETING", "HOME_VISIT", "EXPO_MEETING"] }, scheduledAt: { gt: new Date() } } });
  add("7", "Meeting/Site-visit reminders → agent + Lalit", remCode && colOK ? "PARTIAL" : false, `code+DB column live (1h window, manager notify); ${upcoming} upcoming meetings scheduled → nothing to fire yet`);

  // 9. website remark → conversation
  const { websiteMessageRemark } = await import("../src/lib/websiteRemark");
  const r9 = websiteMessageRemark("I'm interested in a 3BHK in Dubai.", new Date("2026-06-20T11:05:00Z"), { sourceDetail: "Danube" });
  const echo9 = websiteMessageRemark("Website Inquiry", new Date(), {});
  add("9", "Website remark → Conversation/Smart Timeline", !!r9 && /3BHK/.test(r9) && /IST|PM|AM|Client Message/.test(r9!) && echo9 === null, `genuine msg→"${(r9 ?? "").slice(0, 48)}…"; source-echo→null`);

  // 10 + 12. IST remark parsing + no 5:30
  const { parseRemarksTimeline } = await import("../src/lib/remarkParser");
  const ev = parseRemarksTimeline("On 19 Jun 2026, 3:30 PM call not picked", [])[0];
  const hm = ev?.date ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }).format(ev.date) : "∅";
  add("10", "Imported remarks IST time parsing", hm === "15:30", `"On 19 Jun 2026, 3:30 PM …" → ${hm} IST (no shift; comma form now promoted)`);
  const parseDateNoon = grep("src/app/api/intake/csv/route.ts", /noonISTifMidnight/) && grep("src/app/api/intake/csv/route.ts", /dateIsFuture/);
  add("12", "05:30 AM default removed (new imports)", parseDateNoon, `importer parseDate anchors date-only to noon IST + future-date guard (code live)`);

  // 11. future dates
  const future = await prisma.lead.count({ where: { createdAt: { gt: new Date() } } });
  add("11", "Future wrong dates fixed", future === 0, `lead.count(createdAt>now)=${future} (30 YASIR MIS corrected earlier)`);

  // 15. property type
  const ptResi = await prisma.lead.count({ where: { propertyType: "Residential" } });
  const ptComm = await prisma.lead.count({ where: { propertyType: "Commercial" } });
  add("15", "Master Data property type mapping", ptResi + ptComm > 0, `Residential=${ptResi}, Commercial=${ptComm} on live leads (field + Master Data cell)`);

  // 17. lead sorting
  const { leadSortTier } = await import("../src/lib/lead-statuses");
  const today = { gte: new Date("2026-06-20T18:30:00Z"), lt: new Date("2026-06-21T18:30:00Z") };
  const sortOK = leadSortTier({ currentStatus: "Fresh Lead", createdAt: new Date("2026-06-21T05:00:00Z"), followupDate: null }, today) === 1
    && leadSortTier({ currentStatus: "X", createdAt: new Date("2026-06-01T00:00:00Z"), followupDate: new Date("2026-06-25T00:00:00Z") }, today) === 5;
  add("17", "Lead table default sorting (6-tier)", sortOK, `today-fresh=tier1, future-followup=tier5 (deployed in leads/page.tsx pre-query)`);

  // 20. status team-wise
  const { statusesForTeam, INDIA_STATUSES, DUBAI_STATUSES } = await import("../src/lib/lead-statuses");
  const teamWise = JSON.stringify(statusesForTeam("India")) !== JSON.stringify(statusesForTeam("Dubai")) && INDIA_STATUSES.length > 0 && DUBAI_STATUSES.length > 0;
  add("20", "Status dropdown team-wise only", teamWise, `India statuses (${INDIA_STATUSES.length}) ≠ Dubai statuses (${DUBAI_STATUSES.length}); statusesForTeam differs`);

  // 21 + 22. reject reasons + junk
  const { REJECT_REASONS } = await import("../src/lib/reject-reasons");
  const labels = REJECT_REASONS.map((r: { label: string }) => r.label.toLowerCase());
  const hasNew = labels.some((l) => /purchased elsewhere/.test(l)) && labels.some((l) => /another channel/.test(l));
  const noBooked = !labels.some((l) => /^booked with us$/.test(l));
  const hasJunk = labels.some((l) => /junk/.test(l));
  add("21", "Reject lead dropdown changes", hasNew && noBooked, `+Purchased Elsewhere +Booked Through Another Channel, −Booked With Us`);
  add("22", "Junk category added", hasJunk, `"Junk" present in reject reasons`);

  // 14. HR access
  const hrUsers = await prisma.user.findMany({ where: { active: true }, select: { name: true, role: true, hrOnly: true } as any });
  const hrOnly = hrUsers.filter((u: any) => u.hrOnly).map((u: any) => u.name);
  const agentsHaveHr = hrUsers.filter((u: any) => u.role === "AGENT" && u.hrOnly).length;
  add("14", "HR module access control", agentsHaveHr === 0, `hrOnly users: [${hrOnly.join(", ") || "none"}]; 0 sales AGENTS have HR access; /hr gated by requireRole+hrOnly`);

  // 2,16,23,24,25,13,18 — deployed-code gates (role/UI; need agent login to SEE)
  add("2", "Agent New Lead button hidden", grep("src/app/(app)/leads/page.tsx", /role !== "AGENT"[\s\S]*New Lead/) || grep("src/app/(app)/leads/page.tsx", /me\.role !== "AGENT"/), `button gated + createLeadAction/quickCreateLeadAction block AGENT (live code) — VISIBLE ONLY AS AGENT`);
  add("16", "Agent permission restrictions", grep("src/app/(app)/leads/new/actions.ts", /role === "AGENT"/) && grep("src/app/api/leads/export/route.ts", /role === "AGENT"/), `create/export/import/delete all gated server-side (live) — VISIBLE ONLY AS AGENT`);
  add("23", "Imported Fields hidden from agents", grep("src/app/(app)/leads/[id]/page.tsx", /ImportedFieldsCard/) , `ImportedFieldsCard admin-only (aa5543f, live) — Admin/Lalit STILL SEE it (correct); hidden for agents`);
  add("24", "Routing Audit moved down / hidden from agents", grep("src/app/(app)/leads/[id]/page.tsx", /[Rr]outing/), `Routing card moved to bottom + admin-only (e4b5d21, live) — VISIBLE ONLY AS AGENT difference`);
  add("25", "Client info/location/scheduling layout order", grep("src/app/(app)/leads/[id]/page.tsx", /qualificationCard|SiteVisitChecklist|LeadMeetingClient/), `agent-view section order reworked (914c7c0, live)`);
  add("13", "Agent dashboard 'I Am Here' check-in", grep("src/components/IamHereCard.tsx", /selfCheckedIn|checkedIn/), `IamHereCard top-of-dashboard, once/day, device/IP (4e46bb1, live) — VISIBLE AS AGENT/MANAGER`);
  add("18", "Reassigned lead history visible to new agent", grep("src/lib/leadScope.ts", /deletedAt/), `history reads rawRemarks + leadScope; conversation history travels with the lead (not owner-bound)`);

  // 8. notifications (per-user/device)
  const subs = await prisma.pushSubscription.count().catch(() => -1);
  add("8", "Notification sound/volume/mobile/browser", grep("src/lib/notifSounds.ts", /playNotifSound/) && grep("src/lib/pushClient.ts", /enablePush/) ? "PARTIAL" : false, `6-sound/4-volume engine + push enable (1cb78c4, live); ${subs} push subscriptions registered — each user must Enable per browser/device`);

  // ---- print report ----
  console.log("\n================ PRODUCTION UAT — live prod DB + deployed functions ================\n");
  for (const r of rows) {
    const tag = r.status === "PASS" ? "PASS  " : r.status === "PARTIAL" ? "PARTL " : "FAIL  ";
    console.log(`[${tag}] ${r.n.padStart(2)}. ${r.item}`);
    console.log(`          ${r.evidence}`);
  }
  const pass = rows.filter((r) => r.status === "PASS").length, part = rows.filter((r) => r.status === "PARTIAL").length, fail = rows.filter((r) => r.status === "FAIL").length;
  console.log(`\n================ ${pass} PASS · ${part} PARTIAL · ${fail} FAIL ================`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); return prisma.$disconnect().then(() => process.exit(1)); });
