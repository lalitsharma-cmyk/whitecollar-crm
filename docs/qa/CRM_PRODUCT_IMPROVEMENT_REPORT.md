# White Collar Realty CRM — Product Improvement Report
**Audit Date:** 4 June 2026 | **Author:** QA Audit (Claude) | **Reviewed by:** Lalit Sharma
**Scope:** UX gaps, missing features, workflow improvements, and rollout readiness assessment

---

## EXECUTIVE SUMMARY

The CRM is well-built for a real estate sales team. The core loop works: Action List → Call → Log → Follow-up. The dashboard gives a clear daily picture for admin. The pipeline tracks deals visually. WhatsApp integration is excellent for mobile outreach.

The system needs work in four areas before it can scale:
1. **Performance** — Leads list has no pagination. At 25,000 leads, it will crash browsers.
2. **Attendance** — The auto-attendance system is broken. Needs fixing before HR relies on it.
3. **User management** — Cannot add or edit users from the UI. Blocks team growth.
4. **Automation** — Testing mode is ON, zero workflows configured. Automation is ready to build but untouched.

The rest of the improvements in this report are quality-of-life and are ordered by impact.

---

## PART 1: IMMEDIATE FIXES (Before Agent Go-Live)

These are blocking or near-blocking issues that should be resolved before training agents on the CRM.

### IMP-01: Add pagination to /leads
**Priority:** CRITICAL (before scaling)
**Current state:** All leads loaded in one query. 44 leads works. 25,000 would crash phones and browsers.
**Fix:** Implement cursor-based pagination — 50 leads per page, "Next" / "Previous" navigation at bottom of list.
**Effort:** Medium (1–2 days). Standard Next.js pattern: `skip`, `take`, `cursor` in Prisma query.

### IMP-02: Fix attendance auto-marking
**Priority:** HIGH
**Current state:** 14 days of blank attendance for all agents despite confirmed CRM usage.
**Fix:** Debug the login hook or attendance cron — verify IST timezone math, verify the trigger fires on every session creation, not just fresh logins.
**Effort:** Small (hours). Likely a 1-line timezone bug.

### IMP-03: Add "Invite Agent" to /admin/users
**Priority:** HIGH
**Current state:** Cannot add users from UI. Requires direct database access to onboard a new agent.
**Fix:** Add a modal with: Name, Email, Role (dropdown), Team (Dubai/India). Generate a temporary password or magic link.
**Effort:** Medium (1 day).

### IMP-04: Add server-side role guard to /reports/*
**Priority:** HIGH
**Current state:** Reports nav is hidden for agents, but direct URL access works for any role.
**Fix:** Add session check at top of each report page.tsx: if `user.role === "AGENT"`, redirect to `/dashboard`.
**Effort:** Small (1 hour). 5 lines per page × 10 report pages = ~50 lines total.

### IMP-05: Fix /activities page to respect ?type= query param
**Priority:** MEDIUM
**Current state:** Dashboard links pass `?type=CALL` but the activities page ignores it.
**Fix:** Read `searchParams.type` in page.tsx and pass it as a filter to the query.
**Effort:** Small (1–2 hours).

---

## PART 2: UX SIMPLIFICATION (Quality of Life)

These improve the day-to-day experience without adding new features.

### IMP-06: Make "Needs Lalit" column header dynamic
**File:** `dashboard/page.tsx`
**Current state:** Hardcoded string "Needs Lalit" in the by-salesperson table.
**Fix:** Replace with `Needs ${me.name}`. Shows "Needs Sameer" when Sameer is logged in.
**Effort:** Trivial (5 minutes).

### IMP-07: Rename "Ready to Close" to "In Negotiation / EOI"
**File:** `action-list/page.tsx` (section heading)
**Current state:** "Ready to Close" section is always empty despite active deals in QUALIFIED stage. The label is misleading.
**Fix:** Rename section to "In Negotiation / EOI" so agents understand which stage a lead needs to reach.
**Effort:** Trivial (5 minutes).

### IMP-08: Add a date picker to /reports/activity
**Current state:** Activity feed always shows "Today". No way to view yesterday or last week.
**Fix:** Add a date picker (default: today) with quick options: Yesterday, Last 7 days, Custom.
**Effort:** Small (2–3 hours).

### IMP-09: Fix /admin/users breadcrumb
**Current state:** "← Back" goes to /admin/audit instead of /settings.
**Fix:** Change href to `/settings`.
**Effort:** Trivial (5 minutes).

