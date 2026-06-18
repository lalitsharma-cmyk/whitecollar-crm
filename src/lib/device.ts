// Pure device helpers — parse a User-Agent into a friendly descriptor, build a
// human device name, and pull IP + geo from request headers. No external libs.
// Safe to import anywhere (no server-only, no prisma).

export type UaInfo = { browser: string; os: string; type: "mobile" | "desktop" | "tablet" };

export function parseUserAgent(ua: string): UaInfo {
  const s = ua || "";
  const isTablet = /iPad|Tablet|PlayBook|Silk/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s));
  const isMobile = !isTablet && /Mobi|Android|iPhone|iPod|Windows Phone|BlackBerry/i.test(s);
  const type: UaInfo["type"] = isTablet ? "tablet" : isMobile ? "mobile" : "desktop";

  let browser = "Browser";
  if (/Edg\//i.test(s)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(s)) browser = "Opera";
  else if (/SamsungBrowser/i.test(s)) browser = "Samsung Internet";
  else if (/Chrome\//i.test(s) && !/Chromium/i.test(s)) browser = "Chrome";
  else if (/Firefox\//i.test(s)) browser = "Firefox";
  else if (/Version\/.*Safari/i.test(s)) browser = "Safari";
  else if (/Chromium/i.test(s)) browser = "Chromium";

  let os = "Device";
  if (/iPhone|iPod/i.test(s)) os = "iPhone";
  else if (/iPad/i.test(s)) os = "iPad";
  else if (/Android/i.test(s)) os = "Android";
  else if (/Windows NT/i.test(s)) os = "Windows";
  else if (/Mac OS X|Macintosh/i.test(s)) os = "Mac";
  else if (/Linux/i.test(s)) os = "Linux";

  return { browser, os, type };
}

/** "Mehak – iPhone" / "Mehak – Chrome Windows" */
export function deviceName(userName: string, p: UaInfo): string {
  const first = (userName || "User").trim().split(/\s+/)[0];
  if (p.os === "iPhone" || p.os === "iPad" || p.os === "Android") return `${first} – ${p.os}`;
  return `${first} – ${p.browser} ${p.os}`;
}

export type RequestMeta = { ip: string; city?: string; country?: string; ua: string };

/** Pull IP + geo + UA from a Headers object (works for NextRequest + next/headers). */
export function requestMetaFrom(h: Headers): RequestMeta {
  const ip =
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    "unknown";
  const cityRaw = h.get("x-vercel-ip-city");
  const city = cityRaw ? safeDecode(cityRaw) : undefined;
  const country = h.get("x-vercel-ip-country") || undefined;
  const ua = h.get("user-agent") || "";
  return { ip, city, country, ua };
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

export function locationLabel(city?: string | null, country?: string | null): string {
  if (city && country) return `${city}, ${country}`;
  return city || country || "—";
}
