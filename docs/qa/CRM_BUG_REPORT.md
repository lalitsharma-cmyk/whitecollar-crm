# CRM Bug Report
**Audit target:** commit `64e779c`
**Audit date:** 2026-06-04
**Previous audit:** commit `d2056a4` (20 bugs found)
**Status:** 16 bugs fixed, 4 deferred (data/tooling), 0 new bugs found

---

## Summary

| Category | Count |
|---|---|
| RESOLVED (code fixes deployed) | 16 |
| DEFERRED (data / tooling, not code) | 4 |
| NEW bugs found in this audit | 0 |
| **Total open bugs** | **0** |

---

## RESOLVED bugs (commit 64e779c)

### BUG-001 — Attendance auto-marking
**Status: RESOLVED**
`AttendancePing` component (`src/components/AttendancePing.tsx`) fires `POST /api/attendance/mark` via `useEffect` on every page load for any logged-in user. Component is mounted directly in `(app)/layout.tsx`. Attendance grid will no longer stay blank on first login of the day.

### BUG-002 — `/activities` type filter non-functional
**Status: RESOLVED**
Page now reads `searchParams.type` and applies it to the "Scheduled Today" query (`prisma.activity.findMany` with `type: typeFilter`). When a type filter is active, a blue banner renders: "Filtering: {TYPE} activities" with a "Clear filter x" link back to `/activities`.

### BUG-003 — `/admin/users` missing management controls
**Status: RESOLVED**
`AdminUsersClient.tsx` now renders an "Invite Agent" button that opens an `InviteModal` calling `POST /api/admin/users/invite`. Each user row has an "Edit" button (role/team modal, `PATCH /api/admin/users/[id]/update`) and a "Deactivate"/"Reactivate" toggle (`PATCH /api/admin/users/[id]/toggle-active`). Self-deactivation is blocked server-side.

### BUG-005 — Leaderboard accessible by AGENT role
**Status: RESOLVED**
`/reports/leaderboard/page.tsx`: `if (me.role === "AGENT") redirect("/dashboard")` — AGENT users are server-redirected before any data is fetched.

### BUG-006 — Cold calls "Start session" hardcoded count of 20
**Status: RESOLVED**
"Start session" button now shows the live `totalCount` (count of `leadOrigin === "COLD"` leads scoped to the current user). When `totalCount === 0`, a disabled "No cold leads available" span is shown instead.

### BUG-007 — Action list "READY TO CLOSE" label incorrect
**Status: RESOLVED**
Section title updated to `"IN NEGOTIATION / EOI"` with caption "Leads in NEGOTIATION or EOI stage — push for booking today."

### BUG-008 — Leaderboard window 30 days, no empty state
**Status: RESOLVED**
Window widened to 90 days. When all agents show zero calls, an amber banner renders: "No calls logged in the last 90 days. Call data from earlier periods is available in Reports → Activity."

### BUG-009 — Admin users breadcrumb links to `/admin/audit`
**Status: RESOLVED**
"Back" link in `/admin/users/page.tsx` now points to `/settings`.

### BUG-010 — Activity feed does not mark historical MIS-import entries
**Status: RESOLVED**
Activity feed checks `attributedAgentName != null` to set `isHistorical: true`. Agent section headers show `(historical data)` label next to any agent whose entries came from MIS imports.

### BUG-012 — Pipeline mobile has no stage-change mechanism
**Status: RESOLVED**
`KanbanBoard.tsx` renders an `sm:hidden` "Move Stage" button on every kanban card. Tapping it opens a bottom-sheet stage picker, which flows into the same "What changed?" modal used by desktop drag-and-drop.

### BUG-013 — "Needs Lalit" column header hardcoded
**Status: RESOLVED**
Dashboard table header now reads `Needs {me.name.split(" ")[0]}`, dynamically showing the first name of the logged-in ADMIN/MANAGER.

### BUG-015 — No `/call-logs` page for ADMIN/MANAGER
**Status: RESOLVED**
`/call-logs/page.tsx` exists with agent/outcome/date-range filters, 50-row pagination, and an "Export CSV" button. AGENT role redirected to `/dashboard`. MANAGER scoped to own team. Page added to nav with `agentHidden: true`.

### BUG-016 — Settings admin-only blocks visible to all roles
**Status: RESOLVED**
All admin-only sections in `/settings/page.tsx` wrapped with `{isAdmin && (...)}` guards. Non-admin users see only personal settings sections.

### BUG-017 — Heatmap best-slot missing disclaimer for off-hours
**Status: RESOLVED**
Icon changes to `warning` when `bestSlot.hour < 8 || bestSlot.hour >= 21`. A disclaimer renders: "Times shown in IST. Off-hours slots may reflect call log timestamps recorded after midnight. Focus on 9am–8pm slots for reliable patterns."

### BUG-018 — Push notification settings no guidance when 0 subscriptions
**Status: RESOLVED**
When `pushSubCount === 0`, shows `Not subscribed on any device — enable from the bell icon first` plus step-by-step instructions for browser and mobile.

### BUG-020 — Activity feed date picker non-functional
**Status: RESOLVED**
`/reports/activity/page.tsx` reads `sp.date` (YYYY-MM-DD), computes IST midnight, and uses it as the query window. A date input with a "View" submit button is rendered on the page.

---

## DEFERRED bugs (not code issues)

### BUG-004 — Lead detail hydration flash
**Status: DEFERRED (tooling artifact)**
Confirmed not reproducible in a real browser session. Flash was a dev-tools / Playwright inspector artifact. No code change needed.

### BUG-011 — Old test leads in database
**Status: DEFERRED (data cleanup)**
Test leads from development remain in the database. Data cleanup task for Lalit — use `/admin/wipe-leads` or manual deletion.

### BUG-014 — Identical call log timestamps
**Status: DEFERRED (data issue)**
Some call logs share identical `startedAt` values from MIS bulk imports without per-row timestamps. No code fix possible without changing the import pipeline spec.

### BUG-019 — Zero active workflows
**Status: DEFERRED (configuration)**
The workflows engine is built and running. No workflow rules have been configured yet. Operational setup task — Lalit needs to create rules via `/admin/workflows`.

---

## New bugs found in this audit

None. All 16 code fixes are confirmed present and correct in the source. The four deferred items remain unchanged in status.

---

## Rollout readiness

**READY FOR FULL ROLLOUT.**
All 16 code bugs are resolved. The four deferred items are data/configuration tasks with no blocking impact on daily operations.
