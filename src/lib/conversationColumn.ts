// ─────────────────────────────────────────────────────────────────────────────
// Rescue an UNLABELED conversation column from an imported sheet.
//
// WHY THIS EXISTS (regression history):
//   Some agents' MIS sheets (e.g. Yasir, Dinesh) keep their call-by-call history
//   in a column whose HEADER CELL IS EMPTY — there is no "Remarks" label on it.
//   Mehak's sheet, by contrast, labels it "Remarks✍️", so it always mapped fine.
//
//   The P0 "date-leak" fix made the importer DROP every blank-header column (a
//   blank header normalizes to "" and used to wildcard-match every CRM field,
//   leaking dates into Name/Budget/etc). That correctly stopped the leak — but it
//   also discarded these legitimate unlabeled conversation columns, so Yasir's &
//   Dinesh's imports lost all conversation history (Raw History + Smart Timeline).
//
// WHAT THIS DOES:
//   Detects a single blank-header column that genuinely holds a conversation/call
//   log, and ONLY that. The importer feeds it to `remarks` (→ rawRemarks), never
//   to a structured field — so the date-leak can never come back through here.
//   It only engages when the sheet has NO labeled remarks column, so labeled
//   sheets (Mehak) are completely unaffected.
// ─────────────────────────────────────────────────────────────────────────────

/** True if a single cell reads like a call log / conversation note, not a status
 *  word, a date, a number, or a one-word tag. Deliberately conservative. */
export function looksLikeConversation(value: unknown): boolean {
  const s = String(value ?? "").trim();
  if (s.length < 25) return false;          // a real call note is longer than a status/date
  if (!/[A-Za-z]/.test(s)) return false;    // must contain words
  const words = s.split(/\s+/).filter(Boolean).length;
  if (words < 4) return false;              // "Not Interested", "17-Apr-26" → not conversation

  // At least ONE strong conversation signal must be present:
  //  • a date or clock time  ("24 apr 2025", "On 26 Jan", "10:45 am", "4:01pm")
  const dated = /\b\d{1,2}\s*[:.]\s*\d{2}\b|\b\d{1,2}[\s\-/.][A-Za-z]{3,}|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(s);
  //  • call-activity vocabulary
  const convVerbs = /\b(call(?:ed|ing)?|pick(?:ed)?|whats?app|\bwa\b|meeting|visit|interest|budget|follow|repl(?:y|ied)|switch(?:ed)?\s*off|busy|ring(?:ing)?|connect|spoke|talk|messag|msg|\bsent\b|share|requir|number|not\s+reachable|will\s+(?:call|come|do|go))/i.test(s);
  //  • an "Agent:" / "Name:" speaker prefix common in these logs ("Yasir:", "Muskan:")
  const speakerPrefix = /(^|[,;.\n])\s*[A-Za-z][A-Za-z .]{1,24}\s*:/.test(s);

  return dated || convVerbs || speakerPrefix;
}

/**
 * Find the best BLANK-HEADER column that holds conversation text.
 * Returns its column index, or -1 if none qualifies (or a labeled remarks column
 * already exists, in which case the normal mapping handles it).
 *
 * @param headers   trimmed header row (index-aligned with each data row)
 * @param dataRows  data rows (arrays index-aligned with headers)
 */
export function detectConversationColumn(headers: string[], dataRows: string[][]): number {
  // If the sheet already labels a remarks/conversation column, do nothing — the
  // normal pick("remarks", …) mapping owns it. This keeps Mehak-style sheets
  // (and any well-labeled sheet) on exactly their existing, proven code path.
  if (headers.some((h) => /remark|conversation|call\s*hist|chat\s*hist/i.test(String(h ?? "")))) return -1;

  const width = Math.max(headers.length, ...dataRows.map((r) => r.length), 0);
  let best = -1;
  let bestScore = 0;
  for (let c = 0; c < width; c++) {
    // Only blank-header columns are candidates — a labeled column that didn't map
    // is intentionally left to customFields, never silently treated as remarks.
    if (String(headers[c] ?? "").trim() !== "") continue;

    let hits = 0;        // cells that look like a conversation
    let nonEmpty = 0;    // cells with any text
    let totalLen = 0;
    for (const r of dataRows) {
      const v = String(r[c] ?? "").trim();
      if (!v) continue;
      nonEmpty++;
      totalLen += v.length;
      if (looksLikeConversation(v)) hits++;
    }
    // Require a genuine PRESENCE of conversation text — not one stray long cell.
    // ≥3 conversation cells AND ≥20% of the column's filled cells qualifying.
    if (hits >= 3 && hits >= nonEmpty * 0.2) {
      // Prefer the column with the most conversation cells; tie-break by volume.
      const score = hits * 100000 + totalLen;
      if (score > bestScore) { bestScore = score; best = c; }
    }
  }
  return best;
}

// ── Row-object variant (for the Papa-parsed Google-Sheet importer) ───────────
// Papa.parse({header:true}) yields objects keyed by header. A blank header maps
// to the key "" (and duplicate blanks to Papa's "_1"/"_2" suffixes). This finds
// the best blank-header KEY that holds conversation text, so the route can copy
// it to a real "Remarks" key — the row-object analogue of the grid detector.
const normKey = (s: string) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
function isBlankishKey(key: string): boolean {
  const k = String(key ?? "").trim();
  return k === "" || /^_\d+$/.test(k) || normKey(k) === "";
}
export function detectConversationKeyFromRows(rows: Array<Record<string, unknown>>): string | null {
  if (!rows.length) return null;
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
  // A labeled remarks/conversation column → let the normal mapping own it.
  for (const k of keys) if (/remark|conversation|call\s*hist|chat\s*hist/i.test(k)) return null;

  let best: string | null = null;
  let bestScore = 0;
  for (const k of keys) {
    if (!isBlankishKey(k)) continue;
    let hits = 0, nonEmpty = 0, totalLen = 0;
    for (const r of rows) {
      const v = String(r[k] ?? "").trim();
      if (!v) continue;
      nonEmpty++; totalLen += v.length;
      if (looksLikeConversation(v)) hits++;
    }
    if (hits >= 3 && hits >= nonEmpty * 0.2) {
      const score = hits * 100000 + totalLen;
      if (score > bestScore) { bestScore = score; best = k; }
    }
  }
  return best;
}
