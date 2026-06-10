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
  // ── Third-party meetings (NOT ours) ──
  "He said I have a meeting with one who is buying my house tomorrow second half, will update once meeting is done.",
  "client has meeting with someone else",
  "meeting with the buyer of his house done",
  "seller meeting done",
  "resale buyer meeting completed",
  "will update after their meeting",
  "family meeting done, will decide",
  "bank meeting done for loan",
  "internal discussion done at their end",
  "meeting with builder done, not arranged by us",
  "meeting with broker completed",
  "met with his bank yesterday",
  "planning to meet someone else",
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
  // ── Our-involvement positives (must still count) ──
  ["office meeting done with Tanuj", "MEETING"],
  ["met client at our office", "MEETING"],
  ["client came to our office", "MEETING"],
  ["our team met the client", "MEETING"],
  ["sample apartment shown", "SITE_VISIT"],
  ["shown the actual unit", "SITE_VISIT"],
  ["zoom meeting done with our team", "VIRTUAL_MEETING"],
  // client brought family TO our office — accompaniment, not a "family meeting"
  ["met client and his family at our office", "MEETING"],
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
