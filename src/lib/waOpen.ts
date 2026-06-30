// Platform-aware WhatsApp opener. Avoids the api.whatsapp.com hop:
//   - Mobile  → wa.me (hands off to the installed WhatsApp app)
//   - Desktop → web.whatsapp.com/send directly (WhatsApp Web / Desktop), no
//               intermediate api.whatsapp.com redirect.
// Normalizes the number to digits + country code (defaults India 91 for bare
// 10-digit numbers), stripping spaces / + / dashes / parens.

/** Normalize a raw phone to WhatsApp digits (country code, no '+'). "" if unusable. */
export function waNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  let d = String(raw).replace(/\D/g, "");
  if (!d) return "";
  // Strip a leading 0 (national trunk) before applying a default country code.
  if (d.length === 11 && d.startsWith("0")) d = d.slice(1);
  // Bare 10-digit Indian mobile → prefix 91.
  if (d.length === 10) d = "91" + d;
  return d;
}

/** A valid wa.me link (mobile-friendly); "" if the number is unusable. */
export function waHref(raw: string | null | undefined, text?: string): string {
  const n = waNumber(raw);
  if (!n) return "";
  return `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

/** Open WhatsApp for `raw`, choosing the desktop-vs-mobile surface. Client-only. */
export function openWhatsApp(raw: string | null | undefined, text?: string): void {
  const n = waNumber(raw);
  if (!n) return;
  const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  const url = isMobile
    ? `https://wa.me/${n}${text ? `?text=${encodeURIComponent(text)}` : ""}`
    : `https://web.whatsapp.com/send?phone=${n}${text ? `&text=${encodeURIComponent(text)}` : ""}`;
  if (typeof window !== "undefined") window.open(url, "_blank", "noopener,noreferrer");
}
