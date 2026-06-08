// Test the new parseRemarksTimeline — agent attribution, grouping, visit extraction.
// npx tsx scripts/test-remarks-timeline.ts
import { parseRemarksTimeline, groupEntries, extractSiteVisits, extractMeetings } from "../src/lib/remarkParser";

const AGENTS = ["Lalit Sharma", "Tanuj Chopra", "Yasir Khan", "Kiran", "Mehak Mukhija", "Devansh", "Muskan", "Arpit"];

const CASES = [
  {
    label: "Agent ownership change: Yasir → Tanuj → Lalit",
    cell: `Yasir: On 15 Jan 2025 (2:00PM) Client interested in Trump Tower. Requested pricing.
Call not picked.
Call not picked.
Meeting scheduled for Sunday.
Tanuj: On 20 Jan 2025 (11:00AM) Long discussion regarding inventory and floor preference. Site visit done at Trump Tower.
Lalit Sharma: On 25 Jan 2025 (3:00PM) Final negotiation done. Client will sign this week.`,
  },
  {
    label: "Repeated not-picked (should group ≥3)",
    cell: `Tanuj: On 5 Jan 2026 (10:00AM) Call not picked.
On 6 Jan 2026 (11:00AM) Call not picked.
On 7 Jan 2026 (10:00AM) Call not picked.
On 8 Jan 2026 (9:30AM) Call not picked.
On 9 Jan 2026 (11:00AM) Call not picked.
On 12 Jan 2026 (10:00AM) Call not picked.
On 13 Jan 2026 (10:00AM) Connected. Client interested. Follow up set.`,
  },
  {
    label: "Expressway Gurgaon Tanuj (bug repro — no fake agent)",
    cell: `Expressway Gurgaon Tanuj: On 5 Apr 2025 (3:30PM) Client interested in 2 BHK ready-to-move apartment in Windchants, Sector 112, Dwarka Expressway, Gurgaon.`,
  },
  {
    label: "Undated remarks attach to preceding date",
    cell: `Yasir: On 16 May 2025 (3:30PM) Discussed budget.
Client is an NRI based in Dubai.
Has property in Burj Vista.
Tanuj: On 20 May 2025 (4:00PM) Site visit done at Windchants.`,
  },
];

let failures = 0;
for (const c of CASES) {
  const entries = parseRemarksTimeline(c.cell, AGENTS);
  const groups  = groupEntries(entries);
  const visits  = extractSiteVisits(entries);
  const meetings = extractMeetings(entries);

  console.log(`\n── ${c.label}`);
  for (const g of groups) {
    if (g.kind === "missed_group") {
      console.log(`  [GROUP] ${g.label} ×${g.count}  ${g.from.toISOString().slice(0,10)} – ${g.to.toISOString().slice(0,10)}  agent=${g.agentName ?? "-"}`);
    } else {
      const e = g.entry;
      console.log(`  [${e.eventType.padEnd(18)}] agent=${String(e.agentName).padEnd(15)} date=${e.date?.toISOString().slice(0,10) ?? "null"} inferred=${e.dateInferred}  text=${e.text.slice(0,60)}`);
      // Check: "Expressway Gurgaon Tanuj" must NOT appear as agent
      if (c.label.includes("Expressway") && e.agentName && ["expressway","gurgaon"].includes(e.agentName.toLowerCase())) {
        console.log("    ✗ FAIL — garbage word surfaced as agent"); failures++;
      }
    }
  }
  if (visits.length) console.log(`  → Site visits: ${visits.length}`);
  if (meetings.length) console.log(`  → Meetings: ${meetings.length}`);
}

console.log(failures === 0 ? "\n✅ PASS" : `\n❌ FAIL — ${failures} issue(s)`);
process.exit(failures === 0 ? 0 : 1);
