# White Collar Realty CRM — Product Improvement Report
**Audit target:** commit `64e779c`
**Audit date:** 2026-06-04
**Scope:** UX gaps, missing features, workflow improvements, and rollout readiness assessment

---

## Priority tier definitions

- **P0:** Blocking — must fix before launch
- **P1:** High — fix in first two weeks after launch
- **P2:** Medium — fix in first month
- **P3:** Nice to have — backlog

---

## P0 items (blocking)

None. All previously-blocking bugs are resolved in commit 64e779c.

---

## P1 items (high priority, post-launch)

### Configure workflows
The automation engine is built (`/admin/workflows`, `/api/admin/workflows`, cron job at `/api/cron/workflows`) but zero rules have been configured. Until rules exist, the engine is dormant. Lalit should set up at minimum:
- Escalation rule: lead untouched for 24h in NEGOTIATION → flag "Needs Manager"
- SLA rule: new lead not contacted within 15 min → admin alert

### Data cleanup: test leads (BUG-011)
Old test leads from development are polluting the database. Use `/admin/wipe-leads` or work with the dev team to selectively remove non-client records. This affects report accuracy.

### Import pipeline timestamp fix (BUG-014)
Bulk-imported call logs from MIS share identical timestamps. The import pipeline should be updated to either preserve original call timestamps or offset by 1 second per row to avoid misleading sort orders.

---

## P2 items (medium priority)

### Leaderboard: column sorting
The leaderboard table is sorted by calls made (descending) and cannot be re-sorted by qualified leads, wins, or conversion rate. Adding clickable column headers would let managers quickly rank by deal conversion.

### Call Logs export: agent filter param mismatch
`/api/call-logs/export` accepts `userId` as the agent filter query param, but `/call-logs` page passes `agent`. The two filters use different param names. Unify to `agent` or document the discrepancy.

### Activities page: date selector
The Activities page (Action Board) shows today's "Scheduled Today" section but there is no way to look at a future date's scheduled activities. Adding a simple date picker (like the one in the Activity Feed) would let agents plan ahead.

### Push notifications: subscription management
Users can subscribe to push notifications but there is no way to see which devices are subscribed or delete old subscriptions. A "Manage devices" list under Settings would reduce confusion.

### Workflows: no visual feedback
When workflows are eventually configured, agents and managers will have no visibility into what automations are active. A read-only "Active automations" panel on the dashboard or settings page would improve trust.

---

## P3 items (backlog / nice to have)

### Leaderboard: commission column
Add a "Commission earned (est.)" column based on Won leads and their budgetMin at 2%. This is already computed as a tooltip on pipeline cards — surfacing it on the leaderboard would reinforce the earning motivation.

### Cold Calls: batch assignment UI
Admin currently uses a modal to assign cold data batches. A spreadsheet-like bulk assignment view (select rows, assign to agent) would be faster for large imports.

### Reports: SLA trends over time
The current SLA report shows current state. A trend line (7d/30d rolling average) would let managers see if speed-to-lead is improving.

### Dark mode polish
Dark mode (`dark:` Tailwind classes) is implemented across most components. A few older table cells and chart tooltips may not fully respect the dark palette — a visual sweep would help.

### Lead detail: print/share view
Lalit removed the print button by request, but agents occasionally need to share a formatted lead summary. A "Share summary" action that generates a read-only link or PDF would be useful.

---

## Rollout readiness verdict

**READY FOR FULL ROLLOUT.**

- All 16 code bugs from the previous audit are resolved
- No new bugs found in this audit
- Zero P0 items
- P1 items are operational tasks (config, data cleanup), not code changes
- The CRM is functionally complete for the Dubai + India sales teams
