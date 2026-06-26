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
// v47 (2026-06-24): Dashboard field-status + sales-report fixes. (1) "I Am Here"
// is now once-per-IST-day — the button locks to a non-clickable "Checked in ✓"
// state after the first daily check-in (driven by attendance OR a HERE event),
// and the /api/agent-status engine no-ops a 2nd HERE (keeps the first timestamp,
// doesn't re-notify). (2) Site-visit buttons (Going/Returned For Site Visit) are
// HIDDEN for the Dubai team (no local site visits); meeting buttons stay for both
// teams; India keeps all six. (3) Dashboard "By Salesperson" sales board now
// filters u."hrOnly" = false so HR/non-sales users (e.g. Nisha) never appear on
// the sales performance report (the Live-Assignment widget already excluded them).
// Additive/reversible; legacy duplicate HERE rows preserved as-is.
// v48 (2026-06-24): Leads table — Excel-style per-column header filters on every
// relevant column (Name, Enquiry Date, Property Enquired, Status, Budget, Follow-up,
// Assigned, Source, Team) + asc/desc sort incl. new Assigned sort; all combine with
// the top filter panel + quick chips via AND and stay count==rows (owner/team ?param=
// now multi-select on the server). Actions column has NO filter. Row actions in the
// Actions column + cards rebuilt: removed the duplicate "Set follow-up" calendar
// button, added Complete / Snooze / Escalate (ActionIconButton, shared
// /action-complete|-snooze|-escalate endpoints — no dup logic, router.refresh for
// instant update). Snooze reschedules followupDate via the shared CRMDatePicker (IST)
// so the lead leaves Today/Overdue; its Smart-Timeline entry now names the user
// ("snoozed to … by <user>"). UI-only; no schema change.
// v49 (2026-06-24): Buyer Data table — Excel-style per-column header filters + sort
// on every business column (Client Name, Status, Project, Tower/Unit, Type, Txn
// Value, Txn Date, Nationality, Agent, Attempts, Buyer Count). Each header offers
// asc/desc sort (text A→Z, numeric low→high, date oldest→newest), a filter dropdown
// with search, multi-select values, and clear (per-column + clear-all). All combine
// via AND with the existing top filters / saved views / search / bulk-select (which
// targets the FILTERED set) and export (POST of the filtered ids — audited, still
// ADMIN-only); count stays == visible rows. Actions column has NO filter. The new
// client-state ColumnHeaderFilter component is shared with Master Data (DRY across
// both client-side tables); the mobile card view exposes the same filters as chips.
// UI-only; buyer scope / permissions / schema untouched.
// v50 (2026-06-24): Proper-Case (Title-Case) name normalization. Names now store
// clean at the source — "ABHISHEK ARORA" → "Abhishek Arora", "MR. RISHI RAI" →
// "Mr. Rishi Rai" — via src/lib/nameFormat.ts applied on EVERY write path (lead
// ingest/import/manual/inline-edit, buyer import/create/update/convert). Only
// all-UPPER / all-lower values are touched; intentional mixed-case ("McDonald")
// and non-name values (email/code) are preserved. A one-off migration backfilled
// existing rows (31 Lead + 3 Buyer fields). Refresh so name fields render the
// cleaned values. Display-only formatLeadName unchanged; no schema change.
// v51 (2026-06-24): Dashboard fixes. (A) "Live Lead Assignment & Status" widget
// percentages now all COHORT-based — Rejection/Conversion/Meeting/Site-Visit
// rates = (cohort members now in that state) ÷ (leads assigned in the period),
// so every rate is 0–100% (kills the 233.3% Rejection Rate from comparing
// owner-scoped rejections against the assigned cohort). New same-cohort
// curRejected metric + drill (assigned-in-window AND now rejected); the grid's
// Rejected column + Rejected summary card switched to it; tooltip/help text with
// the exact formula on EVERY KPI header + summary card. (B) Greeting is now
// timezone-aware + live — a client island computes Morning/Afternoon/Evening/
// Night from the user's tz (India→IST, Dubai→GST) and auto-updates across
// boundaries (no more "Good morning" at 4 PM IST; no stale cached greeting).
// v52 (2026-06-24): Master Data Import — admin-only "Import" button on /master-data
// mounts the SAME shared Import-Mapping-Approval wizard (Excel + CSV): upload →
// preview detected columns → confirm/re-map/ignore each column → 10-row data
// preview with duplicate flags → duplicate-handling choice (Merge/Skip/Update/
// Create new/Add as conversation) → import + report. Imported rows land as sales
// leads (non-cold) so they show in the Master Data grid. Mapping catalog extended:
// Assigned User → owner (matched to a CRM user by name/email; unmatched → left
// unassigned + listed in the report) and Alternate Email → altEmail; Client Name /
// Alternate Mobile aliases added. Duplicate PREVIEW now matches by Mobile OR
// Alternate Mobile OR Email OR Alternate Email (not phone alone). Sheet Date still
// drives the lead date (never the import timestamp); Remarks → Raw History + Smart
// Timeline; unknown columns → Imported Fields. Endpoint stays ADMIN-gated. Force a
// client refresh so the new Import control appears.
// v53 (2026-06-24): Dubai Buyer Data — the Buyer Data module is now market-scoped
// to Dubai. (1) RENAME: every visible "Buyer Data" label → "Dubai Buyer Data" (nav,
// page titles, import/export, reports + reports nav card, assign dialogs, notifs).
// Route paths (/buyer-data, /api/buyer-data/*) UNCHANGED — display-only. (2) MARKET
// FIELD: BuyerRecord.market (default "Dubai", indexed, backfilled); every buyer read
// (list/detail/reports/distribution/export/assign) pins market="Dubai"; imports stamp
// it. (3) ASSIGNMENT: only Dubai-team users + admins are offered/accepted (UI roster +
// server-enforced in assign/transfer/distribute/convert — India/Gurgaon + HR rejected).
// (4) VISIBILITY: Admin + Dubai-team only; non-Dubai agents redirected from every
// /buyer-data + /reports/buyer-performance page; the nav item is hidden for them. The
// distribution console drops the (now-meaningless) region filter. A FUTURE Gurgaon
// module is separate (own market value + rules). Force a refresh so the rename + the
// hidden-for-non-Dubai nav take effect.
// v54 (2026-06-24): Smart Timeline (Lead View) = PROCESSED CRM EVENTS ONLY. The Smart
// Timeline tab no longer renders the raw imported remark blob (e.g. "DAMAC Property Expo
// in London") — that stays verbatim in the Raw History tab. It now shows ONE unified,
// newest-first stream of genuine CRM events (calls · WhatsApp · notes · CRM activities),
// sorted by effective IST timestamp descending across all types. Each Activity card gets
// a per-entry ✏️ Edit on the right — ADMIN / Super-Admin ONLY (agents never see it; the
// PATCH /api/leads/[id]/activities/[activityId] endpoint 403s a tampered non-admin
// request). The edit modal edits Date/Time (IST) · Type · Outcome · Remark · Follow-up;
// on save it updates the Activity in place, mirrors a follow-up onto the lead, and
// preserves the prior value per field in the ActivityEdit audit table (no data loss;
// Raw History untouched). Force a refresh so the new timeline + per-card edit appear.
// v55 (2026-06-24): Log Conversation validation. Outcome no longer defaults to
// "Connected" — it opens blank as "-- Select Outcome --". A logged conversation now
// REQUIRES all three: Outcome + Next Follow-up Date + Remarks (enforced client-side
// AND server-side — blank → 400, no junk row). The follow-up picker is always shown
// and mandatory (sets Lead.followupDate so every client has a next action). The
// outbound WhatsApp log (template/type/gallery send) now also requires a follow-up
// date before it logs — the wa.me open + template logic is otherwise unchanged. Each
// logged call/WA now stamps outcome + follow-up onto its Smart Timeline entry. Force a
// refresh so the blank-outcome default + the new validation reach every PWA client.
// v56 (2026-06-24): Follow-up completion workflow. ✅ Complete is now GATED — an agent
// can't complete a follow-up without first logging a call/WhatsApp/email TODAY (server
// 400 + the Complete button is disabled with a "Contact attempt required" tooltip in all
// four surfaces: Action List, Leads table, Lead card, Lead detail). After a Log Call or
// WhatsApp send a "What next?" popup (Complete · Snooze · Escalate) forces the agent to
// close the action. Snooze now requires a short reason when there's no client response
// (logged to the timeline); changing the Follow-up Date without a logged activity is
// blocked unless the agent gives a reschedule reason. New Daily-Report "Follow-up
// Workflow" section (due/completed/after-call/after-WA/snoozed/snoozed-without-contact/
// escalated/pending-at-EOD). Force a refresh so every PWA client gets the gated buttons.
// v57 (2026-06-24): Admin Lead-View full edit + dropdown-lock fix. (1) Fixed the
// "Medium locks after first selection" bug — InlineEdit selects now ALWAYS inject the
// current value as an option, so every dropdown (Medium, Source, Configuration, Property
// Type, Team, Status, BANT) reopens and is changeable any number of times (root cause:
// a stored value absent from the options list made the <select> fall back to the blank
// placeholder, looking locked). (2) Every Lead-View field is now inline-editable for
// Admin/Super-Admin (added Alt email; all listed fields wired) with check/cross save +
// immediate refresh. (3) Imported Fields (customFields) are admin-editable via a
// MERGE-safe PATCH (one key at a time, other keys never dropped); agents stay read-only.
// (4) Change History (LeadFieldHistory) now records ALL of them — medium/mediumOther/
// altPhone/altEmail/linkedInUrl/sourceDetail/propertyType/configuration/BANT/meeting/
// site-visit + customFields.<key> — field/old/new/by/when. Force a refresh so PWA
// clients pick up the reopenable dropdowns + new editors.
// v58 (2026-06-24): Dashboard data integrity — count == drill-down on every widget.
// (1) Fixed the "Hot Leads Untouched = 8 but click shows 0" bug: the card count and
// the card's /leads link were two different queries. Every hero card now uses ONE
// canonical where for BOTH its number and its drill (count == rows opened == DB).
// (2) "Hot Lead Untouched" REDEFINED — was a 6h-stale-touch threshold; now = Hot +
// assigned + workable + NO contact logged yet (no call/WhatsApp/email/meeting/site-
// visit Activity). New /leads?untouched=1 filter reproduces it exactly. (3) Closable-
// deals card no longer links to a non-existent status=NEGOTIATION (drills to the
// closing-stage smart filter). (4) Meetings/Site-Visits/Virtual cards drill to the
// matching activity bucket for today. (5) Every agent widget stays owner-scoped
// (own book only — no deleted, no cold/buyer-pool, no cross-user). (6) "I Am Here"
// duplicates cleaned (kept the first check-in per IST day); the movement feed no
// longer repeats "I Am Here … I Am Here" — single current status; daily reset
// (yesterday's check-in never shows as today's). Force a refresh so PWA clients get
// the corrected dashboard numbers + links.
// v59 (2026-06-24): Dubai Buyer Data detail = genuinely the Lead detail layout.
// The buyer Conversation History card was visually out of step with the Lead view
// (different padding, no emerald tint, no Raw History / Smart Timeline toggle, no
// scroll container). BuyerActivityTimeline now uses the EXACT ConversationStreamCard
// shell — card p-5 · emerald left-rail · faint emerald tint · Raw/Smart segmented
// toggle · max-h-[620px] scroll — so the most prominent card matches the Lead view.
// Buyer header inner wrapper aligned to the Lead's. Removed the orphaned, superseded
// BuyerDetailActions component. Buyer-specific extras (Property/Transaction/Buyer +
// multi-property table) remain the ONLY addition, below Quick Note. Force a refresh
// so PWA clients see the unified buyer detail (network-first serves fresh HTML; a
// hard refresh is not required but clears any stale shell instantly).
// v60 (2026-06-24): Master Data inline-edit dropdowns no longer clip/hide behind the
// table. EVERY editable cell (Agent/Team/Status/Property Type/Source/Medium/Bucket)
// now opens its dropdown through a PORTAL (document.body, position:fixed off the
// trigger's rect, z-9999, re-measured on scroll/resize, flips up near the viewport
// bottom, click-outside/Esc to close) instead of an absolute menu trapped inside the
// grid's overflow-x-auto scroll container. Fixes hidden/buried dropdowns, z-index
// burial behind frozen columns, and row-height jump — the read cell stays put while
// only the floating editor overlays. CSS/render-only; save logic + endpoints unchanged.
// v61 (2026-06-25): Dubai Buyer Data detail = Lead detail, 3rd alignment pass. Both
// pages now source their card/grid/action-row shells from a SHARED token module
// (src/lib/detailLayout.ts) so they can't drift again. Fixes the divergences the
// prior 2 passes missed: (1) the buyer ACTION ROW was a rigid grid → now the Lead's
// fluid flex-wrap row (ACTION_ROW); (2) the buyer RIGHT RAIL was thin → now carries
// the same core cards as the Lead rail (Client information + 📍 Location + a
// Scheduling-slot "Purchase summary" card), so the left/right balance reads
// identically; (3) Buyer-Intelligence card uses the shared VERDICT_CARD shell/tint.
// Buyer-only extras (Property/Transaction details + multi-property table) remain the
// ONLY addition, below Quick Note, in the SAME card style. Render-only; the Lead view
// is untouched. Force a fresh shell so PWA clients see the unified buyer detail.
// v62 (2026-06-25): HR fully excluded from SALES surfaces. The Team scoreboard roster
// (/team) and the Agent Leaderboard (/reports/leaderboard) now filter hrOnly:false, so
// an HR/non-sales user (Nisha, an hrOnly MANAGER) can no longer appear among sales
// agents with call/pipeline/leaderboard stats. The Master-Data and Cold-Data bulk-assign
// server guards also reject an hrOnly target (defense-in-depth; the pickers already hid
// them). Driven off the canonical hrOnly flag, not a name. Data/roster-only; force a
// fresh shell so cached client bundles pick up the corrected rosters.
// v63 (2026-06-25): Data-integrity batch. (1) Historical CALL activities now show
// their real outcome chip in the Smart Timeline — Activity.outcome backfilled from
// each call's CallLog (1084 rows; forward-only on per-activity followupDate/
// actionContext, which can't be accurately reconstructed). (2) Terminal leads
// (booked/sold/lost/rejected) no longer pollute the Action-List "Overdue" board:
// the reject flow + the /update status-change path now CLEAR followupDate on a
// terminal status, and 105 existing terminal leads were cleared — so Action-List
// Overdue (90) reconciles 1:1 with the Leads Overdue chip (90). (3) 54 leads with
// a null sourceRaw backfilled from the source enum so the Source filter includes
// them. (4) 22 mis-cased statuses folded to canonical ("Long Term Followup" etc →
// "Long Term Follow Up"; "Fund Issue" → "Funds Issue") so each shows under one
// chip. Data + filter changes — force a fresh shell so chips/counts refresh.
// v64 (2026-06-25): Correctness + security batch (code-only). (1) Deleted the
// orphan /api/leads/export route — an un-watermarked, un-audited, weakly-gated
// data-exfiltration path with ZERO UI references; the sole export is now
// /api/reports/export (ADMIN-only + watermarked + audited). (2) Dashboard
// Meetings / Site Visits / Virtual Meetings tiles now drill to /activities with
// planned=1 (+view= for the admin team selector) and the /activities "Scheduled
// Today" list reproduces the tile's EXACT where (userId/team attribution +
// status:PLANNED + IST-day window) — count == drill (was userId-vs-ownerId +
// missing status filter). (3) Revival Engine: the "All" chip / totals now exclude
// soft-deleted cold leads (deletedAt:null on originCold) so All == Σ status chips;
// and the /leads/:id cold redirect keys on isColdCall OR leadOrigin∈{COLD,REVIVAL}
// so cold/revival records always land in Revival Engine. Bump to refresh the shell
// so the corrected tile drill-hrefs are served.
// v65: Master Data gets a real mobile card layout (< sm) replacing the unusable
// wide horizontal-scroll Excel grid + full-width preview drawer on phones; Smart
// Timeline shows an imported-history hint (→ Raw History tab) for imported-only
// leads instead of a bare empty state. UI-only; bump to ship the new shell.
// v66: Smart Timeline now PARSES the imported rawRemarks blob into one clean dated
// card per remark (date → author → FULL body, no truncation), interleaved newest-
// first with calls/WhatsApp/notes/activities; each carries an "Imported" chip. The
// imported-only hint now only shows when ZERO entries parse. Follow-up-date changes
// + admin inline-field edits (system NOTE activities) are surfaced too. Parse-on-
// render only — no data mutation; verbatim blob unchanged in Raw History. Bump shell.
// v67: Smart Timeline per-entry Edit now works for AGENTS on their OWN free-text
// activity (meeting/visit/discussion/email/brochure) on the SAME IST day they logged
// it — including EXISTING same-day rows already in the DB (gate keys on the entry's
// stored createdAt + author + role via shared canEditActivity, not an admin-only flag).
// Previous-day, another agent's entry, or system-generated kinds stay locked (server
// re-enforces, 403). Admin/Manager/Super unchanged. Bump shell to ship the new gate.
// v68: Revival Engine import now RE-ENGAGES existing leads instead of skipping them.
// New dupMode="revival" (the Revival/cold preset default): an existing-lead match is
// PROCESSED non-destructively — fill-if-empty merge (never overwrites a set field),
// appended remark history (mergeRawRemark → parsed into a dated Smart-Timeline card),
// a NOTE timeline entry, moved into the Revival bucket (leadOrigin=REVIVAL+isColdCall),
// revival-source stamp, tag UNION, + a per-field LeadFieldHistory audit. The wizard
// gains a "Revive existing" radio + a "Revived (re-engaged)" stat so an all-duplicates
// upload reports the revived count, not "0 new leads". Bump shell to ship the new UI.
// v69 (2026-06-25): Three lead-detail fixes. (1) Alt-number Call/WhatsApp buttons now
// render only when a genuinely DIALABLE alt number exists — a blank / whitespace /
// bare-dial-prefix ("+91") alt no longer shows them (hasDialableNumber gate, lead +
// buyer detail). (2) "Property Enquired" now reads the ONE canonical field
// (sourceDetail) on lead detail, the Leads table, AND Master Data so all three agree
// — the Leads table previously hid genuine free-text property enquiries behind a
// registered-project-only filter. (3) A fresh lead's auto follow-up now defaults to
// createdAt + 10 min (was today 7:00pm IST) on every creation path; imported rows that
// already carry a follow-up are preserved; 48 untouched auto-7PM leads were backfilled.
// v70 (2026-06-26): Active Follow-up Board + Revisit Queue. (1) The Action List board,
// the Leads follow-up chips, and the Dashboard follow-up widgets now share ONE
// definition (activeBoardWhere): terminal/rejected leads NEVER appear on the board, and
// MASTER_DATA-origin leads appear only when BOTH assigned and scheduled — so the
// Action-List ⇄ Leads-chip reconciliation is exact. (2) NEW Revisit Queue page
// (/revisit-queue, nav item): a read-only, permission-scoped triage list of
// rejected/closed leads that still carry a follow-up (a "Revisit"). To return one to
// active, an admin changes its status off the terminal value via the existing inline
// editor. Also bundles the parked Complete/logging change (Complete rolls follow-up
// +1 day; Log Call/WhatsApp no longer set a follow-up). Bump shell to ship the new
// board behaviour + Revisit Queue nav.
// v71 (2026-06-26): Revival Engine list = Leads list. /cold-calls now mounts the SAME
// <LeadsListClient> grid /leads uses (via a thin RevivalLeadsListClient wrapper),
// cold/revival-scoped — identical columns (Property Enquired/Status/Budget/Follow-Up/
// Assigned/Source/Last Activity/Actions), per-column header filters, sorting,
// pagination, status badges, bulk toolbar and row actions (Call/WA/Complete/Snooze/
// Escalate/Reject); rows link to the cold-data detail; the Revival-only "Promote to
// Lead" rides along via an additive extraRowAction prop (default off for /leads). The
// old slim RevivalEngineListClient is retired (kept in repo, unmounted). (2) The
// Revival cold-data DETAIL page gains a Reject button (the same origin-safe
// RejectLeadModal + /api/leads/[id]/reject) — a rejected cold lead STAYS in Revival as
// Rejected (never promoted / moved to Leads). (3) Conversation timeline never shows the
// literal "Agent": actor resolves to the real user → "System" (system STATUS_CHANGE
// rows) → the lead owner's name → "Unknown User"; outbound WhatsApp shows the owner or
// "Outbound". Pure render fix — fixes all historical + future rows, no data migration.
// Bump shell so every client loads the new Revival grid + timeline labels.
// v72 (2026-06-26): Reporting-count unification + 4 confirmed reporting-bug fixes.
// (1) ONE canonical "active operational lead" definition — activeLeadWhere() in
// leadScope.ts (leadOrigin ∈ ACTIVE_LEAD, non-deleted, non-terminal status). Every
// "active leads" surface (/reports/leaderboard, /reports, /team, /reports/
// agent-performance, /profile, /team/[id]) now routes through it, so the SAME agent's
// active count is identical everywhere. Closes the ~245-lead gap where untriaged
// Master-Data imports were wrongly counted as active (the old `leadOrigin notIn COLD`).
// (2) M1: manager-emailed Lost report switched from the DEAD `status=LOST` enum to
// currentStatus ∈ LOST_STATUSES (3 → 175); Won/quality funnel likewise off the dead
// status enum. (3) M3: Master-Data category/queue counts now apply the active table
// filter → header badge == table rows under any filter. (4) M5: Revival adds a Fresh
// chip for status-less cold leads → 'All' == Σ status chips. (5) Follow-up dates now
// render in IST (Asia/Kolkata) on Leads/Revival/Revisit-Queue/Inbox — an IST-midnight
// follow-up no longer shows as the prior day. All additive/display + count-only; no
// data writes, dashboard count==drill preserved. Bump shell so clients load the fixes.
// v73 (2026-06-26): Smart Timeline Edit-affordance UI-correctness fix. A surfaced
// SYSTEM audit row ("Inline edit: N field(s)") no longer renders a "Edit"-labelled
// chip (or a ✏️ pencil) that read as a broken, unclickable Edit button — it now shows
// a neutral "🛈 System" chip. Real per-entry Edit buttons are unchanged and stay
// gated by canEditRemark (notes) / canEditActivity (activities): admin/manager → any
// editable entry; agent → only their own same-IST-day free-text comment; never on
// system rows. Pure render-gating fix (retroactive to all rows), no data/permission
// change. Bump shell so every client loads the corrected timeline.
// v74 (2026-06-26): Leads page gets a compact, premium rotating motivational
// banner above the filters/table — personalised with the user's first name,
// rotates 5 messages every 7s (fade/slide, reduced-motion aware), soft
// champagne→navy gradient that follows the theme tokens in Light/Dark/System.
// Purely presentational (new isolated MotivationBanner client island); no data,
// no business logic, no permission change — the leads table/filters are
// untouched. Bump shell so every client loads the new banner.
const CACHE = "wcr-shell-v83";
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
