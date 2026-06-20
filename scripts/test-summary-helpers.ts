// Unit test for the lead-summary helpers (no DB). Run: npx tsx scripts/test-summary-helpers.ts
import { cleanNeedSnapshot, lastMeaningfulRemark } from "../src/lib/needSnapshot";

const AMAN = "Need details for trump tower 2,,,,,Tanuj: on 24 jan 2026 (10:21am) not picked texted on wa,,,,(10:35am) he called back we discussed trump 2 he is looking for investment as he saw trump 1 appriciation. He is intrested due to 30:70.,,,,,on 9 mar 2026 (1:22pm) he said now i am back from past 1 month i was very tied up travelling. Discussed payment plan he will plan meeting on coming weekend,,,,,on 14 mar 2026 (12:28pm) speaking with someone else,,,,,,Yasir: on 12 June 2026 (4:27pm) not picked,,,,,on 14 June 2026 (12:44pm)  disconnected,,,,on 17 June 2026 (1:44pm) disconnected,,,,,,on 18 June 2026 (1:54pm) diconnected,,,,,,on 20 June 2026 (1:10pm) not picked";

let pass = 0, fail = 0;
function check(label: string, got: string | null, assert: (g: string | null) => boolean, expect: string) {
  const ok = assert(got);
  (ok ? pass++ : fail++);
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}\n      → ${JSON.stringify(got)}${ok ? "" : `   (expected ${expect})`}`);
}

// ── cleanNeedSnapshot (requirement headline) ──
check("clean: Aman blob → requirement headline", cleanNeedSnapshot(AMAN),
  (g) => g === "Need details for trump tower 2", '"Need details for trump tower 2"');
check("clean: plain message kept", cleanNeedSnapshot("Looking for a 3BHK in Gurgaon under 2cr"),
  (g) => g === "Looking for a 3BHK in Gurgaon under 2cr", "unchanged");
check("clean: pure log → null", cleanNeedSnapshot("on 19 Jun 2026 (3:30 pm) not picked"),
  (g) => g === null, "null");
check("clean: null in → null", cleanNeedSnapshot(null), (g) => g === null, "null");

// ── lastMeaningfulRemark (latest substantive line) ──
check("last: Aman blob → recent substantive line, no noise/blob",
  lastMeaningfulRemark(AMAN),
  (g) => g != null && !g.includes(",,") && !/^on\s/i.test(g) && !/^not picked/i.test(g) && !/^dis?connected/i.test(g) && g.length <= 91,
  "a clean recent line (not 'not picked'/'disconnected'/blob)");
check("last: mid-blob need surfaces over trailing noise",
  lastMeaningfulRemark("Need details,,,,on 24 jan (10:21am) he wants 30:70 plan,,,,on 26 jan (11am) not picked,,,,on 27 jan switched off"),
  (g) => g === "he wants 30:70 plan", '"he wants 30:70 plan"');
check("last: all-noise → requirement fallback",
  lastMeaningfulRemark("Need brochure,,,,on 5 Jun (2pm) not picked,,,,on 7 Jun (3pm) switched off,,,,on 8 Jun disconnected"),
  (g) => g === "Need brochure", '"Need brochure" (req fallback)');
check("last: all-noise + no requirement → null",
  lastMeaningfulRemark("on 5 Jun (2pm) not picked,,,,on 7 Jun (3pm) switched off"),
  (g) => g === null, "null");
check("last: plain short note unchanged",
  lastMeaningfulRemark("Client asked to call back in the evening"),
  (g) => g === "Client asked to call back in the evening", "unchanged");
check("last: noise-prefixed-but-substantive kept",
  lastMeaningfulRemark("on 9 Jun (1pm) not picked, later messaged that he wants a sea-view unit"),
  (g) => g != null && /sea-view/.test(g) && !/^not picked/i.test(g), "the substantive remainder");
check("last: empty/null → null", lastMeaningfulRemark(""), (g) => g === null, "null");
check("last: caps very long line with ellipsis",
  lastMeaningfulRemark("on 1 Jan (2pm) " + "he explained ".repeat(20)),
  (g) => g != null && g.length <= 91 && g.endsWith("…"), "≤91 chars ending …");

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
