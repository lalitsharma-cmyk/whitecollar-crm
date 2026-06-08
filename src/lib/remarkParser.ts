// Parses a Lead.remarks cell (imported from Nitisha MIS / Master Sheet) into a
// structured timeline of interaction entries.
//
// Design goals (from Lalit's spec 2026-06):
//   1. Every remark is shown — nothing is discarded.
//   2. No technical labels ("Historical Note", "Imported From Excel", "1 Jan 1970").
//   3. Agent ownership is preserved: "Yasir: <entries>" → all entries tagged Yasir
//      until the next known-agent prefix appears.
//   4. Only names from the KNOWN AGENT ROSTER become agents. Random words that look
//      like names ("Golf Island", "December") are kept as plain text.
//   5. Undated entries are attached to the nearest preceding dated entry (or the
//      lead's createdAt if no dated entry exists).
//   6. Consecutive identical low-signal outcomes (not picked, busy, switched off)
//      are grouped into "X times, DD Mon – DD Mon" to keep the timeline readable.

import { CallOutcome } from "@prisma/client";

// ─── Date/time helpers ──────────────────────────────────────────────────────

export const MONTHS: Record<string, number> = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11,
  january:0,february:1,march:2,april:3,june:5,july:6,august:7,september:8,
  october:9,november:10,december:11,
};

// Every timestamp in MIS sheets is IST wall-clock time. Build the UTC instant
// by treating h/m as IST and subtracting the IST offset.
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

export function parseDateTime(dateStr: string, timeStr?: string): Date | null {
  const m = dateStr.match(/(\d{1,2})\s+(\w+)\s+(\d{4})/);
  if (!m) return null;
  const day = parseInt(m[1]);
  const mon = MONTHS[m[2].toLowerCase().slice(0, 4)] ?? MONTHS[m[2].toLowerCase()];
  if (mon === undefined) return null;
  const yr = parseInt(m[3]);
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
  return new Date(Date.UTC(yr, mon, day, h, mins) - IST_OFFSET_MS);
}

