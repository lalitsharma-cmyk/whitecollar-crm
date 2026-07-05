"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * Restore a list page's scroll position when the user returns to it (browser
 * Back, in-app GlobalBackButton, breadcrumb — all `router.back()`).
 *
 * WHY: the CRM list pages are `force-dynamic` server components whose rows are
 * fetched fresh on every render. When the user opens a record and hits Back,
 * Next.js re-runs the page and the list re-mounts with the content height not
 * yet settled, so the browser's native scroll restoration lands at the top.
 * This hook persists `window.scrollY` (keyed by pathname) in sessionStorage and
 * re-applies it once the list has painted, so Back returns the user to the exact
 * row they were on — the last piece of "filters survive Back".
 *
 * DESIGN
 *   • sessionStorage, keyed by pathname (`wcr_scroll_<pathname>`). Session-scoped
 *     so it never leaks across browser sessions; pathname-keyed so /leads,
 *     /master-data, /buyer-data and /india-buyer-data each remember their own.
 *   • Saves on scroll (throttled via rAF), on `pathchange`/unmount, and on
 *     `pagehide` — whichever fires first when the user navigates away.
 *   • Restores on mount with a short rAF retry window so it still works when the
 *     rows arrive a frame or two after the shell paints. Any user scroll during
 *     the window aborts the restore (so we never fight the user).
 *
 * Only an explicit reset elsewhere clears filters; this hook is purely additive
 * and never mutates any filter/query state.
 *
 * Usage (top of a list client component):
 *   useScrollRestore();                 // keyed by the current pathname
 *   useScrollRestore("buyer-active");   // extra suffix if one path has variants
 */
export function useScrollRestore(keySuffix = "") {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `wcr_scroll_${pathname}${keySuffix ? `_${keySuffix}` : ""}`;

    // ── Save (throttled to one write per frame) ──────────────────────────────
    let rafId: number | null = null;
    const save = () => {
      rafId = null;
      try { sessionStorage.setItem(key, String(window.scrollY)); } catch { /* quota / private mode */ }
    };
    const onScroll = () => { if (rafId == null) rafId = requestAnimationFrame(save); };
    // pagehide covers a real browser Back to a bfcached page + tab close.
    const onPageHide = () => save();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onPageHide);

    // ── Restore (retry until content is tall enough, or the user scrolls) ─────
    let targetY = 0;
    try { targetY = parseInt(sessionStorage.getItem(key) ?? "0", 10) || 0; } catch { targetY = 0; }

    let cancelled = false;
    let restoreRaf: number | null = null;
    if (targetY > 0) {
      const started = Date.now();
      // Abort the restore the moment the user scrolls themselves.
      const abort = () => { cancelled = true; };
      window.addEventListener("wheel", abort, { passive: true, once: true });
      window.addEventListener("touchmove", abort, { passive: true, once: true });

      const tryRestore = () => {
        if (cancelled) { window.removeEventListener("wheel", abort); window.removeEventListener("touchmove", abort); return; }
        const maxY = document.documentElement.scrollHeight - window.innerHeight;
        // Content tall enough to honour the saved offset → jump and stop.
        if (maxY >= targetY - 2) {
          window.scrollTo(0, targetY);
          window.removeEventListener("wheel", abort);
          window.removeEventListener("touchmove", abort);
          return;
        }
        // Keep the page as far down as it currently allows while we wait for more
        // rows to paint, up to a 1.2s budget (covers the force-dynamic re-fetch).
        window.scrollTo(0, Math.min(targetY, Math.max(0, maxY)));
        if (Date.now() - started < 1200) restoreRaf = requestAnimationFrame(tryRestore);
        else { window.removeEventListener("wheel", abort); window.removeEventListener("touchmove", abort); }
      };
      restoreRaf = requestAnimationFrame(tryRestore);
    }

    return () => {
      // Persist the final position as we leave (covers client-side nav where
      // pagehide never fires).
      save();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onPageHide);
      if (rafId != null) cancelAnimationFrame(rafId);
      if (restoreRaf != null) cancelAnimationFrame(restoreRaf);
      cancelled = true;
    };
  }, [pathname, keySuffix]);
}
