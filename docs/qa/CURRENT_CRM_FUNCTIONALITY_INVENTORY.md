# White Collar Realty CRM — Full Functionality Inventory
**Audit Date:** 4 June 2026 | **Auditor:** Claude QA Agent | **Commit:** d2056a4
**Live URL:** https://crm.whitecollarrealty.com

---

## 1. PAGE-BY-PAGE MODULE INVENTORY

### 1.1 /dashboard — Sales Command Center
**Purpose:** Real-time command center for Lalit and team leads. Central hub of daily operations.

**Functionality Built:**
- IST-based date filter (defaults to today via server redirect)
- Team filter tabs: Dubai / India / All (Admin only)
- 4-tile urgent row: Hot untouched leads, Overdue follow-ups, Closable deals, Cold revival
- 5-tile scheduled row: Calls due, Follow-ups due, Meetings, Site Visits, Virtual meets
- "I am here" attendance check-in widget (all roles)
- Daily call target progress bar (Agents only)
- Team daily target tile (Dubai or India scoped)
- Morning greeting with time-aware text (good morning/afternoon/evening)
- "Today's Mission" — highest-priority single lead card
- Last Vault WIN reminder
- UPCOMING section: follow-up chips + next 8 activities list
- Team Scoreboard: calls by agent for selected period
- Weekly Summary: New Leads / Contacted / Qualified+ / Won vs last week
- 8-tile Analytics section: Calls Dialed, Connected, Follow-ups Due, Overdue, Ready to Close, Needs Attention, WA Touches, Total Clients
- Team-specific funnel KPIs (Dubai: Calls, Virtual, Office, Expo, Site Visits; India: Calls, Site Visits, Home Visits, Office, Cold→Lead)
- By-Salesperson table: Calls, Connected, Due, Overdue, Closeable, Needs Manager, Clients
- Testing mode banner when enabled

**Role Access:**
- Admin: Full view, all teams, toggle buttons
- Manager: Own team only (no toggle), scoreboard and weekly metrics
- Agent: Own leads only in KPI tiles, no scoreboard/weekly summary, no by-salesperson table

**Buttons/Actions:**
- Date filter button (custom range picker)
- Team filter links
- "Action List" CTA button
- "I'm here" attendance button
- "Today's Mission" lead card link
- All KPI tiles are clickable links to filtered lead lists

**UX Issues:**
- Viewport reported as 0x0 — page renders but accessibility tree reads empty on region [ref_63]; this may be a Next.js server component rendering issue during the accessibility read
- Dashboard data is ALL live-calculated on each load — no caching layer visible in page.tsx; with 25,000 leads this becomes 20+ concurrent Prisma queries
- The "closable deals" tile counts `NEGOTIATION where eoiStage NOT NULL` — most deals in NEGOTIATION show 0 because eoiStage is not being set, making the tile mislead agents
- The "Needs Your Attention" tile header hardcodes "Needs Lalit" in the by-salesperson table regardless of who is logged in

**Mobile:** Has a dedicated bottom nav (Dashboard, Leads, Revival, To Do, Properties). Page loads correctly on mobile. Some KPI tile text may be tight at 390px width with 2-column grid.

**Missing Features:**
- No real-time push refresh (page must be manually reloaded for live data)
- No sparkline/trend charts on KPI tiles
- "I'm here" check-in does not automatically mark attendance when agent opens the page (requires button tap)

**Production Readiness: READY** (minor performance concerns at scale)

---

### 1.2 /action-list — Priority Action List
**Purpose:** Smart prioritized to-do list. Shows what each user should act on RIGHT NOW. Admin sees all teams; agents see own leads.

