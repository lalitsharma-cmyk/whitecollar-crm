import { extractFromRemarks } from "@/lib/remarkAutofill";
import { quoteOfTheDay, quoteOneLine } from "@/lib/salesQuotes";
import { fmtIST, fmtISTParen, fmtISTTime } from "@/lib/datetime";
import { parseRemarks } from "@/lib/remarkParser";

console.log("══ extractFromRemarks ═══════════════════════════════════════");

const samples = [
  {
    name: "MIS-style: budget + city + project + profession",
    text: "he has a budget of 3-4 crores. NRI from Mumbai based in Dubai. Senior Director at consulting firm. Looking at Azizi Venice for investment.",
  },
  {
    name: "AED budget + BHK",
    text: "Looking for 2BR in Dubai Marina. Budget AED 2.5M cash ready. Wants to invest immediately.",
  },
  {
    name: "Business owner + financing needed",
    text: "Business owner from Gurgaon. 3 BHK in Bangalore. Needs loan. Will decide in 3 months.",
  },
  {
    name: "Villa + Penthouse + hot signal",
    text: "highly interested in villa or penthouse in Abu Dhabi. ready to book. cash ready.",
  },
  {
    name: "Empty / junk",
    text: "...",
  },
];

const projects = ["Azizi Venice", "Sobha Hartland 2", "Damac Canal Heights", "Burj Vista", "Marina Bay"];

for (const s of samples) {
  console.log(`\n[${s.name}]`);
  console.log(`  input:  "${s.text.slice(0, 70)}${s.text.length > 70 ? "…" : ""}"`);
  const out = extractFromRemarks(s.text, projects);
  if (Object.keys(out).length === 0) {
    console.log("  output: (nothing extracted)");
  } else {
    for (const [k, v] of Object.entries(out)) {
      console.log(`  ✓ ${k.padEnd(18)} = ${JSON.stringify(v)}`);
    }
  }
}

console.log("\n══ parseRemarks (multi-line MIS cell) ═══════════════════════");
const mis = `Mehak: he has a budget of 3-4crores. On 14 Oct 2024 (4.20pm) Call not pick
Lalit Sharma: On 15 Oct 2024 call not pick-(5:13PM)
On 16 Oct 2024 He called me at 11:00Am, he is interested in Azizi Venice`;
const parsed = parseRemarks(mis);
console.log(`  parsed ${parsed.length} entries:`);
for (const e of parsed.slice(0, 5)) {
  console.log(`  • ${e.agentName} | ${e.when.toISOString().slice(0,16)} | ${e.outcome} | ${e.text.slice(0,60)}…`);
}

console.log("\n══ quoteOfTheDay (deterministic per day) ═══════════════════");
const q = quoteOfTheDay();
console.log(`  Today: "${q.text}" — ${q.author}`);
console.log(`  One-line: ${quoteOneLine()}`);

console.log("\n══ datetime helpers (IST) ═══════════════════════════════════");
const now = new Date();
console.log(`  fmtIST(now):       ${fmtIST(now)}`);
console.log(`  fmtISTParen(now):  ${fmtISTParen(now)}`);
console.log(`  fmtISTTime(now):   ${fmtISTTime(now)}`);
console.log(`  (raw UTC for comparison: ${now.toISOString()})`);

console.log("\n✅ All extractor + helper tests ran without throwing.");
