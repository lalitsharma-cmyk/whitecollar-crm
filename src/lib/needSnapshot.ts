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