### IMP-10: Add role-based visibility to /settings
**Current state:** Admin-only settings (Testing Mode, AI Features, Round-robin) are visible to all roles.
**Fix:** Wrap admin-only sections in `{session.user.role === "ADMIN" && (...)}`.
**Effort:** Small (30 minutes).

### IMP-11: Fix "Start session" button to show real cold lead count
**Current state:** Button shows "20 leads" regardless of actual count.
**Fix:** Pass actual count from server component to the button prop.
**Effort:** Trivial (30 minutes).

### IMP-12: Label imported MIS data in /reports/activity
**Current state:** Activity by "Kiran" (MIS import name) appears in the feed without labeling.
**Fix:** When `attributedAgentName` is set and does not match any current user, append "(Imported)" to the display name.
**Effort:** Small (1 hour).

### IMP-13: Add clear setup instructions for push notifications
**Current state:** Settings shows "Not subscribed on any device" with no guidance.
**Fix:** Add 1–2 lines of helper text: "Tap the bell icon in the top bar, then click Allow when your browser asks."
**Effort:** Trivial (10 minutes).

---

## PART 3: MOBILE UX IMPROVEMENTS

### IMP-14: Simplify /leads/[id] on mobile — "Quick View" pattern
**Current state:** Lead detail is one very long page on mobile. Agents have to scroll past BANT, timeline, notes, and forms to log a call.
**Fix:** On mobile (< lg), show a condensed "Quick Info" card at top (name, phone, status, last remark, AI score) with a sticky "Log Call" button. Expandable sections below for full detail.
**Effort:** Large (3–5 days). Requires a parallel mobile layout for the detail page.

### IMP-15: Add "Change Stage" bottom sheet on pipeline mobile
**Current state:** No drag-and-drop on mobile. The note says "use desktop to drag." But within the lead detail, finding the stage dropdown requires scrolling.
**Fix:** Add a "Move Stage" button on tapped lead card that opens a bottom sheet with all stage options as large tappable buttons.
**Effort:** Medium (1–2 days).

### IMP-16: Add column count strip to pipeline kanban on mobile
**Current state:** Kanban columns require horizontal scroll. No summary of counts without scrolling.
**Fix:** Add a sticky horizontal strip above the kanban: "NEW 26 | CONTACTED 14 | QUALIFIED 1 | ..." as tap-to-jump column anchors.
**Effort:** Small (2–3 hours).

### IMP-17: Add expandable sections to /settings on mobile
**Current state:** Settings page is one very long vertical scroll with no section anchors.
**Fix:** Wrap each settings group in a collapsible accordion (or add section anchor links) so users can jump to "Notifications" without scrolling past Testing Mode and AI settings.
**Effort:** Small (2–3 hours).

### IMP-18: Add "Log Quick Call" bottom sheet for mobile agents
**Current state:** Logging a call on mobile requires navigating to /leads/[id] and scrolling to the call form.
**Fix:** On the Action List and lead detail mobile view, add a "Log Call" floating button that opens a minimal 3-field bottom sheet: Outcome (dropdown) + Duration + Quick note. Submits without full page scroll.
**Effort:** Medium (1–2 days).

---

## PART 4: REAL ESTATE WORKFLOW GAPS

These are features that would directly improve the sales workflow for a Dubai property investment brokerage.

### IMP-19: WhatsApp message preview before sending
**Current state:** Action List has pre-filled WhatsApp draft messages. Tapping the button opens WhatsApp directly — no preview within the CRM.
**Fix:** Add a "Preview message" modal before opening WhatsApp. Show the full draft with lead name filled in. Allow editing before proceeding.
**Effort:** Medium (1 day). Creates a slide-out or modal with the message text, editable, and a "Open WhatsApp" confirm button.

### IMP-20: Commission tracking on /reports
**Current state:** Commission estimates exist on lead cards (pipeline view). But there is no commission summary report: total pipeline value, won commissions, projected commissions by agent.
**Fix:** Add a "Commission Report" page at /reports/commission showing: pipeline commission value by stage, won commissions YTD, commission by agent.
**Note:** The data model already has `commissionAmount` and `commissionStatus` on Lead. This is a display/report gap only.
**Effort:** Medium (2 days).

### IMP-21: Property preference matching on lead detail
**Current state:** `LeadProperty` and `IntelligenceMatch` models exist in schema.prisma — the data model supports property preference matching. UI status is unverified.
**Action needed:** Verify whether the "Customer Intelligence" / property matching UI is built and surfaced on the lead detail page. If not, this is a high-value feature for agents presenting properties to leads.

