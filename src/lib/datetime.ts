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

/** "14:30" — time only */
export function fmtISTTime(d: Date | string | number): string {
  const date = d instanceof Date ? d : new Date(d);
  return timeOnly(date);
}

/** "5 Apr 2026, 14:30 IST" — when we want to be unambiguous about the zone */
export function fmtISTLabelled(d: Date | string | number): string {
  return `${fmtIST(d)} IST`;
}