**Functionality Built:**
- Three sections: Ready to Close (NEGOTIATION/SITE_VISIT), Needs Attention (manager-flagged), Follow-ups Overdue
- Each lead card shows: name, phone, team, status, follow-up type, overdue duration, owner, last touch time, budget
- Full remark preview with latest note
- AI-generated "Next step" and "Why you" rationale
- Pre-filled WhatsApp draft message
- "Mark done" button per follow-up
- "Snooze" button with dropdown timing
- "Escalate" button
- Direct WhatsApp link (deep link to wa.me with pre-filled message)
- Direct phone call link (tel:// protocol)
- "Full history" link to lead detail

**Current Data State (4 Jun 2026):**
- Ready to Close: 0 leads (no NEGOTIATION leads with eoiStage set)
- Needs Attention: 0 leads
- Follow-ups Overdue: 8 leads (all with 7h overdue — set for 3 Jun 7pm IST)

**Role Access:**
- Admin: All teams, all agents' leads
- Manager: Own team's leads
- Agent: Own leads only (same UI, narrower data)

**Buttons/Actions:** Mark done, Snooze dropdown, Escalate, WhatsApp, Call, Full history link

**UX Issues:**
- "Snooze" button is `⏸ Snooze ▾` — not visually obvious what snooze durations are available without clicking
- Budget display shows "AED 3.0 M–AED 50.0 M" ranges that come from different data fields (budgetMin / budgetMax); the AED 50.0M on one lead is likely a data entry error (Neha Talwar shows 3.0M–50.0M)
- WhatsApp draft messages are generic ("schedule a site visit this week") — same text for all leads regardless of their stage or previous conversation
- All 8 overdue leads show exactly "7h overdue" (set for 7pm yesterday IST) suggesting a batch follow-up date was set rather than individual dates

**Mobile:** Works — buttons have adequate tap targets. Cards stack vertically. WhatsApp and Call links work natively on mobile.

**Missing Features:**
- Bulk mark-done
- Filter by agent (for admin)
- Sort order (currently date-based)
- The "Escalate" button likely does nothing in testing mode (automation paused)

**Production Readiness: READY** (functional; UX polish needed)

---

### 1.3 /leads — Lead List
**Purpose:** Master list of all 44 active leads. Search, filter, export.

**Functionality Built:**
- Lead count: 44 total, 0 new today, 8 hot
- Quick filter tabs: All, Today, Overdue, Hot, Site Visit, Negotiation, Unassigned, Dubai, India
- Advanced filters panel (hidden by default)
- Search box: name / phone / email / company
- Import link → /intake
- Export to CSV → /api/reports/export?type=leads
- New Lead button → /leads/new
- Kanban pipeline view → /leads/kanban
- Archived leads → /leads/archived
- Per-lead row: checkbox, name link, status chip, AI score, team, budget, last touch, owner
- Per-lead quick actions: Call (tel://), WhatsApp (wa.me), Copy phone number
- Pagination: "Showing 1–44 of 44" / "Page 1 of 1"
- Bulk selection via checkboxes

**Role Access:**
- Admin: All 44 leads visible
- Manager: Own team's leads
- Agent: Own leads only

**Buttons/Actions:** Import, Export CSV, New Lead, Advanced Filters, Kanban view, Archive view, Call, WhatsApp, Copy Phone, Select All checkbox

**UX Issues:**
- Leads list at 44 entries fits one page, but the same query pattern with 25,000 leads will require cursor-based pagination (current limit/offset will degrade)
- Advanced filters panel not tested (hidden by default)
- No visible column sorting (date created seems to be default)
- Some leads have no owner assigned (shown as "—" on action-list)
- "8 hot" count shown in header but Hot leads vary by AI scoring which is currently disabled

**Mobile:** List renders in a compact card format. Call and WhatsApp buttons are present and sized for thumbs. Horizontal scroll risk on wide tables — partially mitigated by card format.

**Missing Features:**
- Saved filter chips (SavedFilter model exists in schema but no visible saved filter UI in the list tab bar beyond hardcoded quick filters)
- Column sorting
- Last call date column

**Production Readiness: READY for 44 leads; NEEDS WORK for 25,000 leads (pagination architecture)**

---

### 1.4 /leads/[id] — Lead Detail Page
**Purpose:** Full profile and interaction history for a single lead.

**Functionality Observed (from accessibility tree and schema):**
- Lead header: name, phone, alt phone, status chip, AI score chip
- Call and WhatsApp quick-action buttons
- Stage change dropdown
- Follow-up date setter
- BANT qualification card (Budget, Authority, Need, Timeline)
- Remarks / remark history
- Activity timeline (calls, meetings, site visits, WA messages)
- Log Call form
- Properties interested in
- Owner assignment
- AI summary (when AI enabled)
- Sticky notes (private per-agent)
- Customer intelligence match (if profile exists)

**UX Issues:**
- During testing, the main `region [ref_64]` returned empty content — the page's lead content did not appear in accessibility tree. This may be a client-side hydration issue or the lead was loading.
- Lead ID `cmplqt6bn00xmla04ti0kspqf` was already open in a tab but could not be read

**Mobile:** Back button shown on detail page. Complex form on mobile will require scrolling.

**Production Readiness: PARTIALLY VERIFIED** (content region not readable in test; functionally built per schema)

---

### 1.5 /cold-calls — Revival Engine
**Purpose:** Cold data management. Separate bucket from active leads. Agents promote dormant data to live leads.

**Functionality Built:**
- Cold data banner explaining it is NOT active leads
- Gamification: "Today's Mission — Call 5 cold leads, Earn 50 XP per conversion"
- Daily revival mission progress bar
- "Start session (20 leads)" bulk call session link
- Import cold data button
- Assign to agent button
- Filter tabs: All, Unassigned, Cold Data Import, Manual cold, BANT not qualified, 30d+ stale
- Revival leaderboard sidebar (this week's top converters)
- Cold-call streak tracker

**Current Data State:** 0 leads in all cold buckets (cold data has not been imported yet)

**Role Access:**
- Admin: All agents' cold data
- Manager: Own team
- Agent: Own cold data

**Buttons/Actions:** Start session, Import cold data, Assign to agent, Filter tabs

**UX Issues:**
- Empty state with "Nothing in this bucket" is fine for now but will need instruction copy when first cold data is imported
- "Start session (20 leads)" shows 20 even when count is 0

**Mobile:** Bottom nav shows "Revival" tab. Page renders correctly on mobile.

**Missing Features:**
- Cold data hasn't been loaded yet — core functionality untestable until import

**Production Readiness: BUILT — UNTESTED** (depends on cold data import)

---

### 1.6 /pipeline — Kanban Pipeline
**Purpose:** Drag-and-drop sales pipeline showing leads by stage.

**Functionality Built:**
- Kanban columns: New (26), Contacted (14), Qualified (1), Site Visit (0), Negotiation (0), Booking Done (0)
- Each card shows: name, days in stage, configuration, budget, estimated commission (2%), AI score chip, owner name
- "At risk" alerts: leads stuck in a stage too long with warning labels
- Stage-change by drag (desktop) or tap (mobile)
- Filters: Team, Owner, AI score
- Total open pipeline value: "AED 1.2 M" (weighted)
- Toggle between Kanban and List view

**Current Pipeline State:**
- 20 "at risk" alerts flagged
- Longest stuck: JATIN ANAND — 370 days in NEW; Neha Talwar — 424 days in NEW
- 0 leads in Site Visit, Negotiation, Booking Done columns
- Rahul Gupta is the only lead in QUALIFIED with "No activity since stage change"

**Role Access:**
- Admin: All leads
- Manager: Own team (with filter)
- Agent: Own leads

**Buttons/Actions:** Team/Owner/AI filter dropdowns, Kanban/List toggle, drag cards, tap cards

**UX Issues:**
- "AED 1.2 M open value" seems low given 41 active leads — this is because most are in early stages (NEW/CONTACTED) and the value calculation only counts pipeline stage leads
- The pipeline forecast metric ("AED 2.3 M forecasted revenue") on the /reports page uses a different weighting formula
- Commission estimate shows "~AED 24 K (2%)" — this 2% rate is hardcoded and not editable in settings
- Dragging on mobile is confirmed to not work ("use desktop to drag" note shown)

**Mobile:** Tap to open a lead works. Cards scroll horizontally between columns. No horizontal scroll issue noted.

**Production Readiness: READY** (minor: commission rate not configurable)

---

### 1.7 /properties — Properties Catalog
**Purpose:** Browse and manage Dubai property projects and units.

**Functionality:** Page loaded but returned too many elements (65,000+ chars) for accessibility tree at any depth. Schema confirms: Project, Unit, LeadProject, LeadProperty, LeadInterestNote, UnmatchedMention models all built.

**Status:** BUILT — cannot fully read from accessibility tree due to large number of property cards.

**Role Access:** All roles can view; Admin can create/edit.

**Production Readiness: BUILT** (cannot fully verify from this audit pass)

---

### 1.8 /activities — Action Board (was Activities Feed)
**Purpose:** Daily action board showing today's top 5 actions and priority sections.

**Note:** The URL `/activities` renders as an "Action Board" — NOT a traditional activities list feed. This is a different page from `/reports/activity` (Activity Feed).

**Functionality Built:**
- Today's Top 5 Actions: prioritized leads needing attention with Call/WA buttons
- Immediate Action section: overdue follow-up leads
- Hot Follow-ups (next 24h): upcoming urgent follow-ups
- Slipping Leads section
- Site Visits (next 7 days)
- Scheduled Today
- Potential Closures (EOI/Negotiation)

**UX Issues:**
- URL `/activities` is named "Action Board" — this name conflict with "Action List" (/action-list) will confuse agents. The two pages have significant overlap.
- `/activities?type=CALL` and `/activities?type=MEETING` are linked from the dashboard but the activities page doesn't seem to filter by type — it shows the same Action Board

**Production Readiness: FUNCTIONAL** (naming confusion; UX deduplication needed)

---

### 1.9 /reports — Reports Hub
**Purpose:** Central analytics hub with funnel, conversion, leaderboard, and sub-report links.

**Functionality Built:**
- 3 hero decision tiles: Forecasted Revenue (AED 2.3M), Biggest Funnel Leak, Stalled Deals
- Conversion funnel chart (text-based): NEW→CONTACTED 59% lost, CONTACTED→QUALIFIED 94% lost, QUALIFIED→SITE_VISIT 100% lost
- Leads by Source pie (CSV_IMPORT, WHATSAPP, INBOUND_CALL)
- Sub-report links: Daily Report, SLA & Meetings, Travel Reimbursement, Lead Sources, Cooling Leads, Team Comparison, Commission & Earnings, Year-to-Date, Pipeline Overview, Leaderboard, Activity Feed
- Top performing projects table (Danube Diamondz, Azizi Venice, Danube Bayz 101, Azizi Riviera, Sobha Verde, Sobha Solis)
- Best time to call heatmap (7-day × 24-hour grid with connect rates)
- CSV exports: Leads CSV, Calls CSV (admin-only)

**Role Access:** Reports page is HIDDEN for Agents in sidebar (`agentHidden: true`). Admin and Manager only.

**Production Readiness: READY**

---

### 1.10 /reports/leaderboard — Agent Leaderboard
**Functionality Built:** Table showing Rank, Name, Team, Calls Made (last 30d), Leads Assigned, Qualified, Won, Conversion %.

**Current Data:** All agents showing 0.0% conversion rate, 0 calls in last 30 days (calls exist in system but not in last 30 days of test date).

**Production Readiness: READY**

---

### 1.11 /reports/activity — Today's Activity Feed
**Functionality Built:** Live feed of calls and lead updates logged today, grouped by agent. Export CSV button. One action today: Kiran called Yash Khanapure → CONNECTED at 06:12.

**Production Readiness: READY**

---

### 1.12 /notifications — Notifications Inbox
**Purpose:** In-app notification bell inbox.

**Status:** Page loaded but accessibility tree returned too many elements. Notification model exists in schema (LEAD_ASSIGNED, LEAD_DUPLICATE, CALL_SLA_BREACH, AUTO_ASSIGN_FIRED, REMINDER, SYSTEM). Testing mode has ALL notifications paused.

**Production Readiness: BUILT** (notifications disabled in testing mode)

---

### 1.13 /settings — Settings Page
**Purpose:** Admin configuration center.

**Functionality Built:**
- Testing mode master toggle (currently ON)
- Round-robin auto-assign toggle (currently OFF)
- Travel reimbursement rate (₹10/km, editable)
- Speed-to-lead auto-response toggle (OFF)
- BANT qualification gate (Off / Warn / Strict selector)
- Daily motivation toggle (Dubai / India / Both / Off)
- Festival theme selector (10 festivals with date ranges)
- Calendar subscription (iCal URL)
- Push notifications (test button, subscription status)
- Notification preferences (8 toggles with on/off switches)
- Onboarding tour restart
- AI Features toggle (currently OFF)
- AI Trial Mode toggle
- Monthly AI cost cap (USD)
- Company info display (pipeline stages, lead distribution, AI provider, working hours)
- Sub-pages accessible from Settings: Users, Templates, Workflows, Import History, Audit Log, System Health, Integrations, Duplicates, Attendance, Team Mood, Quality, Daily Targets, Site Visits, Vault, AI Trial

**Role Access:** Admin only (confirmed)

**UX Issues:**
- Settings page is a very long scroll. No section anchors/tabs.
- Push notification shows "Not subscribed on any device" — browser push requires manual setup per device

**Production Readiness: READY**

---

### 1.14 /admin/users — User Management
**Purpose:** View and manage CRM users.

**Functionality Built:**
- 7 users table: Name, Email, Role, Team, Leads (with link), Calls, Joined date
- Users: Admin (admin@wcrcrm.com, 608 calls logged), Lalit Sharma (lalitsharma@whitecollarrealty.com, 4 leads), Sameer (sameer@whitecollarrealty.com), Dinesh Gill (Dubai/Agent), Mehak Mukhija (Dubai/Agent), Tanuj Chopra (India/Agent), Yasir Khan (India/Agent)
- Links from leads count to filtered leads view

**Missing Features:**
- No "Invite User" button visible (may be on a different admin page)
- No edit/deactivate user action from this page
- The page breadcrumb shows "← Back" pointing to /admin/audit rather than /settings

**UX Issues:**
- Breadcrumb goes to /admin/audit (the audit log) instead of /settings — likely a copy-paste routing error

**Production Readiness: PARTIALLY BUILT** (read-only view; no user CRUD visible from this page)

---

### 1.15 /admin/vault — Vault Admin View
**Purpose:** Admin view of all team vault entries (journals, wins, vents, lessons).

**Functionality Built:**
- Filter by agent name and kind (Journal, Vent, Win, Lesson, Gratitude, Deal story, Reset)
- Currently shows 0 entries (no vault entries logged by any agent yet)

**Production Readiness: BUILT** (empty; awaiting agent usage)

---

### 1.16 /admin/attendance — Attendance Management
**Purpose:** Admin manually override or view attendance for agents.

**Functionality Built:**
- 14-day rolling attendance grid (May 21 – Jun 3)
- Per-agent per-day dropdown: · (not marked), Present, Late, Absent, On Leave
- 4 agents: Dinesh Gill, Mehak Mukhija, Tanuj Chopra, Yasir Khan
- Tanuj Chopra shows "🕓 LATE" on Jun 3 (auto-marked from his login at 2:39pm IST per audit log)
- All others unmarked (agents haven't been checking in)

**UX Issues:**
- Grid shows only 4 agents (agents only) — admin and managers not shown in attendance grid, which is correct
- All cells are · (not marked) for most days — agents are not using the "I'm here" button consistently

**Production Readiness: READY**

---

### 1.17 /admin/templates — Message Templates
**Purpose:** Manage WhatsApp and email message templates with placeholders.

**Functionality Built:**
- 8 WhatsApp templates (First-query welcome, Post-call summary, Missed-call follow-up, Site-visit invite, Post-visit thank you, Negotiation nudge, Re-engage dormant lead, Generic check-in)
- 8 Email templates (same triggers)
- Placeholder cheat sheet ({{name}}, {{fullname}}, {{agent}}, {{project}}, {{budget}}, {{phone}})
- Tone presets (Luxury, Assertive, Soft, Investor, HNI, Scarcity, Relationship-first, Commercial)
- Edit button per template
- Send count tracking (all currently 0)
- "New template" button

**Production Readiness: READY**

---

### 1.18 /admin/workflows — Workflow Builder
**Purpose:** Visual IF/THEN automation rule builder.

**Functionality Built:**
- 9 starter templates with one-click prefill:
  1. Speed-to-lead SLA escalation
  2. Cold lead revival nudge
  3. Post-site-visit thank you
  4. Hot lead alert to manager
  5. Booking-done internal celebration
  6. Weekly follow-up if quiet
  7. Not-picked streak escalation
  8. Negotiation stall warning
  9. Cold-data promoted welcome
- "Bulk-create every starter template" button
- "New workflow" button
- Currently: 0 workflows saved

**Note:** All automation is paused while testing mode is ON. No workflows will fire even when created until testing mode is disabled.

**Production Readiness: BUILT** (no workflows configured; automation paused)

---

### 1.19 /admin/audit — Audit Log
**Purpose:** Append-only security audit trail.

**Functionality Built:**
- Filter by action type: All, export, admin, auth.login.fail, lead.bulk
- Filter by user dropdown (all 7 users)
- Recent entries: user.manager.set (4 entries from 3 Jun 9pm), lead.reject (3 entries), auth.login.success (3 entries)
- Table: When, Who, Action, Entity, Detail (truncated JSON meta), IP address
- Shows last 10 of 1000 entries

**Production Readiness: READY**

---

### 1.20 /call-logs — DOES NOT EXIST
**Status:** Returns 404. There is no `/call-logs` route. Call logs are accessible via `/reports/activity` and inline in lead detail pages. The schema has a CallLog model but no standalone call log list page.

---

### 1.21 /workflows — REDIRECTS (assumed to /admin/workflows)
**Status:** Not tested as a standalone URL. Workflow builder lives at `/admin/workflows`.

---

## 2. BUILD STATUS SUMMARY TABLE

| Module | URL | Status | Notes |
|--------|-----|--------|-------|
| Dashboard | /dashboard | BUILT | Production ready |
| Action List | /action-list | BUILT | Production ready |
| Leads List | /leads | BUILT | Pagination needed for scale |
| Lead Detail | /leads/[id] | BUILT | Could not fully verify in audit |
| Revival Engine | /cold-calls | BUILT | No cold data loaded yet |
| Pipeline Kanban | /pipeline | BUILT | Production ready |
| Properties | /properties | BUILT | Could not fully read accessibility tree |
| Action Board | /activities | BUILT | Naming confusion with /action-list |
| Reports Hub | /reports | BUILT | Admin/Manager only |
| Leaderboard | /reports/leaderboard | BUILT | Showing 0 calls (last 30d filter) |
| Activity Feed | /reports/activity | BUILT | Working; 1 action today |
| Notifications | /notifications | BUILT | All paused in test mode |
| Settings | /settings | BUILT | Production ready |
| User Management | /admin/users | PARTIALLY BUILT | Read-only; no CRUD buttons visible |
| Vault Admin | /admin/vault | BUILT | Empty (no entries yet) |
| Attendance | /admin/attendance | BUILT | Agents not checking in |
| Templates | /admin/templates | BUILT | 8 WA + 8 Email templates ready |
| Workflow Builder | /admin/workflows | BUILT | No workflows configured |
| Audit Log | /admin/audit | BUILT | Working and populated |
| Call Logs (standalone) | /call-logs | NOT BUILT | 404 |
| Workflows (public URL) | /workflows | UNKNOWN | Not tested |
| Cold Call Session | /cold-calls/session | BUILT | Accessible via Revival Engine |
| Lead Intake (CSV) | /intake | BUILT | Not tested this audit |
| Awaiting Team | /admin/awaiting-team | BUILT | Not tested this audit |
| System Health | /admin/health | BUILT | Not tested this audit |
| AI Features | /admin/ai-trial | BUILT | Not tested this audit |
| Duplicates | /admin/dedup | BUILT | Not tested this audit |
| Team Management | /team | BUILT | Not tested this audit |
| Daily Reports | /reports/daily | BUILT | Not tested this audit |
| SLA Report | /reports/sla | BUILT | Not tested this audit |
| Travel Report | /reports/travel | BUILT | Not tested this audit |
| Vault (agent) | /vault | BUILT | Not tested this audit |
| Profile | /profile | BUILT | Not tested this audit |
| Help | /help | BUILT | Not tested this audit |
| AI Chat | /ai | BUILT | Not tested this audit |