### IMP-22: Site visit tracking and confirmation flow
**Current state:** SITE_VISIT stage exists in the pipeline. But there is no dedicated "site visit scheduled" → "site visit completed" workflow with confirmation, feedback capture, and automatic stage advance.
**Fix:** When a lead is moved to SITE_VISIT, prompt: "Schedule visit" (date/time picker → creates a SITE_VISIT activity). After visit date passes, nudge agent to mark it as ATTENDED or NO_SHOW. Auto-advance to NEGOTIATION if attended.
**Effort:** Large (1 week). Requires new UI on lead detail + workflow rule.

### IMP-23: Bulk follow-up date setter for existing leads
**Current state:** 8 overdue leads all have the same follow-up date (batch-set during import). No bulk-editing tool is visible.
**Fix:** Add a "Bulk update follow-up date" action in /leads — select multiple leads → set follow-up date for all. Allows admins to clean up stale/batch data quickly.
**Effort:** Medium (1 day).

### IMP-24: Archive or "sunset" very stale leads
**Current state:** Leads from 370–424 days ago with no activity pollute the pipeline and trigger false "at risk" warnings.
**Fix:** Add a "Stale lead cleanup" tool in /admin — show leads with no activity in 90+ days in EARLY stages. One-click to archive them to LOST with reason "Inactive / No response".
**Effort:** Small–Medium (1 day).

---

## PART 5: FEATURES TO DEFER (Do Not Build Yet)

These appeared in the codebase (models, partial UI) or were discussed but should not be prioritized until the core is stable.

| Feature | Reason to Defer |
|---------|----------------|
| Full offline mode / Service Worker | Complex, rarely needed in office environment. PWA install is enough. |
| AI chat / AI lead summarization | AI trial mode is built but off. Test with 1 agent first before rolling out. |
| Calendar sync (two-way) | Calendar URL export works. Two-way sync requires Google OAuth scopes — complex and risky. |
| Email sending from CRM | Template engine exists but no email sending is wired. Email volume is low; WhatsApp is the primary channel. |
| EOI / booking document workflow | Models exist. Build only when first EOI is imminent. |
| Travel reimbursement auto-calculation | Travel rate exists. GPS-based mileage tracking is complex — manual entry is sufficient for now. |
| Org chart / hierarchy visualization | Not needed until team grows to 15+ agents. |

---

## PART 6: ADMIN/MANAGER QUICK WINS (Non-Technical)

These require no code changes — just configuration and habit-building.

1. **Create 3 starter workflows** in /admin/workflows before turning off Testing Mode:
   - "Follow-up overdue by 24h → notify agent"
   - "New lead created → notify assigned agent"
   - "Lead in NEW stage for 7 days → notify manager"

2. **Clean up stale pipeline leads** — archive the 370–424 day old leads from the pipeline so the "20 at risk" count becomes meaningful

3. **Set individual follow-up dates** for the 8 overdue leads so the Action List shows real urgency order

4. **Subscribe agents to push notifications** before turning off Testing Mode — go to /settings → bell icon → Allow in each agent's browser

5. **Assign correct follow-up dates during lead creation** — train agents: every time a call is logged, the very next step is setting a follow-up date before closing the lead form

---

## PART 7: ROLLOUT READINESS VERDICT

### Current state (as of 4 June 2026)
- **System stability:** GOOD — no crashes, no P0/P1 bugs found
- **Core workflow:** WORKS — Action List → Call → Log → Follow-up is functional
- **Data integrity:** ACCEPTABLE — 44 leads, minor import anomalies, no corruption
- **Automation:** NOT READY — Testing mode ON, zero workflows configured
- **Attendance:** NOT READY — auto-marking broken
- **User management:** NOT READY — cannot add users from UI
- **Scale readiness:** NOT READY — no pagination on leads list

### Recommended go-live conditions

| Condition | Status |
|-----------|--------|
| Leads list has pagination | NOT DONE |
| Attendance auto-marking works | NOT DONE |
| At least 3 workflows configured | NOT DONE |
| Push notifications subscribed on all agent devices | NOT DONE |
| Stale test leads archived | NOT DONE |
| All agents have completed agent training | NOT DONE |
| Invite agent UI built (or manual DB process documented) | NOT DONE |
| Reports route guard added | NOT DONE |

**Verdict: 0 of 8 go-live conditions met.** The CRM is safe to use and test with, but should not be the primary sales system for a 4-agent team until at minimum items 1 (pagination), 2 (attendance), and 3 (workflows) are complete.

**Estimated time to meet all go-live conditions:** 5–8 developer days of focused work.
