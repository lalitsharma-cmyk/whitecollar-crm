import { parseRemarksTimeline } from "../src/lib/remarkParser";
const istHM = (d: Date|null) => d ? new Intl.DateTimeFormat("en-GB",{day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:true,timeZone:"Asia/Kolkata"}).format(d) : "∅";
const hasTime = (d: Date|null) => d ? !(d.getUTCHours()===6 && d.getUTCMinutes()===30) && !(d.getUTCHours()===0&&d.getUTCMinutes()===0) : false;
const cases: [string,string][] = [
  ["On 19 Jun 2026, 3:30 PM call not picked", "3:30 PM (comma form — spec example)"],
  ["On 19 Jun 2026 (3:30 PM) call not picked", "3:30 PM (paren form)"],
  ["On 3 May 2026 (5.30 PM) shared brochure", "5:30 PM (dot)"],
  ["On 19 Jun 2026 3:30 pm site visit done", "3:30 PM (space form)"],
  ["On 19 Jun 2026 discussed 3 BHK budget 2.5M", "DATE ONLY (no false time from 3 BHK/2.5M)"],
  ["On 20 Jun 2026, 10:00 AM client meeting fixed", "10:00 AM"],
];
let ok = 0, bad = 0;
for (const [cell, label] of cases) {
  const ev = parseRemarksTimeline(cell, ["Lalit","Yasir"])[0];
  const t = istHM(ev?.date ?? null);
  const timed = hasTime(ev?.date ?? null);
  console.log(`[${timed?"TIMED":"date "}] ${t}  ←  ${label}`);
  console.log(`           text: "${ev?.text ?? ""}"`);
}
// Assertions
const a = parseRemarksTimeline("On 19 Jun 2026, 3:30 PM call not picked", [])[0];
const aHM = new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",hour12:false,timeZone:"Asia/Kolkata"}).format(a.date!);
console.log(`\nSpec example IST 24h = ${aHM} (expect 15:30) → ${aHM==="15:30"?"PASS":"FAIL"}`);
const b = parseRemarksTimeline("On 19 Jun 2026 discussed 3 BHK budget 2.5M", [])[0];
const bMidnight = b.date && b.date.getUTCHours()===6 && b.date.getUTCMinutes()===30;
console.log(`No-time remark stays date-only (noon sentinel) → ${bMidnight?"PASS":"FAIL"}`);
process.exit((aHM==="15:30" && bMidnight)?0:1);
