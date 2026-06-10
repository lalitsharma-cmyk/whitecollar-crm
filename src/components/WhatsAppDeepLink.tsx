"use client";
import { useEffect } from "react";

/**
 * On PHONES, open WhatsApp's native app directly instead of going through the
 * wa.me → api.whatsapp.com web page.
 *
 * Every WhatsApp button in the app renders <a href="https://wa.me/<number>?text=…">.
 * On mobile that link often opens a browser tab showing the "Chat on WhatsApp"
 * page at api.whatsapp.com FIRST (the "WhatsApp API linkage" the user sees), then
 * the app — an extra hop. The native `whatsapp://send?phone=…` scheme jumps
 * straight into the installed WhatsApp / WhatsApp Business app with no web page.
 *
 * This is a single global click interceptor so we don't have to touch the ~15
 * WhatsApp links across the app. Desktop is left untouched (wa.me → WhatsApp Web),
 * because the native scheme has no web fallback there.
 */
export default function WhatsAppDeepLink() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const isMobile = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
    if (!isMobile) return;

    function onClick(ev: MouseEvent) {
      // Honour modifier-clicks (open in new tab etc.)
      if (ev.defaultPrevented || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button !== 0) return;
      const target = ev.target as HTMLElement | null;
      const a = target?.closest?.("a");
      const href = a?.getAttribute("href");
      if (!href) return;

      let phone = "", text = "";
      try {
        const u = new URL(href, window.location.origin);
        const host = u.hostname.toLowerCase();
        if (host === "wa.me" || host === "www.wa.me") {
          phone = u.pathname.replace(/\D/g, "");
          text = u.searchParams.get("text") || "";
        } else if (host === "api.whatsapp.com") {
          phone = (u.searchParams.get("phone") || "").replace(/\D/g, "");
          text = u.searchParams.get("text") || "";
        } else {
          return; // not a WhatsApp link
        }
      } catch {
        return;
      }
      if (!phone) return;

      ev.preventDefault();
      ev.stopPropagation();
      const native = `whatsapp://send?phone=${phone}${text ? `&text=${encodeURIComponent(text)}` : ""}`;
      window.location.href = native;
    }

    // Capture phase so we win before the <a>'s default navigation / new-tab open.
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
