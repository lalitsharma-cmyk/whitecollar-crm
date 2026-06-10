import { classifyText, type RemarkEventType } from "../src/lib/remarkParser";

const EVENT_TYPES = new Set<RemarkEventType>(["SITE_VISIT", "MEETING", "VIRTUAL_MEETING"]);

// Must NOT be counted as a completed Meeting / Site Visit / Virtual.
const shouldNotCount = [
  "We should plan a virtual meeting",
  "I proposed a virtual meeting",
  "We will do a virtual call",
  "Client agreed in principle",
  "will plan virtual meeting",
  "proposed virtual meeting",
  "suggested virtual call",
  "client may visit",
  "will come for site visit",
  "planning to visit",
  "asked to schedule meeting",
  "we can do virtual call",
  "agreed in principle",
  "will confirm",
  // extra traps with completion-ish words in future/negated context
  "meeting to be done next week",
  "virtual meeting will be done tomorrow",
  "site visit not done yet",
  "site visit scheduled for Sunday",
  "meeting scheduled",
  "had planned a meeting",
];

// MUST be counted, with the expected type.
const shouldCount: Array<[string, RemarkEventType]> = [
  ["virtual meeting done", "VIRTUAL_MEETING"],
  ["virtual meeting completed", "VIRTUAL_MEETING"],
  ["zoom meeting done", "VIRTUAL_MEETING"],
  ["Google Meet completed", "VIRTUAL_MEETING"],
  ["virtual call happened", "VIRTUAL_MEETING"],
  ["VC done", "VIRTUAL_MEETING"],
  ["meeting conducted virtually", "VIRTUAL_MEETING"],
  ["site visit done", "SITE_VISIT"],
  ["client visited site", "SITE_VISIT"],
  ["came to site", "SITE_VISIT"],
  ["visited project", "SITE_VISIT"],
  ["saw sample apartment", "SITE_VISIT"],
  ["saw actual unit", "SITE_VISIT"],
  ["site visit completed", "SITE_VISIT"],
  ["came to office", "MEETING"],
  ["office meeting done", "MEETING"],
  ["met at office", "MEETING"],
  ["office visit completed", "MEETING"],
  // real completion mixed with a future booking note (must still count)
  ["site visit done, client will book next week", "SITE_VISIT"],
];

let fail = 0;
console.log("── should NOT count as completed event ──");
for (const txt of shouldNotCount) {
  const t = classifyText(txt);
  const counted = EVENT_TYPES.has(t);
  if (counted) { fail++; console.log(`  ✗ WRONGLY COUNTED [${t}]  "${txt}"`); }
  else console.log(`  ✓ ${t.padEnd(16)} "${txt}"`);
}
console.log("\n── should count (with expected type) ──");
for (const [txt, want] of shouldCount) {
  const t = classifyText(txt);
  if (t !== want) { fail++; console.log(`  ✗ got ${t}, want ${want}  "${txt}"`); }
  else console.log(`  ✓ ${t.padEnd(16)} "${txt}"`);
}
console.log(`\n${fail === 0 ? "✅ ALL PASS" : `❌ ${fail} FAILURE(S)`}`);
process.exit(fail === 0 ? 0 : 1);
