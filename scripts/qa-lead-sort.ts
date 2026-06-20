import { leadSortTier, isFreshStatus } from "../src/lib/lead-statuses";
// today IST window (use fixed instants for determinism)
const today = { gte: new Date("2026-06-20T18:30:00Z"), lt: new Date("2026-06-21T18:30:00Z") }; // 21 Jun IST
const D = (s: string) => new Date(s);
const cases: [string, any, number][] = [
  ["today's fresh (Fresh Lead, created today)", { currentStatus: "Fresh Lead", createdAt: D("2026-06-21T05:00:00Z"), followupDate: D("2026-06-21T10:00:00Z") }, 1],
  ["today's fresh (null status, created today)", { currentStatus: null, createdAt: D("2026-06-21T05:00:00Z"), followupDate: null }, 1],
  ["today's follow-up (worked status, fu today)", { currentStatus: "Interested", createdAt: D("2026-06-10T05:00:00Z"), followupDate: D("2026-06-21T08:00:00Z") }, 2],
  ["old fresh (Fresh, created 3 days ago)", { currentStatus: "Fresh Lead", createdAt: D("2026-06-18T05:00:00Z"), followupDate: null }, 3],
  ["overdue follow-up", { currentStatus: "Negotiating", createdAt: D("2026-06-01T05:00:00Z"), followupDate: D("2026-06-19T08:00:00Z") }, 4],
  ["future follow-up", { currentStatus: "Interested", createdAt: D("2026-06-01T05:00:00Z"), followupDate: D("2026-06-25T08:00:00Z") }, 5],
  ["other (worked, no follow-up)", { currentStatus: "Call Back Later", createdAt: D("2026-06-01T05:00:00Z"), followupDate: null }, 6],
  ["fresh-today BEATS today-followup (precedence)", { currentStatus: "Fresh Lead", createdAt: D("2026-06-21T05:00:00Z"), followupDate: D("2026-06-21T09:00:00Z") }, 1],
  ["old fresh BEATS overdue (fresh wins over fu)", { currentStatus: "Fresh Lead", createdAt: D("2026-06-15T05:00:00Z"), followupDate: D("2026-06-18T09:00:00Z") }, 3],
];
let pass = 0, fail = 0;
for (const [label, lead, want] of cases) {
  const got = leadSortTier(lead, today);
  const ok = got === want;
  if (ok) pass++; else fail++;
  console.log(`${ok ? "✓" : "✗ WANT "+want+" GOT "+got} tier ${got}  ${label}`);
}
console.log(`\nisFresh: "Fresh Lead"=${isFreshStatus("Fresh Lead")} null=${isFreshStatus(null)} "Interested"=${isFreshStatus("Interested")}`);
console.log(`${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
