// Smart Timeline parser tests (no DB). Run: npx tsx scripts/test-timeline.ts
import { parseRemarksTimeline, mergeSameMoment } from "../src/lib/remarkParser";
const AGENTS = ["Yasir Khan", "Tanuj Chopra"];
let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond ? "" : "   → " + detail}`);
};

// 1. Stray bracket artifacts ("] he said…") stripped, one card per remark.
{
  const blob = "Yasir: on 12 Apr 2025 (11:23am) ] he said I will call you in an hour,,,,on 11 Apr 2025 (4:30pm) ] not picked";
  const e = mergeSameMoment(parseRemarksTimeline(blob, AGENTS));
  check("no [ or ] in any entry body", !e.some(x => /[[\]]/.test(x.text)), JSON.stringify(e.map(x => x.text)));
  check("leading ']' removed — body starts at the words", e.some(x => /^he said I will call/i.test(x.text)), JSON.stringify(e.map(x => x.text)));
  check("two distinct remarks → two separate entries", e.length === 2, `got ${e.length}`);
}

// 2. Inline "(10:35am)" continuation → time pulled into the header, body clean.
{
  const blob = "Need brochure,,,,on 24 Jan 2026 (10:21am) not picked,,,,(10:35am) he called back we discussed plan";
  const e = mergeSameMoment(parseRemarksTimeline(blob, AGENTS));
  const cb = e.find(x => /called back/i.test(x.text));
  check("inline-time continuation parsed", !!cb, JSON.stringify(e.map(x => x.text)));
  check("continuation body has no leading paren / time digits", !!cb && !/^\(/.test(cb.text) && !/10:35/.test(cb!.text), JSON.stringify(cb?.text));
  check("continuation carries a REAL clock time (not noon sentinel)",
    !!cb && cb!.date != null && !(cb!.date!.getUTCHours() === 6 && cb!.date!.getUTCMinutes() === 30),
    cb?.date?.toISOString());
}

// 3. Two remarks on the SAME date (no time) must stay SEPARATE (rule 12).
{
  const blob = "on 9 Apr 2025 answered will come back to Gurgaon today,,,,on 9 Apr 2025 sent brochure on whatsapp";
  const e = mergeSameMoment(parseRemarksTimeline(blob, AGENTS));
  const apr9 = e.filter(x => x.date && x.date.getUTCMonth() === 3 && x.date.getUTCDate() === 9);
  check("same-day date-only remarks NOT merged", apr9.length === 2, `got ${apr9.length}: ${JSON.stringify(apr9.map(x => x.text))}`);
}

// 4. "From (Name)" wrapper stripped; metadata not echoed in the body.
{
  const e = parseRemarksTimeline("From (Yasir) he said hello and wants 3 BHK", AGENTS);
  check("'From (..)' wrapper removed from body", e.length > 0 && /^he said hello/i.test(e[0].text) && !/from/i.test(e[0].text), JSON.stringify(e.map(x => x.text)));
}

// 5. Full original text preserved (no word dropped) for a normal remark.
{
  const e = parseRemarksTimeline("Tanuj: on 5 May 2025 (3:30pm) client wants a sea view unit near the marina", AGENTS);
  check("full remark text preserved", e.length === 1 && /sea view unit near the marina/i.test(e[0].text), JSON.stringify(e.map(x => x.text)));
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
