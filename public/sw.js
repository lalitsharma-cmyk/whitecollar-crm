// White Collar CRM service worker
//   1. Make the app installable as a PWA
//   2. Cache the app shell so first paint is instant on repeat visits
//   3. Network-first for data routes so users always get fresh leads/dashboard
//   4. Receive WEB PUSH notifications (FREE — uses browser/OS push servers)

// Bump this version when shipping a UI fix that PWA users might otherwise
// miss because their old SW kept serving the stale shell. The activate
// handler below already deletes every old `wcr-shell-*` cache on swap.
// v6 (2026-06-21): force-refresh every client after the big UI batch — agent
// New-Lead gate, 6-tier sort, market segregation, budget format, reminders,
// imported-fields/routing-audit visibility, etc. Old SWs serve a stale shell.
// v7 (2026-06-21): force-refresh after the second UI batch — Interested Properties,
// "Property Enquired" rename, uniform budget format, I-Am-Here + notification-prompt
// fixes, agent-name "Lalit Sharma", Assign-To on lead create, duration-in-minutes,
// voice-note timeline, remark-edit permission. Ensures every client (incl. Lalit)
// loads the CURRENT My-Leads default ("all" workable) instead of a stale build.
// v8 (2026-06-21): Sameer support-admin dashboard (lead-ops management view).
// v9 (2026-06-21): canonical status filter order + Master-Data section order.
// v10 (2026-06-22): WhatsApp conversation metric + WA-aware connected/unsuccessful + talk-time fix.
// v11 (2026-06-22): Unassigned-Leads admin menu (left-nav item + dashboard assignment card for Lalit).
// v12 (2026-06-22): uniform budget format on ALL peripheral surfaces (reports/PDF/team/QuickSearch/Calls/ColdCall/Action-List/push).
// v13 (2026-06-22): dashboard daily sales quote under greeting + hide morning check-in section after attendance (agents).
// v14 (2026-06-22): lunch-break reminders (2:00/2:25 PM IST) with dedicated soft sound + LUNCH_REMINDER category.
// v15 (2026-06-22): Leads default filter → Today+Overdue + 6 perf indexes on hot filter columns.
// v16 (2026-06-22): mobile push — iOS "Add to Home Screen" detection + guidance on /notifications.
// v17 (2026-06-22): push enrol self-heal (always re-POST subscription) + iPhone diagnostics; Archived hidden from agents.
// v18 (2026-06-22): Notifications decoupled from TEST MODE — Settings → Automation Controls (6 toggles, all OFF); SLA alerts fire.
// v19 (2026-06-22): Sameer (lead-ops) — hide My Leads/Action List/Lead Intake/HR Recruitment; Leads default All; banner copy fix.
// v20 (2026-06-22): Conversation auto-log parity — Activity events (meetings/visits/status/reopen) now render in Raw + Smart; outbound WA + reopen logged.
// v21 (2026-06-22): Voice-note auto-correct (spelling/grammar/caps/punct; preserves names); raw transcript kept for audit.
// v22 (2026-06-22): fix Notification-preference toggles (double-fire) + force refresh so mobile shows Conversation History; pause SLA-breach.
// v23 (2026-06-23): contrast fix — Note action button was invisible in dark mode on iPad (yellow-on-yellow). Pinned ink/bg colours; CSS-only.
// v24 (2026-06-23): Agent Lead Performance report (/reports/agent-performance) — per-agent assignment-history metrics, rankings, funnel, drill-down, CSV/Excel export.
// v25 (2026-06-23): Buyer Data module (/buyer-data) — admin-only transaction records, repeat-buyer rollups, Excel import, CSV export, project-buyers section.
// v26 (2026-06-23): New-Lead form overhaul — dedup fires only on contact fields, all-country phone, free-text profession (enum→TEXT), Country→State→City cascade, Team-first Requirement order with team-reactive Assign-To/Interested-Properties/Currency, Source/Medium cleanup (single "Website", WCR Event kept), WCR-Event field order + Event-Name dropdown, Client Profile section removed.
// v27 (2026-06-24): Dubai-team INR budgets convert to AED on Lead View/List at fixed rate 1 AED = 26 INR (display-only; stored values + reports unchanged).
// v28 (2026-06-24): Master Data inline editing — every business field editable from the grid: Agent (routes through assignLeadTo → Assignment-history row + notify, so Agent Performance stays correct), Team, Property Enquired (portal-rendered project search + free-text → sourceDetail), Source (cleaned list) + Medium (Call/WhatsApp/Email/Other+custom), Budget (raw budgetMin via 2.5M/30L/3Cr parse; display converts Dubai+INR→AED). Real persistence + router.refresh; filters/counts already shared with Leads.
const CACHE = "wcr-shell-v28";
const SHELL = ["/login", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // ── HTML navigations (incl. /login) → ALWAYS NETWORK-FIRST. ──────────────────
  // A page's HTML references hashed CSS/JS chunks that change on every deploy.
  // Serving a stale cached page (the old cache-first bug) pointed at purged chunks
  // → 404 stylesheet → completely unstyled page. So navigations always hit the
  // network; the cache is only an OFFLINE fallback.
  const accept = req.headers.get("accept") || "";
  if (req.mode === "navigate" || accept.includes("text/html")) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then((r) => r || caches.match("/login")))
    );
    return;
  }

  // ── Data routes → network-first (fresh leads/dashboard). ─────────────────────
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/dashboard") || url.pathname.startsWith("/leads") || url.pathname.startsWith("/pipeline") || url.pathname.startsWith("/reports")) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then((r) => r ?? new Response("Offline", { status: 503 })))
    );
    return;
  }

  // ── Static, immutable assets only (icons / manifest) → cache-first. ──────────
  // NOTE: hashed /_next chunks are immutable and handled by the browser's HTTP
  // cache; we never cache HTML here anymore.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res.ok && (url.pathname.endsWith(".png") || url.pathname.endsWith(".svg") || url.pathname.endsWith(".webmanifest"))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match("/login"));
    })
  );
});

// ─── WEB PUSH ────────────────────────────────────────────────────────
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: "WCR CRM", body: event.data.text() }; }
  const title = payload.title || "WCR CRM";
  const sev = payload.severity ?? "INFO";
  const options = {
    body: payload.body ?? "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag,
    data: { url: payload.url ?? "/dashboard" },
    requireInteraction: sev === "CRITICAL",
    silent: false,
    vibrate: sev === "CRITICAL" ? [200, 100, 200, 100, 200] : [100, 50, 100],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/dashboard";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      // Reuse open tab if there is one
      for (const client of list) {
        if (client.url.endsWith(url) && "focus" in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
