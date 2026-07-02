// Phone + field normalization shared by every telephony provider.

/** Normalize a phone ("+91…", "91…", "00…", "(0) 55-123") to leading-"+" E.164. */
export function normalizePhone(s: string | null | undefined): string | null {
  if (!s) return null;
  let v = String(s).trim().replace(/[^\d+]/g, "");
  if (!v) return null;
  if (v.startsWith("00")) v = "+" + v.slice(2);
  else if (!v.startsWith("+")) v = "+" + v;
  // Guard against a lone "+" or absurdly short strings.
  return v.replace(/\D/g, "").length >= 6 ? v : null;
}

/** Last-N digits, for tolerant fingerprint matching (handles +/00/country-code drift). */
export function last10(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = String(s).replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : d || null;
}

/** Pick the first present, non-empty value among a list of candidate keys. */
export function pick(data: Record<string, string>, keys: string[]): string | null {
  for (const k of keys) {
    const v = data[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

/** Parse a timestamp that may be ISO, epoch-seconds, or epoch-millis. */
export function parseTs(s: string | null | undefined): Date | null {
  if (!s) return null;
  const t = String(s).trim();
  if (/^\d+$/.test(t)) {
    const n = Number(t);
    const d = new Date(n > 1e12 ? n : n * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(t);
  return isNaN(d.getTime()) ? null : d;
}
