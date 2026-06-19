// READ-ONLY: prove what the remark-timeline parser + IST formatter actually render.
//   npx tsx scripts/diag-ist.ts
import { parseRemarksTimeline } from "../src/lib/remarkParser";

const IST = "Asia/Kolkata";
const fmtIST = (d: Date) => d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: IST });
const fmtUTC = (d: Date) => d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "UTC" });
// Replicate ConversationStreamCard.hasTime()
const hasTime = (d: Date) => { const h = d.getUTCHours(), m = d.getUTCMinutes(); return !(h === 6 && m === 30) && !(h === 0 && m === 0); };

const samples = [
  "On 19 Jun 2026 (9:15 PM) client said he will visit",      // timed PM
  "On 18 Jun 2026 (11:30 AM) discussed budget",               // timed AM
  "On 19 Jun 2026 (12:10) Busy",                              // timed 24h (Arjun)
  "On 17 Jun 2026 client called, interested in 3BHK",         // DATE-ONLY (no time)
  "Yasir: On 5 Jan 2025 (5.30 pm) site visit done",          // agent + dotted pm
];

for (const s of samples) {
  const entries = parseRemarksTimeline(s, ["Yasir Khan"], new Date(Date.UTC(2026, 5, 1)));
  for (const e of entries) {
    if (!e.date) { console.log(`\n"${s}"\n   → UNDATED`); continue; }
    console.log(`\n"${s}"`);
    console.log(`   stored UTC:  ${e.date.toISOString()}`);
    console.log(`   hasTime():   ${hasTime(e.date)}   (false ⇒ should render date-only)`);
    console.log(`   IST render:  ${fmtIST(e.date)}`);
    console.log(`   UTC render:  ${fmtUTC(e.date)}   ← what a missing timeZone would show`);
  }
}
