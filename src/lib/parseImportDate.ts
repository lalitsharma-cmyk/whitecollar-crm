/**
 * Unified date parsing for import pipelines (CSV, Excel, Google Sheets).
 * Handles: Excel serials, Indian format (dd/mm/yyyy), ISO, and generic JS parsing.
 * Midnight UTC → noon IST conversion (fixes 5:30am IST display issue).
 */

function noonISTifMidnight(d: Date): Date {
  if (d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0) {
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 6, 30, 0));
  }
  return d;
}

export function parseImportDate(s?: string): Date | undefined {
  if (!s) return;
  const s_trim = String(s).trim();
  if (!s_trim) return;

  // Excel serial numbers (e.g., 45752 = 4 May 2025)
  if (/^\d+(\.\d+)?$/.test(s_trim)) {
    const n = parseFloat(s_trim);
    if (n > 1 && n < 100000) {
      const d = new Date(Math.round((n - 25569) * 86400 * 1000));
      if (!isNaN(d.getTime())) return noonISTifMidnight(d);
    }
  }

  // Indian format: dd/mm/yyyy or dd-mm-yyyy or dd.mm.yyyy
  const dmy = s_trim.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const mon = parseInt(dmy[2], 10) - 1;
    let year = parseInt(dmy[3], 10);
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && mon >= 0 && mon <= 11) {
      return noonISTifMidnight(new Date(Date.UTC(year, mon, day, 6, 30)));
    }
  }

  // Generic JS parsing (ISO, "9 Jun 2026", "Thu Jun 09 2026", etc.)
  const d = new Date(s_trim);
  return isNaN(d.getTime()) ? undefined : noonISTifMidnight(d);
}

/**
 * Guarded follow-up parser for IMPORTED columns that may hold stray numbers.
 * Unlike parseImportDate, a BARE integer/decimal is only treated as an Excel
 * serial inside the plausible date range (≈1982–2119, i.e. 30000–80000), so a
 * Follow-Up cell of "5" / "100" / "2026" / "999" is NOT misread as a 1900s date
 * (parseImportDate alone maps any 1<n<100000 to a serial). Date-like strings
 * (dd/mm/yyyy, dd-mm-yyyy, ISO, "9 Jun 2026") parse exactly as parseImportDate.
 *
 * THIS is the single source of truth for a buyer follow-up cell → Date: the
 * import write-path, the backfill, and the remark-display sibling all route
 * through it so the indexed column and the displayed text can never disagree.
 */
export function parseFollowupDate(s?: string | null): Date | undefined {
  const v = String(s ?? "").trim();
  if (!v) return undefined;
  if (/^\d+(\.\d+)?$/.test(v)) {
    const n = parseFloat(v);
    return n > 30000 && n < 80000 ? parseImportDate(v) : undefined;
  }
  return parseImportDate(v);
}

export function detectDateColumn(headers: string[]): string | undefined {
  const datePatterns = ['date', 'leaddate', 'createdon', 'createddate', 'entrydate', 'created', 'dategenerated', 'generateddate'];
  const normalized = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const datePatternsNorm = datePatterns.map(normalized);

  for (const h of headers) {
    const hn = normalized(h);
    if (datePatternsNorm.some(p => hn === p || hn.startsWith(p) || p.startsWith(hn))) {
      return h;
    }
  }
  return undefined;
}

export function detectTimeColumn(headers: string[]): string | undefined {
  const timePatterns = ['time', 'leadtime', 'calltime', 'entrytime', 'inquirytime', 'enteredtime'];
  const normalized = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const timePatternsNorm = timePatterns.map(normalized);

  for (const h of headers) {
    const hn = normalized(h);
    if (timePatternsNorm.some(p => hn === p || hn.startsWith(p) || p.startsWith(hn))) {
      return h;
    }
  }
  return undefined;
}

/**
 * Parse time string (HH:MM or H:MM) and apply to a date object.
 * Returns the modified date or original if time parse fails.
 */
export function applyTimeToDate(date: Date, timeStr?: string): Date {
  if (!timeStr) return date;

  const timeMatch = timeStr.match(/(\d{1,2})[:\.](\d{2})/);
  if (!timeMatch) return date;

  try {
    const hours = parseInt(timeMatch[1], 10);
    const mins = parseInt(timeMatch[2], 10);
    if (hours >= 0 && hours < 24 && mins >= 0 && mins < 60) {
      // Create new date with same calendar day but with the specified time (in IST)
      const result = new Date(date);
      // Convert from IST (UTC+5:30) to UTC
      result.setUTCHours(hours - 5, mins - 30, 0, 0);
      return result;
    }
  } catch {}

  return date;
}
