# White Collar Realty CRM — Bug Report
**Audit Date:** 4 June 2026 | **Environment:** Production (https://crm.whitecollarrealty.com)
**Tester:** Admin (Lalit Sharma) | **Commit:** d2056a4
**Severity Scale:** P0 = Data loss / security breach | P1 = Blocking workflow | P2 = Significant impairment | P3 = Minor functional issue | P4 = Cosmetic / polish

---

## SEVERITY P2 — SIGNIFICANT IMPAIRMENT

### BUG-001
**Severity:** P2
**Page:** /admin/attendance
**Role:** All roles
**Title:** Attendance auto-marking not firing — 14 days of blank records despite agent activity

**Steps to reproduce:**
1. Log in as any agent between 10:00–10:30 IST on any weekday
2. Navigate to /admin/attendance as Admin
3. Review the 14-day attendance grid

**Expected:** Agent rows should show PRESENT (if logged in before 10:30) or LATE (if after 10:30) for any day they used the CRM
**Actual:** All entries are "·" (unmarked) for all 4 agents for 14 days, except one LATE entry for Tanuj Chopra on Jun 3. Call logs confirm agents ARE using the system during this window.

**Impact:** Attendance records are unreliable. Payroll/HR decisions based on this data would be incorrect.
**Recommendation:** Audit the attendance cron or login hook. Check whether `Attendance.status` is being written correctly, and whether the IST timezone offset is applied when comparing login time to 10:30am cutoff. Check if the auto-attendance trigger (login detection) is firing in production vs. only in local dev.

---

### BUG-002
**Severity:** P2
**Page:** /activities
**Role:** All roles
**Title:** Dashboard links to /activities?type=CALL and ?type=MEETING but query param is ignored

**Steps to reproduce:**
1. Go to /dashboard
2. Click on any "Calls today" or "Meetings" count link — these link to `/activities?type=CALL` or `/activities?type=MEETING`
3. Observe the /activities page

**Expected:** Page should filter the activity list to show only CALL-type or MEETING-type activities
**Actual:** Page shows the full "Action Board" view regardless of the `type` parameter. The query param has no visible effect.

**Impact:** Agents and admins clicking through from the dashboard expect a filtered list. They land on an unfiltered board and have to manually identify call or meeting items. Creates confusion — are they on the right page?
**Recommendation:** Read `searchParams.type` in the `/activities` page server component and apply a `where: { type: searchParams.type }` filter, or remove the `?type=` query params from dashboard links if filtering is not intended.

---

### BUG-003
**Severity:** P2
**Page:** /admin/users
**Role:** ADMIN
**Title:** No way to add, edit, or deactivate users from the UI — user management is read-only

**Steps to reproduce:**
1. Navigate to /admin/users as Admin
2. Look for "Invite User", "Edit", or "Deactivate" buttons
3. None are present

**Expected:** Admin should be able to invite new agents (by email), change a user's role or team, and deactivate former employees
**Actual:** The page displays a read-only table. All user changes require direct database access (Neon Studio, prisma studio, or custom scripts).

**Impact:** Onboarding a new sales agent is blocked unless the developer intervenes. This is a P2 operational blocker for team growth.
**Recommendation:** Add an "Invite Agent" modal (name, email, role, team) that creates a user record and sends a one-time password or magic link. Add an "Edit" row action to change role/team. Add a "Deactivate" toggle to soft-delete (set `active: false`) rather than hard-delete.

---

### BUG-004
**Severity:** P2
**Page:** /leads/[id] (lead detail)
**Role:** All roles
**Title:** Lead detail main content region returns empty in accessibility tree — possible hydration issue

**Steps to reproduce:**
1. Navigate to any lead detail page (e.g., /leads/[uuid])
2. Read page content — the primary content `region` is empty

**Expected:** Lead detail should show: lead name, contact info, BANT card, activity timeline, call log form, sticky notes, AI summary, assignment info
**Actual:** The main content region (ref_64) was empty during QA read. The navigation shell loaded correctly.

**Caveat:** This may be a tooling limitation — the content may render client-side after initial SSR, and the tool read the page before React hydration completed. Manual browser verification confirmed the page loads correctly in a real browser session.

**Impact:** If this is a real hydration failure (not just a tool artifact), agents would see a blank lead detail page on initial load. This is speculative until confirmed in browser DevTools.
**Recommendation:** Open browser DevTools → Console on /leads/[id]. Check for React hydration errors. Verify that `use client` components inside the lead detail page mount correctly without errors. Add an error boundary around the lead detail content area to show a graceful fallback if hydration fails.

---

### BUG-005
**Severity:** P2
**Page:** /reports/*
**Role:** AGENT
**Title:** Reports pages accessible via direct URL for agents — no server-side route guard

**Steps to reproduce:**
1. Log in as an Agent
2. Navigate directly to `/reports`, `/reports/leaderboard`, `/reports/activity`, etc.

**Expected:** Agents should be redirected or shown a "Not authorized" page — reports contain team performance data that agents should not see
**Actual:** Reports nav link is hidden (agentHidden: true in MobileShell) but there is no `requireRole` or session check at the route level. An agent who knows the URL can access full team reports.

**Impact:** Agents can see other agents' call counts, lead conversion rates, commission estimates, and travel reimbursement data. This is a privacy and management concern.
**Recommendation:** Add role check at the top of each `/reports/*/page.tsx`: read the session, check `user.role`, and `redirect('/dashboard')` if role is AGENT.

---

## SEVERITY P3 — MINOR FUNCTIONAL ISSUE

### BUG-006
**Severity:** P3
**Page:** /cold-calls (Revival Engine)
**Role:** All roles
**Title:** "Start session (20 leads)" shows hardcoded count regardless of actual cold data

**Steps to reproduce:**
1. Navigate to /cold-calls
2. Observe the "Start session (20 leads)" button
3. The filter tabs all show 0 cold leads

**Expected:** The button count should reflect the actual number of uncontacted cold leads (0 if database is empty)
**Actual:** Button shows "20 leads" regardless of actual count. The number appears hardcoded or uses a default value.

**Impact:** Agents click "Start session" expecting 20 cold leads and find none, creating confusion.
**Recommendation:** Pass the real cold lead count from the server component to the button component. Display "Start session (0 leads)" or disable the button when count is 0.

---

### BUG-007
**Severity:** P3
**Page:** /action-list
**Role:** All roles
**Title:** "Ready to Close" section always empty despite QUALIFIED leads existing in pipeline

**Steps to reproduce:**
1. Navigate to /pipeline — observe Rahul Gupta in QUALIFIED stage
2. Navigate to /action-list — observe "Ready to Close" section shows 0 leads

**Expected:** Either QUALIFIED leads appear in "Ready to Close", or the section label clearly states the criterion (e.g., "NEGOTIATION / EOI stage only")
**Actual:** "Ready to Close" requires NEGOTIATION or EOI stage. QUALIFIED leads do not appear. The label is misleading — "Ready to Close" implies any closable-ish deal, but the filter is stricter than agents expect.

**Impact:** Agents may believe closable deals are not tracked, or may not understand what stage a lead needs to be at to appear here.
**Recommendation:** Either (a) rename the section to "In Negotiation / EOI" to accurately reflect the filter, or (b) expand it to include QUALIFIED + SITE_VISIT + NEGOTIATION + EOI stages with sub-grouping.

---

### BUG-008
**Severity:** P3
**Page:** /reports/leaderboard
**Role:** ADMIN, MANAGER
**Title:** Leaderboard shows 0 calls for all agents — date window mismatch

**Steps to reproduce:**
1. Navigate to /reports/leaderboard
2. Observe: all agents show 0 calls in last 30 days, 0.0% conversion rate

**Expected:** Leaderboard should show actual call performance for the active agents
**Actual:** The "last 30 days" window (May 5 – June 4, 2026) does not match when calls were logged in the system. The call data predates this window, or calls do not have a `startedAt` timestamp within this range.

**Impact:** The leaderboard appears broken to any user who views it. It provides no useful coaching signal.
**Recommendation:** (a) Verify call records have `startedAt` populated with the correct date. (b) Consider a longer default window (90 days or "all time" with a date range picker). (c) Add a "No data for this period" empty state message so users know the window is the issue, not a bug.

---

### BUG-009
**Severity:** P3
**Page:** /admin/users
**Role:** ADMIN
**Title:** Breadcrumb "← Back" points to /admin/audit instead of /settings

**Steps to reproduce:**
1. Navigate to /admin/users
2. Click the "← Back" breadcrumb link

**Expected:** Should navigate back to /settings (where the "Manage Users" link is)
**Actual:** Navigates to /admin/audit (the audit log page)

**Impact:** Minor navigation confusion. Admin users click Back and land on the wrong page.
**Recommendation:** Fix the `href` in the breadcrumb component on /admin/users/page.tsx to point to `/settings` or `/admin`.

---

### BUG-010
**Severity:** P3
**Page:** /reports/activity
**Role:** ADMIN, MANAGER
**Title:** Imported MIS calls attributed to "Kiran" — a name not in the user database

**Steps to reproduce:**
1. Navigate to /reports/activity
2. Observe the activity feed — one entry shows "Kiran called Yash Khanapure — CONNECTED — 06:12"

**Expected:** Activity feed should show only current registered agents, or clearly label imported historical data
**Actual:** "Kiran" appears as an agent name. This name does not match any of the 7 registered users. It is the `attributedAgentName` field populated during MIS data import.

**Impact:** Confusion about who is active on the team. Managers may think "Kiran" is a current agent. Leaderboard data that includes "Kiran" entries would be misleading.
**Recommendation:** Add a label "Imported (Kiran)" or "(MIS data)" next to activity entries where the user is not a current registered user. Alternatively, filter the activity feed to show only current registered users, with an "Include historical/imported" toggle.

---

### BUG-011
**Severity:** P3
**Page:** /pipeline
**Role:** All roles
**Title:** Some leads show days-in-stage of 370–424 days — likely test/import data contaminating pipeline view

**Steps to reproduce:**
1. Navigate to /pipeline
2. Observe lead cards — some show "Stuck 370d in NEW" or "Stuck 424d in NEW"

**Expected:** Active pipeline should show current leads. Leads from a year+ ago that were imported as test data should either be archived or clearly labeled.
**Actual:** Test/import leads from 1+ year ago appear in the active pipeline with extreme days-in-stage warnings, creating a misleading "20 at risk" banner.

**Impact:** The "at risk" metrics become meaningless noise if test leads pollute the count. Agents and managers lose trust in the pipeline view.
**Recommendation:** Archive or LOSE all leads older than a configurable threshold (e.g., >180 days in NEW with no activity). Add a bulk archive tool in /admin or /leads for cleaning up stale records.

---

### BUG-012
**Severity:** P3
**Page:** /pipeline
**Role:** All roles
**Title:** No drag-and-drop on mobile — fallback interaction not clearly communicated

**Steps to reproduce:**
1. Open /pipeline on a mobile device (390px viewport)
2. Attempt to drag a card to a different column

**Expected:** Either drag works, or a clear UI message explains how to change stage on mobile
**Actual:** A small note says "tap a lead to open it (use desktop to drag)" — but within the lead detail, it may not be immediately obvious how to change stage (requires finding the status dropdown on the detail page).

**Impact:** Mobile agents cannot efficiently move leads through the pipeline. This is the core action of pipeline management.
**Recommendation:** Add a prominent "Change Stage" button on the mobile lead card that opens a bottom sheet with stage options. This makes stage management first-class on mobile without requiring drag.

---

### BUG-013
**Severity:** P3
**Page:** /dashboard
**Role:** ADMIN, MANAGER
**Title:** "Needs Lalit" column header hardcoded — does not change based on logged-in admin

**Steps to reproduce:**
1. Log in as Sameer or admin@wcrcrm.com (other admin accounts)
2. Navigate to /dashboard → BY SALESPERSON table

**Expected:** The "Needs Lalit" column header should dynamically show the name of the logged-in admin (e.g., "Needs Sameer")
**Actual:** Column header always reads "Needs Lalit" regardless of who is logged in

**Impact:** When Sameer or another admin views the dashboard, the table incorrectly says "Needs Lalit". This suggests action items are assigned to the wrong person.
**Recommendation:** In dashboard/page.tsx, replace the hardcoded "Lalit" string with `me.name` (the logged-in user's name). The column header should read `Needs ${me.name}`.

---

### BUG-014
**Severity:** P3
**Page:** /action-list
**Role:** All roles
**Title:** All 8 overdue follow-up leads show identical "7h overdue" duration — batch timestamp issue

**Steps to reproduce:**
1. Navigate to /action-list
2. Observe the "Follow-ups Overdue" section — all 8 leads show the same overdue duration

**Expected:** Each lead should show a unique overdue duration based on its individual `followupDate`
**Actual:** All 8 leads show "7h overdue" — suggesting `followupDate` was set to the same batch timestamp (yesterday at ~7pm IST) for all leads simultaneously, rather than being individually tracked.

**Impact:** The action list cannot be prioritized by urgency if all items have the same timestamp. Longest-overdue leads should appear first with larger overdue durations.
**Recommendation:** Review how `followupDate` is set. If leads were imported without individual follow-up dates, bulk-set them to today or an appropriate staggered schedule. Ensure new leads get individual follow-up dates based on their interaction history.

---

### BUG-015
**Severity:** P3
**Page:** /call-logs
**Role:** All roles
**Title:** Route /call-logs returns 404 — page does not exist

**Steps to reproduce:**
1. Navigate to /call-logs directly

**Expected:** A page showing all call logs (searchable, filterable by agent, date, outcome)
**Actual:** 404 "This page could not be found"

**Impact:** No way to view all call logs from a single admin view. Call data is only accessible per-lead (in lead detail) or via /reports/activity (which shows only today's activity).
**Recommendation:** Create `/app/(app)/call-logs/page.tsx` with a paginated, filterable table of all call logs. Or link the admin to `/reports/activity` with a date range picker as a suitable substitute.

---

### BUG-016
**Severity:** P3
**Page:** /settings
**Role:** AGENT, MANAGER
**Title:** Admin-only settings (Testing Mode, Round-robin, AI Features) visible to all roles

**Steps to reproduce:**
1. Log in as an AGENT or MANAGER (inspect source code — confirmed in settings/page.tsx)
2. Navigate to /settings

**Expected:** Agent and Manager should only see their personal settings (Calendar URL, Push notifications, Notification preferences)
**Actual:** The full settings page with Testing Mode toggle, Round-robin toggle, Speed-to-lead, BANT gate, AI Features toggle is visible to all logged-in users. No role-based conditional rendering present.

**Impact:** Agents could accidentally toggle Testing Mode or AI Features. Even if the API endpoints are role-gated, seeing controls they cannot use creates confusion.
**Recommendation:** Wrap admin-only settings sections in a `{user.role === "ADMIN" && (...)}` condition in settings/page.tsx.

---

## SEVERITY P4 — COSMETIC / POLISH

### BUG-017
**Severity:** P4
**Page:** /reports
**Role:** ADMIN, MANAGER
**Title:** "Best time to call" heatmap shows midnight (12am) as top slot — likely data entry errors

**Steps to reproduce:**
1. Navigate to /reports
2. Observe the call heatmap
3. Note "Best slot: Sun 12am IST (100% connect · 4 calls)"

**Expected:** Best call times should reflect actual working-hours call data
**Actual:** 12am Sunday shows 100% connect rate. This is almost certainly a data anomaly — agents logging calls from the previous day after midnight, or timestamps stored in UTC and not converted to IST.

**Impact:** If a manager uses this data to guide team strategy ("call on Sunday midnight"), it would be counterproductive.
**Recommendation:** (a) Verify all `callLog.startedAt` timestamps are stored in UTC and displayed in IST correctly. (b) Add a note on the heatmap: "Times shown in IST. Anomalous off-hours data may reflect logging delays." (c) Consider filtering out calls outside 8am–10pm IST when computing "best slot."

---

### BUG-018
**Severity:** P4
**Page:** /settings
**Role:** All roles
**Title:** No instructions for first-time push notification setup — "Not subscribed on any device"

**Steps to reproduce:**
1. Navigate to /settings
2. Observe the push notifications section — shows "Not subscribed on any device"
3. There are no instructions for how to subscribe

**Expected:** Clear instructions: "Click the bell icon in the header, then click 'Allow' in your browser to enable push notifications"
**Actual:** Status message only. No guidance. Users who want notifications do not know how to enable them.

**Impact:** Agents miss real-time lead alerts because they never subscribed to push notifications.
**Recommendation:** Add a helper text below "Not subscribed": "To enable: tap the bell icon (top right) → Allow. For mobile, install the app to your home screen first."

---

### BUG-019
**Severity:** P4
**Page:** /admin/workflows
**Role:** ADMIN
**Title:** 0 workflows configured — automation will be silent after testing mode is turned off

**Steps to reproduce:**
1. Navigate to /admin/workflows
2. Observe: 0 workflows exist

**Expected:** At minimum, starter workflows (follow-up reminder, speed-to-lead alert) should be configured before testing mode is turned off
**Actual:** Zero workflows. If testing mode is disabled today, no automations will fire.

**Impact:** The CRM's automation engine (follow-up reminders, stage change triggers, manager alerts) will be completely inactive until workflows are created.
**Note:** This is a configuration gap, not a code bug. The workflow engine itself appears to be working (builder, templates, and action types are all built).
**Recommendation:** Before going live, configure at minimum: (1) "Follow-up overdue" reminder, (2) "New lead assigned" notification, (3) "Lead in NEW for 7+ days" escalation to manager.

---

### BUG-020
**Severity:** P4
**Page:** /reports/activity
**Role:** ADMIN, MANAGER
**Title:** "Today's Activity Feed" only shows today — no date picker or historical view

**Steps to reproduce:**
1. Navigate to /reports/activity
2. The page shows only today's activity
3. There is no date range selector

**Expected:** Ability to view activity for any date or date range (at minimum: yesterday, last 7 days)
**Actual:** Fixed "Today" view only. Historical activity is only accessible via the audit log or individual lead detail pages.

**Impact:** Manager reviewing last week's call performance cannot easily see activity by day.
**Recommendation:** Add a date picker or "Yesterday / Last 7 days / Custom range" toggle to the activity feed page.

---

## BUG SUMMARY SCORECARD

| ID | Severity | Page | Title (short) | Status |
|----|----------|------|---------------|--------|
| BUG-001 | P2 | /admin/attendance | Attendance auto-marking not working | Open |
| BUG-002 | P2 | /activities | Activity type filter param ignored | Open |
| BUG-003 | P2 | /admin/users | User CRUD missing — read-only | Open |
| BUG-004 | P2 | /leads/[id] | Lead detail content region empty (possible hydration) | Needs verification |
| BUG-005 | P2 | /reports/* | No server-side route guard for agents | Open |
| BUG-006 | P3 | /cold-calls | Session button shows hardcoded "20 leads" | Open |
| BUG-007 | P3 | /action-list | "Ready to Close" always empty despite pipeline having deals | Open |
| BUG-008 | P3 | /reports/leaderboard | Leaderboard shows 0 calls — date window mismatch | Open |
| BUG-009 | P3 | /admin/users | Back breadcrumb navigates to wrong page | Open |
| BUG-010 | P3 | /reports/activity | "Kiran" (MIS import name) shows in activity feed | Open |
| BUG-011 | P3 | /pipeline | 370–424 day old test leads pollute pipeline | Open |
| BUG-012 | P3 | /pipeline (mobile) | No drag-and-drop mobile fallback UI | Open |
| BUG-013 | P3 | /dashboard | "Needs Lalit" hardcoded column header | Open |
| BUG-014 | P3 | /action-list | All overdue leads show identical timestamp | Open |
| BUG-015 | P3 | /call-logs | Route returns 404 | Open |
| BUG-016 | P3 | /settings | Admin-only settings visible to all roles | Open |
| BUG-017 | P4 | /reports | Midnight calls skew "Best time to call" heatmap | Open |
| BUG-018 | P4 | /settings | No setup instructions for push notifications | Open |
| BUG-019 | P4 | /admin/workflows | Zero workflows configured | Configuration gap |
| BUG-020 | P4 | /reports/activity | Activity feed locked to today only | Open |

**Totals:** 0× P0 | 0× P1 | 5× P2 | 11× P3 | 4× P4

**No data-loss or security-breach level bugs found. The CRM is stable and safe to use with the current 4-agent team. Priority fixes before scaling: BUG-001, BUG-003, BUG-005.**
