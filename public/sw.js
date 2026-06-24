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
// v29 (2026-06-24): Lead intake batch — NEW website leads auto-assign by team (Dubai→Mehak, India→Tanuj) via assignLeadTo (Assignment-history + notify), toggleable in /settings; manual New-Lead remarks now attribute the "Lead Created" Smart-Timeline entry to the creator (date+time+user, no duplication); CSV+Google-Sheet imports map every project/property header variant (Project Name/Property/Enquired Property/Interested Project/Tower etc.) → Property Enquired; backfilled 19 existing leads' Property Enquired + corrected 27 genuinely mis-dated imported leads to their true sheet date.
// v30 (2026-06-24): Source+Medium reporting & nav — /reports/sources gains a Medium funnel table (Call/WhatsApp/Email+custom, same scope as the Source funnel); /reports index gains a "Leads by Medium" bar card; Leads + Master Data filter panels gain a Medium multi-select (?medium=, shared leadFilterWhere); left-nav reordered so Buyer Data sits immediately after Leads (Agent: Dashboard→Leads→Buyer Data; Admin: Dashboard→Master Data→Leads→Buyer Data), Buyer Data kept admin-gated. Display/filter-only — no schema or data changes.
// v38 (2026-06-24): Dashboard "Live Lead Assignment & Status" widget (ADMIN/MANAGER only; AGENT hidden). Per-agent grid BY ASSIGNMENT DATE — Fresh Received + current-status breakdown (Fresh/Contacted/Qualified/Meeting/Site Visit/Negotiation/Booked/Lost/Rejected/Active) + totals row + 8 summary cards (Assigned/Active/Rejected/Booked/Conversion%/Rejection%/Meeting%/Site-Visit%). Reuses buildAgentReport/drilldownWhere (extended AgentMetrics with cur* disjoint buckets via leadStatusColumn). Namespaced time/team filters (dwRange/dwTeam) + visibility-gated 60s auto-refresh (router.refresh) + every number drills into the agent-performance drill (count==records) + CSV/Excel export. Reconciles 1:1 with Leads/Master Data/Reports.
// v31 (2026-06-24): Agent Field Status — agents tap 6 mobile buttons on their dashboard (I Am Here · Leaving Office · Going/Returned For Meeting · Going/Returned For Site Visit) to log field movements; on "Returned" the matching "Going" is closed and the duration (IST-aware) is computed; manager (Lalit) is notified per event (in-app + push, INFO, duration on Returned) via new AGENT_STATUS NotifKind; "I Am Here" reuses the existing daily attendance self-check-in (no duplicate path); widget is state-aware (disables Returned until out, live elapsed timer) with today's movements list; new /admin/field-status console (ADMIN/MANAGER) shows who's currently OUT + today's movements; additive AgentStatusEvent table + AgentStatusKind enum.
// v32 (2026-06-24): Revival Engine = Leads experience — /cold-calls now gets the SAME list experience as /leads (DRY, reuses the Leads building blocks): shared <LeadFilters> panel + leadFilterWhere (team/owner/status/source/medium/tags/date/follow-up/search) scoped to cold/revival data; Saved Views via the shared <SavedFiltersBar> Smart Lists (/api/saved-filters); full bulk toolbar (Assign → /api/leads/bulk reassign → assignLeadTo → Assignment-history row + notify · Change team · Set status · Reject · Export CSV); Source/Medium columns + sortable headers; status chips reconcile 1:1 with records. Two additive shared bulk actions (set_team, set_current_status — ADMIN/MANAGER, team-strict, status-revalidating) added to /api/leads/bulk, mirroring Master-Data's change_team/set_status. Revival-specific features preserved (Hidden Gems, Daily Mission, Leaderboard, streak, Promote-to-Lead, cold-data admin controls).
// v33 (2026-06-24): Buyer Data is now a WORKED PIPELINE (Part 5a — backend/schema/lifecycle). BuyerRecord extended (ownerId/assignedAt/poolStatus[ADMIN_POOL|ASSIGNED|CONVERTED|REJECTED]/attemptCount/conversion+rejection fields/remarks) + 2 new tables (BuyerAssignment stint-history, BuyerActivity timeline) — migration applied to prod. Access is now SCOPED via buyerScopeWhere/canTouchBuyer: ADMIN sees all + the Admin Buyer Pool; an AGENT sees ONLY their own ASSIGNED buyers; MANAGER sees their team's; import/export/pool-assign stay ADMIN-only (so agents can now open /buyer-data for their assigned buyers). 4 lifecycle APIs: assign (ADMIN/MANAGER, bulk, opens stint + notifies agent), convert (assigned agent/admin → creates a real Lead via assignLeadTo, tags "Converted From Buyer Data" + Activity note, marks buyer CONVERTED), reject/return (agent → back to Admin Pool, history retained), activity/attempt (CALL/NOTE/WHATSAPP/VOICE_NOTE/ATTEMPT_* → on the 5th attempt the buyer AUTO-RETURNS to the pool, event-driven no cron). Every transition writes BuyerActivity + BuyerAssignment history; admin-visible history read path at /api/buyer-data/[id]/history. Regression +1 (buyer-lifecycle invariant → 40 checks). Additive/reversible.
// v34 (2026-06-24): Buyer Data UI (Part 5b) — /buyer-data is now the LEADS LIST EXPERIENCE: filter panel (poolStatus/owner/project/type/nationality/region/repeat/search), sortable columns, Saved Views (localStorage per-viewer), Admin-Pool/Assigned/Converted tabs, and an admin bulk toolbar (Transfer · bulk Edit · Export · soft-Delete to a reversible recycle bin) — added `deletedAt`/`deletedById` to BuyerRecord (migration applied; every read filters deletedAt:null). Detail page = a Lead view: lifecycle action bar (Convert→tagged lead · Reject/Return · Assign/Transfer), inline-edit fields, multi-property table (all records on the buyerKey), NOTES → IMPORTED FIELDS (between Notes & Conversation, per spec) → CONVERSATION/ACTIVITY timeline with log controls (Call/Note/WhatsApp/Voice + attempt → auto-return-at-5 warning) and admin agent-handling history. Import gains a COLUMN-MAPPING WIZARD (per column: match-to-field / keep-as-new-field / skip — never loses data). AI buyer distribution (rule-based, preview→confirm — NO LLM): assign-N-to-agent, split-equally (round-robin), by-region; + a daily auto-distribute toggle (default OFF) wired via /api/cron/buyer-distribute in GitHub Actions (Vercel hobby 2-cron cap untouched). Regression +1 (buyer-5b invariant → 41 checks). Additive/reversible.
// v35 (2026-06-24): Buyer Data REPORTING (Part 6) — new /reports/buyer-performance (+ nav card on /reports), the parallel of Agent Lead Performance for the worked buyer pipeline. ADMIN/MANAGER (agents = own-row only). Same period selector (Today…This Year + Custom, IST day boundaries) and DRY scaffolding as agent-performance: composable buildBuyerReport()/buildBuyerSummary()/buyerDrilldownWhere() in src/lib/buyerPerformance.ts; reuses the AgentPerfRangeSelector + the watermarked/audited CSV+Excel export pattern. Admin SUMMARY strip (Total · Assigned · Unassigned pool · Converted · Rejected · Returned · Active — all deletedAt-excluded). Per-agent table: Buyers Assigned (by BuyerAssignment stint-history, de-duped) · Converted · Rejected · Auto-/Manual-Returned · Calls/WhatsApp/Notes/Voice · Total + Avg attempts · funnel Assigned→Contacted→Engaged→Converted. Five ranking tables + [agentId] detail + [agentId]/drill (every number → the exact BuyerRecords behind it, with owner, full stint transfer history, attempt history, converted-lead link; event metrics show "N events across M buyers"). Reconciliation proven: metric==drill, summary==direct counts, deleted never counts (synthetic rolled-back E2E + new `buyer-performance` regression invariant → 42 checks). Read-only/additive — no schema change.
// v36 (2026-06-24): Buyer Data detail = LEAD VIEW (layout unification). /buyer-data/[id] rebuilt to reuse the Lead detail master template EXACTLY — same shell (LeadMobileTabs + grid lg:grid-cols-3 main+right-rail), header (name inline-edit + poolStatus chip styled like the Lead status chip + repeat-buyer chip + config/value snapshot chips), action button ROW (Call/WhatsApp/Email/Log Call/Note/Voice — BuyerActionsClient, same colours incl. the pinned-contrast Note button, wired to tel:/wa.me/mailto + POST /api/buyer-data/[id]/activity), Conversation History (Raw History = imported remarks verbatim + Smart Timeline = BuyerActivity, same card look), Quick Note (BuyerQuickNoteCard, navy Save), and a right-rail Buyer admin panel (BuyerAdminPanel: Convert→tagged lead · Assign/Transfer · Reject/Return + Attempt X/5 auto-return warning + transfer/stint history). Floating private sticky note reuses the EXACT Lead StickyNoteWidget (generalized with an apiBase prop → /api/buyer-data; Lead view untouched) backed by a new per-user-per-buyer BuyerStickyNote table (+ scoped PUT /api/buyer-data/[id]/sticky-note via canTouchBuyer). BELOW QUICK NOTE = the buyer-specific extra section: Property (Project/Tower/Unit/Type/Config/Size/Actual Size/Area/Country) + Transaction (Value/Date/ID/Price-per-sqft/Type/Role) + Buyer (Name/Co-Buyers/Phones/Emails/Nationality/Passport/Passport Expiry/Owner Name/Agent) + Imported Fields + the multi-property table (all records on the buyerKey). 8 new nullable BuyerRecord columns (passportExpiry/ownerName/country/size/actualSize/area/transactionType/role) added to the PATCH whitelist + 1 new table (BuyerStickyNote) — additive migration applied to prod. Lead view + Conversation History anywhere unchanged. Regression +1 (buyer-detail-unification invariant → 43 checks). Additive/reversible.
// v37 (2026-06-24): Buyer imports now behave like Lead imports — Raw History + Smart
// Timeline + dedup. Import wizard gains a "Remarks / Notes" mapping field + a duplicate-
// handling choice (Skip / Update existing / Add to conversation history / Create new) and
// sends the COMPLETE raw row. Import route: maps a Remarks column (or composes short Status/
// Follow-Up columns) → BuyerRecord.remarks VERBATIM (= Raw History); derives BuyerActivity
// Smart-Timeline rows from it via the SAME parser leads use (historical dated segments
// honored, else the import date); stores the full original row on the new BuyerRecord.rawImport
// column (immutable audit, surfaced in the detail "Original Imported Row"); and dedups by
// buyerKey/phone/email so re-import never silently creates duplicates. Retroactively backfilled
// the 4 existing buyers (remarks + timeline, idempotent). Additive migration (rawImport JSONB)
// applied to prod. Regression +1 (buyer-import-history → 44). Additive/reversible.
// v39 (2026-06-24): Import Mapping Wizard for ALL lead importers. The 3 importers that
// previously POSTed straight to the engine with no preview/mapping (Google-Sheet,
// Pre-assigned MIS, Cold-data/Revival) now run the SAME shared Import-Mapping-Approval
// wizard the main CSV uploader uses (new src/components/LeadImportWizard.tsx reusing
// ImportMappingTable): upload/connect → preview detected columns → suggested CRM-field
// mapping (auto-detect as a SUGGESTION) → per-column confirm / re-map / ignore(→customFields)
// → 10-row data preview with duplicate flags → DUPLICATE-HANDLING choice (Merge / Skip /
// Update / Create new / Add as conversation) → import + full report. Mapping config +
// fuzzy pick + makeMappedPick + buildMapping extracted to a shared src/lib/importMapping.ts
// (DRY — CSV + Google-Sheet routes + regression all use it). Engine: /api/intake/google-sheet
// gained ?preview + explicit mapping + dupMode (parity with /api/intake/csv); both routes now
// accept dupMode; ingestLead gained skipDedup for "Create new anyway" (null fingerprint, no
// index collision). importer-specific presets preserved (assignToUserId / isColdCall ride
// along on preview + import). Additive/backward-compatible — absent mapping/dupMode = legacy
// behaviour. Regression +2 (import-mapping toolkit + import-wizard-parity → 47 checks).
// v40 (2026-06-24): New-Lead form corrections — Property Type is now a REQUIRED
// dropdown (Residential/Commercial/Mixed Use, blocks submit if empty) + added as a
// multi-select to the Lead/Master-Data/Revival filter panels (?propertyType=, shared
// leadFilterWhere + Leads inline where) and to Reports (a Property-Type funnel on
// /reports/sources + a "Leads by Property Type" bar card on /reports). Interested
// Properties upgraded from a weak <datalist> to a TRUE searchable combobox
// (ProjectSelect — styled, keyboard-navigable, team-filtered + saves a custom typed
// name → sourceDetail). Title-Case labels (Customer Name, Alternative Name/Mobile/Email,
// Budget Min/Max, Medium→"Medium of Source", Assignment History). Assign-To helper text
// removed. Master Data Property Type column un-hidden by default. Display/filter-only —
// no schema or data changes; Current Status field untouched.
// v41 (2026-06-24): Gallery / Resource Library module — new /gallery nav item +
// page (upload images/PDF ≤5MB, URL links, text templates; categorize; search;
// multi-select; share via WhatsApp/Email with public file links; share tracking).
// Lead-detail "Share Resource" affordance + per-lead share history; gallery
// resources surfaced in the WhatsApp/Email template picker. Public token-gated
// download endpoint streams file bytes to clients without login.
// v42 (2026-06-24): Gallery — agents can now upload/create resources (direct, no
// approval) + edit/delete their OWN uploads; ADMIN/MANAGER still manage ANY. Upload
// UI (button + Upload/Link/Template modals) now shows for agents. Reject Lead — new
// "Expo Only" reason offered ONLY on Dubai-team leads; rejecting logs Rejected + reason
// + user + IST time to the Smart Timeline.
// v43 (2026-06-24): Action List rebuilt as a follow-up board keyed on
// Lead.followupDate — Today (now incl. later-today, not just overdue) / Tomorrow /
// Overdue / Custom-date tabs + Agent/Team/Status filters; shows EVERY follow-up for
// the chosen date regardless of status (status narrows only when picked), count ==
// records, permission-scoped (agent own / manager team / admin all). Lead Detail
// header gains Complete / Snooze (IST date-time picker) / Escalate buttons reusing
// the same action-complete/-snooze/-escalate endpoints; each logs a Smart-Timeline
// Activity. Escalate now also notifies the owner's manager + admins.
// v44 (2026-06-24): Three polish fixes — (1) buyer lifecycle events now use
// dedicated NotifKinds (BUYER_ASSIGNED / BUYER_CONVERTED / BUYER_RETURNED) so a
// manager can tell a buyer event from a lead event in the bell (INFO severity, not
// a hot-lead alert); (2) Buyer detail Property card no longer shows the unit number
// under two labels (removed the duplicate "Property / Unit"); (3) the Google-Sheet
// importer now honours an admin-confirmed Date-column mapping (parity with the CSV
// route) instead of always auto-detecting the date column.
// v45 (2026-06-24): Lead-detail UI compaction (layout only) — the Complete /
// Snooze / Escalate follow-up buttons now sit INLINE on the same action row as
// Call / WhatsApp / Email / Log Call / Note (one flex-wrap row) instead of a
// separate stacked row below, reclaiming vertical space and keeping the actions
// above the fold. No business logic / endpoint / permission change.
// v46 (2026-06-24): CRM-wide Action Design System (visual standardization only) —
// new single source of truth src/lib/actionDesign.ts (13-action token map: icon +
// colour + tooltip + hover/disabled/loading + sm/md sizes + dark mode) consumed
// by two reusable components (ActionButton solid/labeled, ActionIconButton ghost/
// solid icon-only) + a shared brand WhatsAppGlyph. Replaced every scattered/
// divergent action button & icon across Lead view, Buyer Data, Action List,
// Revival/Cold-Calls, Leads table (both desktop variants + mobile), Inbox,
// Calls, Hidden Gems, Gallery share, Reject modal, Template picker, and the
// Smart-Timeline dot colours + AgentStatusBar tones — so the same action looks
// identical everywhere (killed: blue-vs-emerald Call, 3 inline WhatsApp/phone
// SVGs, sky/indigo Email, amber-vs-token follow-up). Note button keeps its
// dark-navy-on-amber contrast. NO business logic / endpoint / permission change.
const CACHE = "wcr-shell-v46";
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
