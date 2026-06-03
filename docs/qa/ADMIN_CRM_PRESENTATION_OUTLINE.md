# White Collar Realty CRM — Admin Presentation Outline
**Audit target:** commit `64e779c`
**Audience:** Admin users (Lalit Sharma and any co-admins)
**Format:** 10 slides | Duration: 35–45 minutes
**Tone:** Comprehensive, strategic, operational

---

## Slide 1 — Title

**White Collar Realty CRM**
**Admin Orientation — commit 64e779c**
Date: June 2026

Key points to cover:
- This CRM was built specifically for White Collar Realty's Dubai + India calling teams
- All data, workflows, and logic are customised for how Lalit's team operates
- The "team" label means market team (Dubai or India), not client location

---

## Slide 2 — What was built and what was fixed

**The 16-bug fix release (64e779c)**

Cover:
- Previous audit found 20 issues, 16 were code bugs, all 16 are now fixed
- Highlight the most impactful fixes:
  - Attendance now auto-marks on login (no more blank grid)
  - /call-logs page added for admin/manager
  - Admin user management fully functional (invite, edit, deactivate)
  - Mobile pipeline stage-change works
  - Settings admin-only blocks properly gated

---

## Slide 3 — The testing mode safety switch

**The most important switch to understand**

Cover:
- Yellow banner at top = testing mode is ON
- Testing mode OFF is required for go-live
- What it pauses: WhatsApp auto-response, round-robin, escalations, notifications
- Where to find it: Settings → Testing mode

Demo:
- Open Settings, show the testing mode toggle
- Show the yellow banner when ON

---

## Slide 4 — User management walkthrough

**Adding, editing, deactivating users**

Cover:
- Settings → Users (requires ADMIN)
- "Invite Agent" button → full create flow
- Edit button for role/team changes
- Deactivate/Reactivate toggle (cannot deactivate self)
- "Back" link goes to Settings (not Audit log — this was a bug, now fixed)

Demo:
- Show the /admin/users page
- Walk through the Invite modal

---

## Slide 5 — Lead intake and team routing

**How leads flow in and get to agents**

Cover:
- Lead Intake page (CSV, WhatsApp, Google Sheet, website)
- Lead origin: ACTIVE (goes to /leads) vs COLD (goes to Revival Engine)
- After import: check Awaiting Team inbox for null-team leads
- Turn off round-robin before bulk upload to prevent auto-assignment

Demo:
- Show Awaiting Team badge in sidebar
- Show /admin/awaiting-team page

---

## Slide 6 — Monitoring the team: dashboard, call logs, leaderboard

**Your daily command centre**

Cover:
- Dashboard "By Salesperson" table — "Needs [your name]" column
- Call Logs page: agent/outcome/date filters, CSV export, 90-day window
- Leaderboard: 90-day calls, qualified, won, conversion rate, empty state banner
- Activity Feed: date picker, historical data labels

Demo:
- Open /dashboard, point to the by-salesperson table
- Open /call-logs, apply a filter
- Open /reports/leaderboard

---

## Slide 7 — Reports heatmap and off-hours disclaimer

**Best time to call**

Cover:
- DOW x hour heatmap (30-day window, connect % per slot)
- Best slot shown below the grid
- Off-hours warning: if best slot is outside 8am–9pm, warning icon + disclaimer text appears (BUG-017 fix)
- How to use: schedule team outbound at the highest-connect slots

---

## Slide 8 — Operational settings to configure

**Before go-live and ongoing**

Cover:
- Round-robin (ON for normal ops, OFF during bulk import)
- Speed-to-lead (ON sends first-touch WA+email automatically)
- BANT gate (Warn recommended)
- Travel rate (update when petrol costs change)
- Daily targets per agent (/admin/targets)

Actions needed:
- Configure at least one workflow rule (/admin/workflows)
- Set daily targets for each agent
- Delete test leads (/admin/wipe-leads)

---

## Slide 9 — AI features

**Lead scoring, next actions, and the AI trial**

Cover:
- AI scoring: HOT/WARM/COLD (numeric score on every active lead)
- Score explanation breakdown on lead detail page
- Next best action, buying signals, customer intelligence cards
- AI kill-switch in Settings (OFF = no new scoring)
- AI Trial mode: bounded cost test on a sample before enabling globally
- Cost cap ($X/month) configurable

---

## Slide 10 — Go-live checklist and what to watch

**Last steps and ongoing monitoring**

Go-live checklist:
1. Turn Testing Mode OFF
2. Delete test/dev leads via /admin/wipe-leads
3. Verify all agent accounts and team assignments at /admin/users
4. Set daily call targets at /admin/targets
5. Configure workflow rules at /admin/workflows
6. Confirm push notifications working (Settings → Test push)

Ongoing monitoring cadence:
- Daily: Dashboard by-salesperson table, Awaiting Team inbox
- Weekly: Leaderboard, Activity Feed, Call Logs export
- Monthly: Reports hub (sources, SLA, commission, team comparison)
- As needed: System health (/admin/health), cron health (/admin/cron-health)
