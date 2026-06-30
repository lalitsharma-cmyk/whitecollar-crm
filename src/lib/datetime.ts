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

/** "09 Jun, 06:20 PM IST" — compact date+time with explicit zone (HR lists). */
export function fmtISTShortLabelled(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  const datePart = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone: IST }).format(date);
  const timePart = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: IST }).format(date);
  return `${datePart}, ${timePart} IST`;
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

// ── IST day boundaries ─────────────────────────────────────────────────
// Vercel serverless runs in UTC, so a naive `new Date().setHours(0,0,0,0)`
// lands on UTC-midnight — 5h30m off from the day the team reads on their
// phones. These return the correct UTC *instants* for the start/end of an
// IST calendar day, so a "followupDate falls on this IST day" query is exact.
// Used by /action-list (Today / Tomorrow / Overdue / Custom date) and any
// other "everything scheduled for date X (IST)" query — keep it DRY here.

/** "YYYY-MM-DD" — the IST calendar date for a given instant (default: now). */
export function istDateKey(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: IST,
  }).format(d); // en-CA → ISO-ish "2026-06-24"
}

/**
 * IST weekday: 0=Sun … 6=Sat (JS getDay convention). Tuesday = 2.
 * Computed against the IST CALENDAR date (via istDateKey + the +05:30 anchor,
 * the same idiom istDayRange uses), so it's correct regardless of server TZ —
 * e.g. 11pm Monday IST (which is already Tuesday UTC) still returns Monday.
 */
export function istWeekday(d: Date = new Date()): number {
  return new Date(`${istDateKey(d)}T00:00:00+05:30`).getUTCDay();
}

/**
 * UTC instants bounding a single IST calendar day [start, end).
 *   • No arg            → today (IST)
 *   • "YYYY-MM-DD"      → that IST day
 *   • Date              → the IST day that instant falls on
 * `end` is exclusive (start of the next IST day), so use `lt: end`.
 */
export function istDayRange(day?: string | Date): { start: Date; end: Date } {
  const key = day == null
    ? istDateKey()
    : day instanceof Date
      ? istDateKey(day)
      : day; // already a "YYYY-MM-DD" string
  const start = new Date(`${key}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/**
 * The ONE canonical "overdue" boundary for Lead.followupDate, as a UTC instant =
 * the start of today (IST). A follow-up is OVERDUE iff `followupDate < this`.
 *
 * Why a day boundary, not `now()`: follow-up dates are day-granular ("call them
 * on the 24th"), so a follow-up due LATER today is "Today", NOT overdue — a 6pm
 * callback must not flip to "Overdue" at 11am. Keying off start-of-today-IST also
 * makes the Today and Overdue buckets DISJOINT (Today = [start, end) today;
 * Overdue = < start), so the same lead never double-counts across both chips and
 * Today + Overdue == the "Today + Overdue" default exactly.
 *
 * Every surface that means "overdue follow-up" (Leads chip, Dashboard tile,
 * /leads/overdue, Action List, the CSV export) MUST use this so the definition
 * can't drift. (Action List + its SQL rollup already key off istDayRange().start,
 * which equals this.)
 */
export function overdueFollowupBoundary(): Date {
  return istDayRange().start;
}

/** Validates a "YYYY-MM-DD" string (used to sanitise a ?date= query param). */
export function isValidDateKey(s: string | null | undefined): s is string {
  if (!s) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00+05:30`);
  return !isNaN(t);
}

// ── Time-of-day greeting (timezone-aware) ──────────────────────────────────
// The dashboard greeting must reflect the USER'S local time, not the server's.
// Vercel runs in UTC, so a server-computed "morning" is wrong for an IST/GST
// user (4:11 PM IST = 10:41 UTC = "morning" — the reported bug). These helpers
// derive the hour in an explicit IANA timezone, so the band is always correct
// regardless of where the code runs.
//
// Bands (in the target timezone), per spec:
//   05:00–11:59 → Morning   12:00–16:59 → Afternoon
//   17:00–20:59 → Evening   21:00–04:59 → Night

export type GreetingBand = "Morning" | "Afternoon" | "Evening" | "Night";

/** Map a user's team to their wall-clock timezone. India → IST, Dubai → GST. */
export function tzForTeam(team: string | null | undefined): string {
  const t = (team ?? "").trim().toLowerCase();
  if (t === "dubai" || t === "uae" || t === "dxb" || t === "ae") return "Asia/Dubai";
  if (t === "india" || t === "in" || t === "ind" || t === "bharat") return "Asia/Kolkata";
  return "Asia/Kolkata"; // sensible default for this India-HQ'd team
}

/** The hour-of-day (0–23) of an instant, read in a specific IANA timezone. */
export function hourInTZ(d: Date, tz: string): number {
  // en-GB + hourCycle h23 → "00".."23"; parse to a number. Robust across zones.
  const hh = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hourCycle: "h23",
    timeZone: tz,
  }).format(d);
  const n = parseInt(hh, 10);
  return Number.isFinite(n) ? n % 24 : 0;
}

/** Time-of-day band for an instant, evaluated in the given timezone. */
export function greetingBandFor(d: Date, tz: string): GreetingBand {
  const h = hourInTZ(d, tz);
  if (h >= 5 && h < 12) return "Morning";   // 05:00–11:59
  if (h >= 12 && h < 17) return "Afternoon"; // 12:00–16:59
  if (h >= 17 && h < 21) return "Evening";   // 17:00–20:59
  return "Night";                            // 21:00–04:59
}

/** Full greeting phrase, e.g. "Good Afternoon", for an instant in a timezone. */
export function greetingFor(d: Date, tz: string): string {
  return `Good ${greetingBandFor(d, tz)}`;
}

/** A representative emoji for a greeting band (for the dashboard header flourish). */
export function greetingEmojiFor(band: GreetingBand): string {
  switch (band) {
    case "Morning": return "☀️";
    case "Afternoon": return "🌤️";
    case "Evening": return "🌆";
    case "Night": return "🌙";
  }
}

/**
 * Short, honest range label for KPI sub-text.
 *
 * Dashboard tiles used to hard-code "this month" / "last 30 days" — but the
 * underlying query range often didn't match that copy (e.g. a 7-day window
 * was still labelled "this month"). This helper picks a compact unit so the
 * label matches the actual span: under 30 days → "Xd", else → "Xmo".
 *
 * Examples:
 *   smartRangeLabel(7d ago, now)   → "7d"
 *   smartRangeLabel(30d ago, now)  → "1mo"
 *   smartRangeLabel(90d ago, now)  → "3mo"
 */
export function smartRangeLabel(start: Date, end: Date): string {
  const days = Math.round((end.getTime() - start.getTime()) / 86400000);
  if (days < 30) return `${days}d`;
  return `${Math.round(days / 30)}mo`;
}
