// Lead-summary helpers — turn the raw imported remark blob into CLEAN one-line
// summaries for the many UI surfaces that show a preview (lead header, Master
// Data, action queue, cold-call card, duplicate alerts, intelligence cards).
// The raw blob itself stays untouched in the DB and is only ever shown verbatim
// in Conversation History / Raw History / Audit Logs — never in a summary.
//
//   cleanNeedSnapshot()   → the leading REQUIREMENT headline ("what they want")
//   lastMeaningfulRemark() → the latest substantive CONVERSATION line ("what
//                            was last discussed"), skipping call-status noise
//
// Clean "requirement snapshot" for the one-line summary shown under a lead's
// name (the §8 header). A lead's `notesShort` often holds the WHOLE imported
// remark blob — comma garbage ("Need details,,,,,Tanuj: on 24 jan (10:21am)…")
// plus later dated call-log entries that belong in Conversation History, not
// duplicated and messy under the name. This extracts just the leading
// requirement phrase: comma-runs collapsed, the dated/attribution tail dropped.
//
// Examples:
//   "Need details for trump tower 2,,,,,Tanuj: on 24 jan 2026 (10:21am) not picked"
//     → "Need details for trump tower 2"
//   "Looking for a 3BHK in Gurgaon"        → "Looking for a 3BHK in Gurgaon"
//   "On 19 Jun 2026 (3:30 pm) called"      → null  (pure conversation log, no requirement)
export function cleanNeedSnapshot(notesShort: string | null | undefined): string | null {
  if (!notesShort) return null;
  // Collapse runs of commas (and stray BOM/whitespace) into a single ", ".
  let t = notesShort.replace(/[﻿\s]*,[\s,]*/g, ", ").replace(/\s+/g, " ").trim();
  if (!t) return null;
  // Cut at the first conversation-entry marker so only the requirement headline
  // remains: an attribution ("Tanuj:"), a dated entry ("on 24 jan"), or a
  // parenthesised time ("(10:21am)"). These belong to Conversation History.
  const marker = t.search(/(?:[A-Za-z][A-Za-z.'-]{1,20}\s*:|(?:^|\s)[oO]n\s+\d{1,2}[\s/-]|\(\s*\d{1,2}[:.]\d)/);
  if (marker > 0) t = t.slice(0, marker);
  else if (marker === 0) return null; // starts with a log entry → no requirement headline
  t = t.replace(/[\s,;:.\-–—]+$/g, "").trim(); // tidy trailing punctuation
  if (t.length > 90) t = t.slice(0, 90).replace(/\s+\S*$/, "").trim() + "…";
  return t.length >= 2 ? t : null;
}

// Pure call-status "noise" lines — when a remark entry is only this, it carries
// no information worth surfacing in a "last conversation" preview, so we skip
// past it to the previous substantive entry.
const REMARK_NOISE = /^(?:not\s*picked|no\s*answer|did\s*n'?t\s*pick|switch(?:ed)?\s*off|busy|dis?connected|call\s*back(?:\s*later)?|ringing|unreachable|out\s*of\s*(?:network|reach|coverage)|texted\s*on\s*wa|tried(?:\s*(?:on|by|again|her|him|personal)[\w\s]*)?|missed(?:\s*call)?|cut\s*the\s*call|number\s*busy|n\.?\/?a)\b[\s.,–—-]*/i;

function capSummary(s: string, maxLen: number): string | null {
  let t = s.replace(/^[)\s,;:.\-–—]+/, "").replace(/[\s,;:.\-–—]+$/, "").trim();
  if (t.length < 2) return null;
  if (t.length > maxLen) t = t.slice(0, maxLen).replace(/\s+\S*$/, "").trim() + "…";
  return t;
}

// The LATEST substantive line from a remark blob — for "last note / last
// conversation" summary spots (cold-call card, action-queue re-engage hint, the
// Master-Data preview drawer's Last-Remark fallback). Walks the imported
// conversation log from the END, skips pure call-status noise ("not picked",
// "disconnected", "switched off"…), and returns the most recent line that
// actually says something — cleaned of comma garbage and capped. Falls back to
// the requirement headline (cleanNeedSnapshot) when every entry is noise.
//
// Examples:
//   "Need details,,,,on 24 jan (10:21am) he wants 30:70 plan,,,,on 26 jan not picked"
//     → "he wants 30:70 plan"
//   "on 5 Jun not picked,,,,on 7 Jun switched off"   → "Need details" (req. fallback)
//   "Looking for a 3BHK in Gurgaon"                  → "Looking for a 3BHK in Gurgaon"
export function lastMeaningfulRemark(notes: string | null | undefined, maxLen = 90): string | null {
  if (!notes) return null;
  const t = notes.replace(/[﻿]/g, "").replace(/\s+/g, " ").trim();
  if (!t) return null;
  // Split into conversation entries: the MIS format separates them with runs of
  // commas, and each new dated entry starts with "[Name:] on <d> <mon>".
  const chunks = t
    .split(/,{2,}|(?=(?:[A-Za-z][A-Za-z.'-]{1,20}:\s*)?\bon\s+\d{1,2}\s+[A-Za-z]{3,})/i)
    .map((c) => c.trim())
    .filter(Boolean);
  for (let i = chunks.length - 1; i >= 0; i--) {
    // Strip leading attribution / date / time tokens to reach the spoken content.
    let body = chunks[i]
      .replace(/^[A-Za-z][A-Za-z.'-]{1,20}:\s*/, "")                       // "Tanuj: "
      .replace(/^on\s+\d{1,2}\s*[A-Za-z]{3,}\.?(?:\s*\d{2,4})?\s*/i, "")          // "on 24 jan 2026 "
      .replace(/^\(\s*\d{1,2}(?:[:.]\d{2})?\s*(?:[apAP]\.?\s*[mM]\.?)?\s*\)\s*/, "") // "(10:21am)" / "(2pm)" / "(13:00)"
      .replace(/^,+\s*/, "")
      .trim();
    if (!body) continue;
    // Skip pure call-status noise, but keep a noise-prefixed line that then says
    // something real ("not picked, later messaged that he wants…").
    if (REMARK_NOISE.test(body)) {
      const rest = body.replace(REMARK_NOISE, "").replace(/^[\s,;:.\-]+/, "").trim();
      if (rest.length < 6) continue;
      body = rest;
    }
    const out = capSummary(body, maxLen);
    if (out) return out;
  }
  // Everything was call-status noise → fall back to the requirement headline.
  return cleanNeedSnapshot(notes);
}
