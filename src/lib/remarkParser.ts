// Parses multi-line remark cells from Nitisha MIS / Master Sheet into per-date CallLog rows.
// Handles ALL these real-world formats:
//   "Neeraj: On 6 April 2025 (5:30PM) Called at 93 degree..."   ← named entry
//   "On 24 Jul 2025 (4:26)Call busy"                            ← unnamed (inherits last name)
//   ",,,,,,On 23 Sep 2025 (12:43) not interested"               ← comma-separated noise
//   "From(24Jul-16 Sep 2025)"                                   ← date-range, skipped
// Free-form intro text before the first dated entry is ignored (kept in Lead.remarks).

import { CallOutcome } from "@prisma/client";

export interface ParsedRemark {
  agentName: string;
  when: Date;
  outcome: CallOutcome;
  text: string;
}

const MONTHS: Record<string, number> = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11,
  january:0,february:1,march:2,april:3,june:5,july:6,august:7,september:8,october:9,november:10,december:11,
};

// Lalit's whole team sits in India — every time written in the MIS sheets
// ("on 3 May 2026 (12:36)") is the IST wall-clock time. Vercel servers run in
// UTC, so `new Date(yr, mon, day)` + `setHours` would interpret 12:36 as UTC,
// store it as UTC 12:36, and then fmtIST() would render it as 18:06 IST —
// the +5:30 mismatch Lalit screenshotted. Build the Date by treating the
// h/m as IST and subtracting the IST offset to get the equivalent UTC instant.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function parseDateTime(dateStr: string, timeStr?: string): Date | null {
  const m = dateStr.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!m) return null;
  const day = parseInt(m[1]);
  const mon = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase()];
  if (mon === undefined) return null;
  const yr = parseInt(m[3]);
  // Default to noon IST when no time is given — keeps the displayed date stable
  // regardless of TZ (midnight would slip backwards a day when rendered in UTC).
  let h = 12, mins = 0;
  if (timeStr) {
    const tm = timeStr.match(/(\d{1,2}):?(\d{0,2})\s*(am|pm)?/i);
    if (tm) {
      h = parseInt(tm[1]);
      mins = parseInt(tm[2] || "0");
      const ampm = (tm[3] ?? "").toLowerCase();
      if (ampm === "pm" && h < 12) h += 12;
      if (ampm === "am" && h === 12) h = 0;
    }
  }
  // Treat (yr, mon, day, h, mins) as IST wall-clock, return the matching UTC instant.
  return new Date(Date.UTC(yr, mon, day, h, mins) - IST_OFFSET_MS);
}

// Salutation words that may appear at the start of an agent-name token
// (e.g. "Thanks Nitisha" → should be trimmed to "Nitisha").
const SALUTATIONS = /^(thanks|thank|hi|hello|dear|regards|bye|sorry|yes|no|ok|okay)\s+/i;

function stripSalutation(name: string): string {
  return name.replace(SALUTATIONS, "").trim();
}