function tryExtractDate(line: string): Date | null {
  const mLong = line.match(/(?:^|[^a-z])(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[\s,]+(\d{4})/i);
  if (mLong) {
    const d = parseInt(mLong[1]);
    const mon = MONTHS[mLong[2].toLowerCase().slice(0,4)] ?? MONTHS[mLong[2].toLowerCase()];
    const yr = parseInt(mLong[3]);
    if (mon !== undefined) return new Date(Date.UTC(yr, mon, d, 6, 30) - IST_OFFSET_MS);
  }
  const mISO = line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (mISO) {
    const d = new Date(`${mISO[1]}-${mISO[2]}-${mISO[3]}T06:30:00+05:30`);
    if (!isNaN(d.getTime())) return d;
  }
  const mDMY = line.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
  if (mDMY) {
    const day = parseInt(mDMY[1]), mon = parseInt(mDMY[2]) - 1, yr = parseInt(mDMY[3]);
    if (day >= 1 && day <= 31 && mon >= 0 && mon <= 11)
      return new Date(Date.UTC(yr, mon, day, 6, 30) - IST_OFFSET_MS);
  }
  return null;
}

// ─── Event-type classification ───────────────────────────────────────────────

export type RemarkEventType =
  | "CALL_CONNECTED"
  | "CALL_NOT_PICKED"
  | "CALL_BUSY"
  | "CALL_SWITCHED_OFF"
  | "CALL_CALLBACK"
  | "CALL_NOT_INTERESTED"
  | "SITE_VISIT"
  | "MEETING"
  | "VIRTUAL_MEETING"
  | "NOTE";

export function classifyText(text: string): RemarkEventType {
  const t = text.toLowerCase();
  if (/site\s*visit|visited\s+site|visited\s+the\s+site|site\s+done|sv\s+done|went\s+to\s+site/i.test(t)) return "SITE_VISIT";
  if (/virtual\s*meeting|zoom|teams\s+meeting|google\s+meet|video\s+call|vc\s+done/i.test(t)) return "VIRTUAL_MEETING";
  if (/meeting\s+done|meeting\s+completed|met\s+at|visited\s+office|office\s+meeting|expo\s+meeting|met\s+client|oberoi|meeting\s+at/i.test(t)) return "MEETING";
  if (/not\s*picked|did not pick|didn[''']?t pick|no answer|nai pick|not pick|not\s*connected|not\s*reachable/i.test(t)) return "CALL_NOT_PICKED";
  if (/switched\s*off|switch off/i.test(t)) return "CALL_SWITCHED_OFF";
  if (/(call\s*)?busy|in meeting/i.test(t)) return "CALL_BUSY";
  if (/not\s*interested|do not call|cancel.*query|drop.*query/i.test(t)) return "CALL_NOT_INTERESTED";
  if (/callback|call back|call later|will call/i.test(t)) return "CALL_CALLBACK";
  if (/connected|spoke|discussed|explained|told|confirmed|agreed|follow up|sent details|shared details|interested/i.test(t)) return "CALL_CONNECTED";
  return "NOTE";
}

// Whether an event type is a low-signal missed-call outcome (eligible for grouping)
export function isMissedCall(t: RemarkEventType): boolean {
  return t === "CALL_NOT_PICKED" || t === "CALL_BUSY" || t === "CALL_SWITCHED_OFF";
}

export function guessOutcome(text: string): CallOutcome {
  switch (classifyText(text)) {
    case "CALL_NOT_PICKED":  return CallOutcome.NOT_PICKED;
    case "CALL_BUSY":        return CallOutcome.BUSY;
    case "CALL_SWITCHED_OFF": return CallOutcome.SWITCHED_OFF;
    case "CALL_CALLBACK":    return CallOutcome.CALLBACK;
    case "CALL_NOT_INTERESTED": return CallOutcome.NOT_INTERESTED;
    case "CALL_CONNECTED":   return CallOutcome.CONNECTED;
    default:                 return CallOutcome.CONNECTED;
  }
}

// ─── Agent roster matching ────────────────────────────────────────────────────

// Build a matcher: given a list of known agent names (from the DB):
//   1. If candidate matches a roster entry → return canonical name
//      (e.g. "Yasir" → "Yasir Khan", "Tanuj" → "Tanuj Chopra").
//   2. If NOT in roster but looks like a real person name (≤2 CamelCase words,
//      no digits, ≥2 chars each) → return the candidate as-is.
//      This preserves historical agents (Kiran, Devansh, Muskan, Nitisha, …)
//      who were real employees but are no longer active CRM users.
//   3. 3+ word constructs like "Expressway Gurgaon Tanuj" or "Golf Island Tanuj"
//      → return null (these are project/place names mixed in, not person names).
//
// Rule: historical remarks are business records. Agent names must NEVER be
// removed just because the person is no longer an active CRM user.
export function buildAgentMatcher(agentNames: string[]): (candidate: string) => string | null {
  const lookup = new Map<string, string>();
  for (const name of agentNames) {
    const lower = name.toLowerCase().trim();
    lookup.set(lower, name);
    const first = lower.split(" ")[0];
    if (first && !lookup.has(first)) lookup.set(first, name);
  }
  return (candidate: string) => {
    const trimmed = candidate.trim();
    // Priority 1: known CRM user → canonical full name
    const canonical = lookup.get(trimmed.toLowerCase());
    if (canonical) return canonical;
    // Priority 2: not in roster → show as-is IF it looks like a person name.
    // Person name heuristic: 1–2 words, each starting with a capital letter,
    // no digits, each word ≥ 2 chars. This accepts "Kiran", "Devansh", "Muskan",
    // "Nicky Gupta", "Abhinav Singh" and rejects "Expressway Gurgaon Tanuj" (3 words).
    const words = trimmed.split(/\s+/);
    if (words.length < 1 || words.length > 2) return null;
    if (words.some(w => w.length < 2 || !/^[A-Z]/.test(w) || /\d/.test(w))) return null;
    return trimmed; // preserve as historical agent name
  };
}

// ─── Core structured entry ────────────────────────────────────────────────────

export interface RemarkEntry {
  /** Parsed date (IST→UTC), or null for truly undated fragments */
  date: Date | null;
  /** True when the date was inferred (undated → attached to nearest dated entry) */
  dateInferred: boolean;
  /** Canonical agent name from the roster, or null */
  agentName: string | null;
  /** Clean display text (no leading "Name: ") */
  text: string;
  /** Semantic type of this interaction */
  eventType: RemarkEventType;
}

// ─── Main parser ──────────────────────────────────────────────────────────────

// Full "on DD Mon YYYY (HH:MM) body" — previously made into synthetic CallLogs.
const FULL_DATED_RE = /^(?:([A-Z][A-Za-z\s]{1,30}?)\s*:\s*)?[oO]n\s+(\d{1,2}\s+[A-Za-z]+(?:\s+\d{4})?)\s*\(([^)]+)\)\s*([\s\S]*)$/;
// "on DD Mon YYYY body" — date but no time parens
const ON_DATE_NO_TIME = /^(?:([A-Z][A-Za-z\s]{1,30}?)\s*:\s*)?[oO]n\s+((?:\d{1,2}\s+\w+(?:\s+\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}))\s*(.*)/;
// Leading "Name: " attribution (only to detect; canonical check is against roster)
const NAME_PREFIX = /^([A-Z][A-Za-z]{1,20}(?:\s+[A-Z][A-Za-z]{1,20}){0,2})\s*:\s*/;

/**
 * Parse a Lead.remarks cell into a structured timeline of RemarkEntry objects,
 * respecting agent ownership and attaching undated entries to their nearest
 * dated neighbour.
 *
 * @param cell        The raw Lead.remarks string.
 * @param agentNames  List of canonical agent names from the DB.
 * @param leadCreatedAt  Lead creation date — used as fallback for the very first
 *                    undated entry when no dated entry precedes it.
 */
export function parseRemarksTimeline(
  cell: string,
  agentNames: string[],
  leadCreatedAt?: Date,
): RemarkEntry[] {
  if (!cell || typeof cell !== "string") return [];

  const matchAgent = buildAgentMatcher(agentNames);

  // Normalize MIS separators and split inline "On DD Mon" occurrences
  const normalized = cell
    .replace(/,{2,}/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/([.!?]?\s*)([oO]n\s+\d)/g, (_, sep, on) => `\n${on}`)
    .trim();

  const lines = normalized.split("\n").map(l => l.trim()).filter(Boolean);

  // Raw entries before we apply the undated → inferred-date pass
  interface RawEntry { date: Date | null; agentCandidate: string | null; text: string }
  const raw: RawEntry[] = [];
  let currentAgent: string | null = null; // last known-roster agent seen

  for (const line of lines) {
    if (line.length < 2) continue;

    // Case 1: full "on DD Mon YYYY (HH:MM) body"
    const mFull = line.match(FULL_DATED_RE);
    if (mFull) {
      const candidate = mFull[1]?.trim() ?? null;
      const date = parseDateTime(mFull[2].trim(), mFull[3].trim());
      const body = (mFull[4] ?? "").replace(/^[,.\s]+/, "").trim();
      if (candidate) {
        const resolved = matchAgent(candidate);
        if (resolved) currentAgent = resolved;
      }
      // Push with currentAgent as agentCandidate when the line had no inline prefix
      // (happens when the inline-split puts "Name:" on its own line before "On …")
      if (body.length >= 2) raw.push({ date, agentCandidate: candidate ?? currentAgent, text: body });
      continue;
    }

    // Case 2: "on DD Mon YYYY body" — no time
    const mOn = line.match(ON_DATE_NO_TIME);
    if (mOn) {
      const candidate = mOn[1]?.trim() ?? null;
      const date = tryExtractDate(mOn[2].trim()) ?? tryExtractDate(line);
      const body = (mOn[3] ?? "").replace(/^[,.\s]+/, "").trim();
      if (candidate) {
        const resolved = matchAgent(candidate);
        if (resolved) currentAgent = resolved;
      }
      if (body.length >= 2) raw.push({ date, agentCandidate: candidate ?? currentAgent, text: body });
      continue;
    }

    // Case 3: line might start with "Name: body" without a date prefix.
    // Also handles "Name:" alone (body empty) — just updates currentAgent.
    const mName = line.match(NAME_PREFIX);
    if (mName) {
      const candidate = mName[1].trim();
      const resolved = matchAgent(candidate);
      if (resolved) currentAgent = resolved;
      const body = line.slice(mName[0].length).trim();
      if (body.length < 2) continue; // name-only line — agent updated, nothing to push
      const date = tryExtractDate(body) ?? tryExtractDate(line);
      let displayText = body.replace(/^[,.\s]+/, "").trim();
      if (date) {
        displayText = displayText
          .replace(/^\d{1,2}\s+[a-z]{3}[a-z]*(?:\s+\d{4})?\s*[:\-]?\s*/i, "")
          .replace(/^\d{4}-\d{2}-\d{2}\s*[:\-]?\s*/, "")
          .replace(/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\s*[:\-]?\s*/, "")
          .trim();
      }
      if (displayText.length >= 2) raw.push({ date, agentCandidate: candidate, text: displayText });
      continue;
    }

    // Case 4: plain line — may have a date embedded, otherwise truly undated
    const date = tryExtractDate(line);
    let displayText = line;
    if (date) {
      displayText = line
        .replace(/^\d{1,2}\s+[a-z]{3}[a-z]*(?:\s+\d{4})?\s*[:\-]?\s*/i, "")
        .replace(/^\d{4}-\d{2}-\d{2}\s*[:\-]?\s*/, "")
        .replace(/^\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}\s*[:\-]?\s*/, "")
        .trim();
    }
    displayText = displayText.replace(/^[,.\s]+/, "").trim();
    if (displayText.length >= 2) raw.push({ date, agentCandidate: null, text: displayText });
  }

  // ── Pass 2: resolve agent for each entry (sticky ownership) ────────────────
  // Walk forward maintaining currentAgent; for each entry with a known candidate
  // update it, then stamp the entry.
  let runningAgent: string | null = null;
  const withAgent: Array<RawEntry & { resolvedAgent: string | null }> = raw.map(e => {
    if (e.agentCandidate) {
      const resolved = matchAgent(e.agentCandidate);
      if (resolved) runningAgent = resolved;
    }
    return { ...e, resolvedAgent: runningAgent };
  });

  // ── Pass 3: attach undated entries to their nearest preceding dated entry ──
  // Find the last dated entry before each undated one and reuse its date, marked
  // as inferred. If none exists, use leadCreatedAt.
  let lastKnownDate: Date | null = leadCreatedAt ?? null;
  const entries: RemarkEntry[] = withAgent.map(e => {
    if (e.date) {
      lastKnownDate = e.date;
      return { date: e.date, dateInferred: false, agentName: e.resolvedAgent, text: e.text, eventType: classifyText(e.text) };
    }
    // Undated → infer
    return {
      date: lastKnownDate,
      dateInferred: true,
      agentName: e.resolvedAgent,
      text: e.text,
      eventType: classifyText(e.text),
    };
  });

  // Sort chronologically (oldest first, matching original Excel order).
  // Null-date entries (no lead creation date either) go to the bottom.
  entries.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return a.date.getTime() - b.date.getTime();
  });

  return entries;
}

// ─── Grouping for display ─────────────────────────────────────────────────────

export interface MissedCallGroup {
  kind: "missed_group";
  count: number;
  from: Date;
  to: Date;
  label: string;      // e.g. "Call not picked" / "Busy"
  agentName: string | null;
}

export interface SingleEntry {
  kind: "entry";
  entry: RemarkEntry;
}

export type DisplayEntry = MissedCallGroup | SingleEntry;

/**
 * Collapse consecutive isMissedCall entries of the same type into a group
 * (spec §5: "do not create 20 separate entries").
 * Min 3 consecutive identical outcomes → grouped; fewer shown individually.
 */
export function groupEntries(entries: RemarkEntry[]): DisplayEntry[] {
  const MIN_GROUP = 3;
  const result: DisplayEntry[] = [];
  let i = 0;

  while (i < entries.length) {
    const e = entries[i];
    if (!isMissedCall(e.eventType)) {
      result.push({ kind: "entry", entry: e });
      i++;
      continue;
    }
    // Count run of same missed-call type
    let j = i + 1;
    while (
      j < entries.length &&
      entries[j].eventType === e.eventType &&
      entries[j].agentName === e.agentName
    ) j++;
    const count = j - i;

    if (count >= MIN_GROUP) {
      const from = entries[i].date ?? new Date(0);
      const to   = entries[j - 1].date ?? from;
      const label = e.eventType === "CALL_NOT_PICKED" ? "Call not picked"
        : e.eventType === "CALL_BUSY" ? "Busy"
        : "Switched off";
      result.push({ kind: "missed_group", count, from, to, label, agentName: e.agentName });
      i = j;
    } else {
      result.push({ kind: "entry", entry: e });
      i++;
    }
  }
  return result;
}

// ─── Site-visit / Meeting extraction ─────────────────────────────────────────

export interface VisitSummary {
  date: Date | null;
  project: string | null;
  agentName: string | null;
  outcome: string;
}

export function extractSiteVisits(entries: RemarkEntry[]): VisitSummary[] {
  return entries
    .filter(e => e.eventType === "SITE_VISIT")
    .map(e => ({
      date: e.date,
      project: extractProjectFromText(e.text),
      agentName: e.agentName,
      outcome: e.text,
    }));
}

export function extractMeetings(entries: RemarkEntry[]): VisitSummary[] {
  return entries
    .filter(e => e.eventType === "MEETING" || e.eventType === "VIRTUAL_MEETING")
    .map(e => ({
      date: e.date,
      project: null,
      agentName: e.agentName,
      outcome: e.text,
    }));
}

// Naive project-name extractor: looks for a capitalised proper-noun run in the
// text that isn't a common stop word.
const STOP = new Set(["client", "he", "she", "they", "said", "called", "told", "wanted", "the", "a", "an", "and", "at", "of"]);
function extractProjectFromText(text: string): string | null {
  const m = text.match(/(?:(?:at|to|visit|visited|project|tower|residences?|heights?)\s+)?([A-Z][A-Za-z\s]{3,30})/);
  if (!m) return null;
  const candidate = m[1].trim().split(" ")[0]?.toLowerCase();
  if (!candidate || STOP.has(candidate)) return null;
  return m[1].trim();
}

// ─── Legacy exports (kept for callStats + CSV route that no longer use them) ──
// parseRemarks is no longer called from intake/csv (removed in dd7e550).
// extractUndatedSegments is replaced by parseRemarksTimeline.
// Both are kept here with minimal bodies so any imports don't break.

export interface ParsedRemark {
  agentName: string;
  when: Date;
  outcome: CallOutcome;
  text: string;
}

/** @deprecated Use parseRemarksTimeline instead. Not called from intake. */
export function parseRemarks(_cell: string): ParsedRemark[] { return []; }

export interface SegmentEntry {
  text: string;
  date: Date | null;
}

/** @deprecated Use parseRemarksTimeline instead. */
export function extractUndatedSegments(_cell: string): SegmentEntry[] { return []; }
