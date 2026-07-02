// AI Sales OS — M5 Coach/Analyst/BI local validation (pure). tsx.
import { buildPipelineSummary, buildCoachingNudges, buildDailyDigest, type DigestLead } from "./analytics";

const L = (over: Partial<DigestLead>): DigestLead => ({
  id: "x", market: "UAE", ownerId: "A", ownerName: "Agent A",
  isTerminal: false, followupOverdue: false, hotUncontacted: false, stalled: false, freshToday: false, ...over,
});

const leads: DigestLead[] = [
  L({ id: "1", ownerId: "A", ownerName: "Agent A", hotUncontacted: true }),
  L({ id: "2", ownerId: "A", ownerName: "Agent A", followupOverdue: true }),
  L({ id: "3", ownerId: "B", ownerName: "Agent B", followupOverdue: true }),
  L({ id: "4", ownerId: "B", ownerName: "Agent B", stalled: true }),
  L({ id: "5", ownerId: "B", ownerName: "Agent B", freshToday: true }),
  L({ id: "6", market: "India", ownerId: "C", ownerName: "Agent C" }), // clean
  L({ id: "7", market: null, ownerId: "C", ownerName: "Agent C" }),    // unknown market
  L({ id: "8", isTerminal: true, ownerId: "A", ownerName: "Agent A", followupOverdue: true }), // terminal → excluded
  L({ id: "9", ownerId: null, followupOverdue: true }),                // unassigned → no nudge
];

let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log(`${c ? "✓" : "✗"} ${n}`); };

const s = buildPipelineSummary(leads);
ok("workable excludes terminal", s.workable === 8);                    // 9 total − 1 terminal
ok("counts overdue follow-ups (workable only)", s.overdueFollowups === 3); // #2,#3,#9 (not terminal #8)
ok("counts hot uncontacted", s.hotUncontacted === 1);
ok("counts stalled", s.stalled === 1);
ok("counts fresh today", s.freshToday === 1);
ok("byMarket splits India/UAE/unknown", s.byMarket.UAE === 6 && s.byMarket.India === 1 && s.byMarket.unknown === 1);

const nudges = buildCoachingNudges(leads);
ok("no nudge for clean owner C", !nudges.some((x) => x.ownerId === "C"));
ok("no nudge for unassigned (null owner)", !nudges.some((x) => x.ownerName === "Unassigned"));
ok("Agent A nudge is high (hot uncontacted)", nudges.find((x) => x.ownerId === "A")?.priority === "high");
ok("Agent A ranks first (highest severity)", nudges[0]?.ownerId === "A");
ok("Agent A headline mentions hot + overdue", /hot lead.*uncontacted.*overdue/.test(nudges.find((x) => x.ownerId === "A")?.headline ?? ""));
ok("Agent B nudge exists (overdue + stalled)", !!nudges.find((x) => x.ownerId === "B"));

const digest = buildDailyDigest(leads);
ok("digest surfaces hot-uncontacted risk first", digest.topRisks[0]?.includes("hot"));
ok("digest flags missing-market leads", digest.topRisks.some((r) => r.includes("no market")));
ok("digest nudges match coaching nudges", digest.nudges.length === nudges.length);

// Empty input → safe zeros, no nudges, no risks.
const empty = buildDailyDigest([]);
ok("empty input → zeroed summary", empty.summary.workable === 0 && empty.nudges.length === 0 && empty.topRisks.length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