function guessOutcome(text: string): CallOutcome | null {
  const t = text.toLowerCase();
  if (/not\s*picked|did not pick|didn[''']?t pick|no answer|nai pick|not pick|wa dropped|dropped\s*msg|drop\s*message|dropped\s*message|msg\s*dropped|not\s*connected/i.test(t)) return CallOutcome.NOT_PICKED;
  if (/switched\s*off|switch off|switch-off/i.test(t)) return CallOutcome.SWITCHED_OFF;
  if (/(call\s*)?busy|in meeting/i.test(t)) return CallOutcome.BUSY;
  if (/wrong\s*number|not the right person/i.test(t)) return CallOutcome.WRONG_NUMBER;
  if (/callback|call back|call later|will call|connect (later|after|tomorrow|sunday|monday)/i.test(t)) return CallOutcome.CALLBACK;
  if (/not\s*interested|do not call|cancel my query|drop my query/i.test(t)) return CallOutcome.NOT_INTERESTED;
  if (/interested|positive|liked|wants|booked|will buy|ready to/i.test(t)) return CallOutcome.INTERESTED;
  if (/connected|spoke|discussed|explained|told|confirmed|agreed|follow up|follow-up|sent details|shared details/i.test(t)) return CallOutcome.CONNECTED;
  // Long text without an explicit signal: return null rather than incorrectly
  // assuming CONNECTED.
  return null;
}

export function parseRemarks(cell: string): ParsedRemark[] {
  if (!cell || typeof cell !== "string") return [];
  const text = cell.replace(/,{2,}/g, "\n").replace(/\s+\n/g, "\n");

  const results: ParsedRemark[] = [];
  // Agent name: 1-3 CamelCase words ("Lalit", "Lalit Sharma", "Dr Gagan Jain").
  // Previously only matched the LAST CamelCase word — "Lalit Sharma:" parsed as
  // just "Sharma" (because the regex skipped "Lalit " trying to anchor `\s*:\s*`
  // and the colon was after "Sharma"). Now greedy on the whole multi-word run.
  const re = /(?:([A-Z][A-Za-z]{1,15}(?:\s+[A-Z][A-Za-z]{1,15}){0,2})\s*:\s*)?[oO]n\s+([\dA-Za-z]+(?:\s+[\dA-Za-z]+){1,3})\s*\(([^)]+)\)\s*([^]*?)(?=(?:[A-Z][A-Za-z]{1,15}(?:\s+[A-Z][A-Za-z]{1,15}){0,2}\s*:\s*[oO]n\s+)|(?:[oO]n\s+\d)|$)/g;

  let currentAgent = "Unknown";
  let m;
  while ((m = re.exec(text)) !== null) {
    const [, agent, dateStr, timeStr, rawMsg] = m;
    if (agent) currentAgent = stripSalutation(agent.trim());
    const when = parseDateTime(dateStr.trim(), timeStr.trim());
    if (!when) continue;
    const msg = (rawMsg || "").trim()
      .replace(/^[,\s]+/, "")
      .replace(/[,\s]+$/, "")
      .replace(/\s+/g, " ")
      .replace(/^From\s*\([^)]+\)\s*/, "");
    if (msg.length < 2) continue;
    results.push({ agentName: currentAgent, when, outcome: guessOutcome(msg) ?? CallOutcome.CONNECTED, text: msg });
  }

  results.sort((a, b) => a.when.getTime() - b.when.getTime());
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Extended date extraction — tries multiple formats that parseRemarks() misses.
// Used for segments that don't start with "on DD Mon YYYY (HH:MM)".
//
// Supported extra patterns:
//   "3 Jan 2022"          — no "on" prefix
//   "03 Jan"              — no year (current year assumed)
//   "8/6/2026"            — DD/MM/YYYY or MM/DD/YYYY (prefer DD/MM for India)
//   "08-06-2026"          — DD-MM-YYYY
//   "2026-06-08"          — ISO YYYY-MM-DD
// ─────────────────────────────────────────────────────────────────────────────
function tryExtractDate(line: string): Date | null {
  // 1. "3 Jan 2022" or "3 January 2022" — with or without "on" prefix
  const mLong = line.match(/(?:^|[^a-z])(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,]+(\d{4})/i);
  if (mLong) {
    const d = parseInt(mLong[1]);
    const mon = MONTHS[mLong[2].toLowerCase().slice(0,4)] ?? MONTHS[mLong[2].toLowerCase()];
    const yr = parseInt(mLong[3]);
    if (mon !== undefined) {
      return new Date(Date.UTC(yr, mon, d, 6, 30) - IST_OFFSET_MS); // ~noon IST
    }
  }
  // 2. "3 Jan" — no year, use current year
  const mShort = line.match(/(?:^|[^a-z])(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/i);
  if (mShort) {
    const d = parseInt(mShort[1]);
    const mon = MONTHS[mShort[2].toLowerCase().slice(0,4)] ?? MONTHS[mShort[2].toLowerCase()];
    if (mon !== undefined) {
      const yr = new Date().getFullYear();
      return new Date(Date.UTC(yr, mon, d, 6, 30) - IST_OFFSET_MS);
    }
  }
  // 3. ISO: 2026-06-08
  const mISO = line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (mISO) {
    const d = new Date(`${mISO[1]}-${mISO[2]}-${mISO[3]}T06:30:00+05:30`);
    if (!isNaN(d.getTime())) return d;
  }
  // 4. DD/MM/YYYY or DD-MM-YYYY
  const mDMY = line.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  if (mDMY) {
    const day = parseInt(mDMY[1]), mon = parseInt(mDMY[2]) - 1, yr = parseInt(mDMY[3]);
    if (day >= 1 && day <= 31 && mon >= 0 && mon <= 11) {
      return new Date(Date.UTC(yr, mon, day, 6, 30) - IST_OFFSET_MS);
    }
  }
  return null;
}

export interface SegmentEntry {
  text: string;
  date: Date | null; // null = truly undated — show at bottom as historical note
}

/**
 * Extract all text segments from a remarks cell that do NOT match the
 * primary "on DD Mon YYYY (HH:MM)" pattern used by parseRemarks().
 *
 * Each segment is returned with an optional date (extracted from alternative
 * date formats or null if truly undated). The caller uses this to place the
 * segment correctly in the conversation timeline — dated segments sort into
 * the right position; undated ones go to the bottom.
 *
 * Agents never see the source — no "Imported from Excel" labels.
 */
// "(Name:)? on DD Mon YYYY (HH:MM) body" — the pattern parseRemarks() used to
// turn into CallLog rows. We no longer create calls from imports, so these are
// now captured here as DATED Historical Notes. The optional agent name before
// the colon is deliberately discarded — an imported remark must NEVER surface a
// parsed word as a caller/agent. Groups: 1=date, 2=time, 3=body.
const FULL_DATED_CAPTURE =
  /^(?:[A-Z][A-Za-z]{1,15}(?:\s+[A-Z][A-Za-z]{1,15}){0,2}\s*:\s*)?[oO]n\s+(\d{1,2}\s+[A-Za-z]+(?:\s+\d{4})?)\s*\(([^)]+)\)\s*([\s\S]*)$/;

// "on DD Mon YYYY" WITHOUT time parens. Captures: (optional Name:) + date + body.
const ON_DATE_NO_TIME = /^(?:[A-Z][A-Za-z]{1,15}(?:\s+[A-Z][A-Za-z]{1,15}){0,2}\s*:\s*)?[oO]n\s+((?:\d{1,2}\s+\w+(?:\s+\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}))\s*(.*)/;

// Strip a leading "Name:" / "First Last:" attribution so imported note bodies
// never present a parsed word as a speaker (e.g. "Tanuj: interested" → "interested").
function stripLeadingName(s: string): string {
  return s.replace(/^[A-Z][A-Za-z]{1,15}(?:\s+[A-Z][A-Za-z]{1,15}){0,2}\s*:\s*/, "").trim();
}

/**
 * Turn an imported remarks cell into Historical Note segments.
 *
 * Every fragment becomes a note — there are NO calls, NO agent names, and NO
 * outcomes. Dated fragments keep their date so they sort into the timeline;
 * all truly-undated fragments are collapsed into ONE clean note (spec item §8).
 */
export function extractUndatedSegments(cell: string): SegmentEntry[] {
  if (!cell || typeof cell !== "string") return [];

  // Normalise separators — MIS sheets use ",,,,,," as line breaks.
  const text = cell
    .replace(/,{2,}/g, "\n")
    .replace(/\r\n/g, "\n")
    .trim();

  // Split on inline "on DD Mon …" so multiple entries on one line separate out.
  const inlineSplit = text.replace(
    /([.!?]?\s*)([oO]n\s+\d)/g,
    (_, _sep, onPart) => `\n${onPart}`
  );

  const lines = inlineSplit.split("\n").map(l => l.trim()).filter(Boolean);

  const dated: SegmentEntry[] = [];
  const undatedTexts: string[] = [];

  // Clean a fragment (drop any leading name attribution + punctuation) and file
  // it as a dated note or queue it for the single collapsed undated note.
  const place = (body: string, date: Date | null) => {
    const clean = stripLeadingName(body).replace(/^[,.\s]+/, "").trim();
    if (clean.length < 2) return;
    if (date) dated.push({ text: clean, date });
    else undatedTexts.push(clean);
  };

  for (const line of lines) {
    if (line.length < 2) continue;

    // Case 0: full "on DD Mon YYYY (HH:MM) body" — was a synthetic CallLog row.
    const mFull = line.match(FULL_DATED_CAPTURE);
    if (mFull) {
      const date = parseDateTime(mFull[1].trim(), mFull[2].trim()) ?? tryExtractDate(mFull[1]);
      place(mFull[3] ?? "", date);
      continue;
    }

    // Case 1: "on DD Mon YYYY body" — no time parens.
    const mOn = line.match(ON_DATE_NO_TIME);
    if (mOn) {
      const date = tryExtractDate(mOn[1].trim()) ?? tryExtractDate(line);
      place(mOn[2] ?? "", date);
      continue;
    }

    // Case 2: any other date format, otherwise truly undated free text.
    const date = tryExtractDate(line);
    let displayText = line;
    if (date) {
      displayText = line
        .replace(/^\d{1,2}\s+[a-z]{3}[a-z]*(?:\s+\d{4})?\s*[:\-]?\s*/i, "")  // DD Mon [YYYY]
        .replace(/^\d{4}-\d{2}-\d{2}\s*[:\-]?\s*/, "")                       // ISO
        .replace(/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\s*[:\-]?\s*/, "")         // DD/MM/YYYY
        .trim();
    }
    place(displayText, date);
  }

  // spec item §8: collapse every undated fragment into ONE clean Historical Note.
  const result = [...dated];
  if (undatedTexts.length > 0) {
    result.push({ text: undatedTexts.join("\n"), date: null });
  }
  return result;
}
