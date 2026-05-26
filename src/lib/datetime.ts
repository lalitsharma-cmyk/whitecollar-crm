// IST-aware date formatting.
// Vercel serverless functions run in UTC. Without this util every server-rendered
// timestamp (timeline, call logs, dashboard) shows up 5h30m behind the actual
// India local time the team reads on their phones. Use these helpers everywhere
// we show a date/time to the user — they always render Asia/Kolkata.
//
// Pattern matches the previous date-fns "d MMM yyyy, HH:mm" / "d MMM yyyy (HH:mm)".

const IST = "Asia/Kolkata";

function dateOnly(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: IST,
  }).format(date);
}

function timeOnly(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: IST,
  }).format(date);
}

/**
 * "5.30 pm" — 12-hour with a period separator, matching how Lalit's team
 * writes times in the MIS sheets (e.g. "on 3 May 2026 (5.30 PM)"). Use on the
 * lead-detail page (Call History, Timeline, Scheduling) so on-screen times
 * read the same way agents already think.
 *
 * Examples (IST):
 *   17:30 → "5.30 pm"
 *   09:05 → "9.05 am"
 *   12:00 → "12.00 pm"   (noon)
 *   00:15 → "12.15 am"   (just past midnight)
 */
function time12Only(date: Date): string {
  // en-US with hour12 + 2-digit minute → "5:30 PM". Swap colon → dot and lower-case.
  const raw = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: IST,
  }).format(date);
  return raw.replace(":", ".").replace(" AM", " am").replace(" PM", " pm");
}

/** "5 Apr 2026, 14:30" — for timeline rows / activity logs */
export function fmtIST(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  return `${dateOnly(date)}, ${timeOnly(date)}`;
}

/** "5 Apr 2026 (14:30)" — matches the imported-remarks format on call logs */
export function fmtISTParen(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  return `${dateOnly(date)} (${timeOnly(date)})`;
}

/** "5 Apr 2026" — date only */
export function fmtISTDate(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  return dateOnly(date);
}

/** "14:30" — time only (24-hour) */
export function fmtISTTime(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  return timeOnly(date);
}

/** "5 Apr 2026, 5.30 pm" — 12-hour with period separator, matching MIS-sheet style. */
export function fmtIST12(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  return `${dateOnly(date)}, ${time12Only(date)}`;
}

/** "5 Apr 2026 (5.30 pm)" — 12-hour parenthetical form, MIS-sheet style. */
export function fmtIST12Paren(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  return `${dateOnly(date)} (${time12Only(date)})`;
}

/** "5.30 pm" — time only, 12-hour with period separator. */
export function fmtISTTime12(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  return time12Only(date);
}

/** "5 Apr 2026, 14:30 IST" — when we want to be unambiguous about the zone */
export function fmtISTLabelled(d: Date | string | number): string {
  return `${fmtIST(d)} IST`;
}

// ── datetime-local input helpers ───────────────────────────────────
// HTML datetime-local picker is a "wall clock" string with no zone info
// ("2026-05-26T18:00"). Browsers interpret it in the browser's local TZ when
// converting to a Date. Our problem: we want the user to think in IST regardless
// of where they sit, AND the server (Vercel/UTC) needs to receive an unambiguous
// instant. Use these two helpers everywhere we render or save a datetime-local:
//
//   value={toISTLocalInput(lead.meetingDate)}    ← shows "2026-05-26T18:00" (IST)
//   min={nowISTLocalInput()}                     ← blocks past dates
//   onSave: send `${val}:00+05:30` so server parses as IST→UTC correctly
//                                                  (handled in InlineEdit save)

const IST_OFFSET_MIN = 330; // +05:30

/** Date → "YYYY-MM-DDTHH:mm" wall-clock string in IST */
export function toISTLocalInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "";
  const istMs = date.getTime() + IST_OFFSET_MIN * 60_000;
  return new Date(istMs).toISOString().slice(0, 16);
}

/** Current IST as a datetime-local string — used as `min` to block past dates */
export function nowISTLocalInput(): string {
  return toISTLocalInput(new Date());
}

/** Convert a datetime-local string (assumed IST wall-clock) to a UTC Date.
 *  Returns null for empty or invalid input. */
export function fromISTLocalInput(s: string | null | undefined): Date | null {
  if (!s) return null;
  // Append seconds + IST offset so JS parses unambiguously
  const ms = Date.parse(`${s}:00+05:30`);
  return isNaN(ms) ? null : new Date(ms);
}

/** True if the given datetime-local IST string represents a moment in the past. */
export function isPastISTLocalInput(s: string | null | undefined): boolean {
  const d = fromISTLocalInput(s);
  if (!d) return false;
  return d.getTime() < Date.now();
}
