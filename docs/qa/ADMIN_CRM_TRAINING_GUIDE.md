# White Collar Realty CRM — Admin Training Guide
**For:** Lalit Sharma (Admin) and other Admin users
**Version:** June 2026 | **CRM URL:** https://crm.whitecollarrealty.com

---

## OVERVIEW: WHAT THE ADMIN CONTROLS

As Admin, you have full access to every part of the CRM. This guide focuses on the tasks you are most likely to do repeatedly:

1. Daily dashboard monitoring
2. Assigning and managing leads
3. Reviewing team performance
4. User management
5. System settings
6. Reports and exports
7. Keeping the system clean

---

## SECTION 1: DASHBOARD — YOUR DAILY COMMAND CENTER

### What you see as Admin (that managers and agents do not)

**Team filter:** Tabs at the top of the dashboard let you switch between Dubai, India, and All Teams. Managers are locked to their own team. Agents see only their own data. You see everything.

**By Salesperson table:** Shows each agent's call count, follow-ups completed, deals moved, and site visits scheduled for the selected date range. This is your fastest daily health check.

**Admin morning queue:** A widget visible only to you showing the most urgent items across all teams — unassigned leads, escalated items, overdue SLAs.

**Team Scoreboard and Weekly Summary:** Shows call performance and pipeline momentum. If the weekly summary shows declining Qualified+ or Won numbers, that is a flag for a team conversation.

### Dashboard date filter
The dashboard URL uses `?from=` and `?to=` parameters. You can change the date range in the URL to see historical performance:
- Today: `/dashboard?from=2026-06-04&to=2026-06-04`
- This week: `/dashboard?from=2026-06-01&to=2026-06-07`
- This month: `/dashboard?from=2026-06-01&to=2026-06-30`

### Morning routine (10 minutes)
1. Check the TODAY section — any hot leads untouched? Any calls to close today?
2. Check the By Salesperson table — who made calls yesterday? Who did not?
3. Check Today's Mission — what should you personally focus on?
4. Scan the Admin morning queue — any escalations from agents?

---

## SECTION 2: LEADS MANAGEMENT

### Viewing all leads
Go to /leads. As Admin, you see all 44 leads (growing over time) across both teams.

**Filter tabs:** All, Today, Overdue, Hot, Site Visit, Negotiation, Unassigned, Dubai, India

**The "Unassigned" filter is critical** — check this regularly. Any lead that was imported or came through the intake form without an owner needs to be assigned immediately. An unassigned lead means no one is responsible for following up.

### Assigning a lead to an agent
1. Open the lead (tap the lead name)
2. Find the **"Owner"** or **"Assigned To"** field
3. Select the agent from the dropdown
4. Save

### Lead Intake (/intake)
When a new inquiry comes in via the lead intake form, go to /intake to see unprocessed leads:
1. Review the lead information
2. Assign it to an agent based on team (Dubai inquiry → Dubai team, India location → India team)
3. The agent will see it in their leads list and Action List immediately

### Importing leads in bulk
If you have a spreadsheet of leads from a portal (99acres, Bayut, Property Finder):
1. Go to /intake (Lead Intake)
2. Use the Import function
3. Map columns from your CSV to CRM fields
4. Review and confirm the import

**Note:** Use the correct team assignment during import. Bulk imports assign all leads to the same owner unless you specify per-row.

---

## SECTION 3: MONITORING TEAM PERFORMANCE

### Pipeline health check
Go to /pipeline. Filter by team (Dubai or India), then look at:
- How many leads are in NEW? (Should be <10 at any time. More = agents are not calling new leads fast enough)
- Are there NEGOTIATION or EOI leads at risk? (Red badges mean action needed)
- What is the overall funnel shape? (Lots at top, few at bottom = conversion problem)

### Reports
Go to /reports. The reports home page shows 3 key numbers at the top (hero tiles) — your most important decision metrics at a glance.

Key reports you will use most:
- **Funnel Analysis** — Where are leads dropping off in the pipeline?
- **Leaderboard** — Which agents are performing and which need coaching?
- **Daily Report** — What happened today across both teams?
- **SLA Report** — Which leads have violated response time targets?
- **Activity Feed** — A timeline of all calls and WhatsApp messages logged today

### Exporting data
Most report pages have a **"Export CSV"** button. Use this for:
- Sharing data with Sameer or stakeholders
- Running offline analysis in Excel/Sheets
- Monthly reporting

---

## SECTION 4: USER MANAGEMENT

**Current limitation:** The /admin/users page is currently read-only. You can view all users but cannot add, edit, or deactivate from the UI. Until the "Invite User" feature is built, new users must be added directly in the database (via Neon Studio) or by your developer.

### To view all users:
Go to /admin/users. You will see:
- Name, email, role, team, lead count, call count, join date

### Current users:
- Lalit Sharma — ADMIN
- Sameer — ADMIN
- admin@wcrcrm.com — ADMIN (MIS import user — do not use for day-to-day)
- Dinesh Gill — AGENT (Dubai)
- Mehak Mukhija — AGENT (Dubai)
- Tanuj Chopra — AGENT (India)
- Yasir Khan — AGENT (India)

**Note:** No MANAGER role is currently assigned to anyone. When you are ready to promote a team lead, a developer needs to update their `role` field to MANAGER in the database.

---

## SECTION 5: SYSTEM SETTINGS

Go to /settings. As Admin, you control all system settings.

### Testing Mode
**Status: Currently ON**
Testing mode pauses ALL automated notifications, workflow triggers, and follow-up reminders. This is safe for testing. When you turn this OFF, automation begins.

**Before turning off Testing Mode:**
1. Make sure at least 3 workflows are configured in /admin/workflows
2. Make sure all agents have subscribed to push notifications (Settings → Bell icon → Allow)
3. Make sure the attendance bug is fixed (so auto-attendance starts recording)
4. Make sure the leads list has pagination (or total lead count is small enough)

### Round-Robin Assignment
When ON, new leads are automatically distributed to agents in rotation. Useful when leads come in faster than you can manually assign them.

**How it works:** Lead comes in → System picks next agent in the rotation → Lead is assigned automatically.

### Speed-to-Lead
When ON, the system sends an automatic first-contact WhatsApp or notification within minutes of a new lead arriving. This improves conversion from inquiry to contact.

### BANT Gate
Controls at what stage agents must fill in the BANT fields (Budget, Authority, Need, Timeline) before they can advance a lead to QUALIFIED. Set this to CONTACTED or QUALIFIED stage.

### Travel Rate
Set the per-kilometer reimbursement rate for site visit travel (currently ₹10/km).

### AI Features
When ON, the system uses AI to:
- Score leads (HOT/WARM/COLD)
- Generate call summaries
- Suggest next best action

**Currently OFF.** Turn on only after testing with 1 agent to assess AI output quality and API cost.

### Festival Theme
Changes the visual theme of the CRM for Indian/UAE festivals. Purely cosmetic.

---

## SECTION 6: AUDIT LOG

Go to /admin/audit. Every action in the CRM is logged here with:
- **When** — timestamp
- **Who** — user who performed the action
- **What** — action type (lead created, stage changed, user logged in, etc.)
- **Entity** — which lead, user, or record was affected
- **Detail** — specifics of the change
- **IP address** — where the action came from

Use the audit log when:
- An agent disputes a lead assignment ("I never had that lead")
- Something changed and you do not know who changed it
- You need to track when a specific event happened

---

## SECTION 7: ATTENDANCE MANAGEMENT

Go to /admin/attendance. The grid shows the last 14 days for each agent.

**Known issue:** Auto-attendance is currently not recording correctly. Most dates show as blank. Until this is fixed, use manual marking.

**To manually mark attendance:**
1. Click on a cell in the grid
2. Select: PRESENT, LATE, ABSENT, ON_LEAVE, or WFH
3. Save

Auto-attendance rules (when working correctly):
- Login before 10:30am IST → PRESENT
- Login after 10:30am IST → LATE
- No login → ABSENT (or left blank for manual marking)

---

## SECTION 8: TARGETS

Go to /admin/targets. Set call targets and lead conversion targets per agent per month.

When targets are set:
- Agents see a progress bar on their dashboard showing how close they are to their daily call target
- Reports show performance vs. target

---

## SECTION 9: TEMPLATES AND WORKFLOWS

### WhatsApp / Email Templates (/admin/templates)
Pre-written message templates that agents can send with one tap.

Available template types:
- First contact
- Follow-up
- Site visit confirmation
- Price sheet share
- Offer letter
- Payment plan details

To add or edit a template:
1. Go to /admin/templates
2. Tap "New Template" or "Edit" on an existing one
3. Use placeholders: {{name}}, {{agent}}, {{project}}, {{budget}} — these fill in automatically
4. Save

### Workflows (/admin/workflows)
Automations that trigger based on events in the CRM.

**Current state: ZERO workflows configured.** When Testing Mode is turned off, nothing will trigger automatically until workflows are created.

**Recommended starter workflows to set up first:**
1. "New lead created" → Send notification to assigned agent
2. "Follow-up date overdue by 24 hours" → Send reminder to agent + alert manager
3. "Lead in NEW stage for 7 days with no activity" → Alert manager
4. "Lead moved to EOI stage" → Notify Lalit (Admin)

To create a workflow:
1. Go to /admin/workflows
2. Tap "New Workflow" or choose a starter template
3. Set the Trigger (when does it fire?)
4. Set the Condition (optional — filter to specific leads, stages, or agents)
5. Set the Action (what does it do? Send notification, send WhatsApp, change status, etc.)
6. Activate

---

## SECTION 10: DATA HOUSEKEEPING (Monthly)

These tasks keep the CRM clean and reliable.

### Archive stale leads
Filter /leads by "No activity in 90 days" or by creation date. Leads that:
- Have been in NEW or CONTACTED for 90+ days with no recent activity
- Were from a test import a year+ ago

These should be moved to LOST with reason "Inactive / No response." This keeps the pipeline count meaningful and reduces noise.

### Review unassigned leads
Filter /leads by "Unassigned." Every lead should have an owner. Assign any orphaned leads.

### Validate call log quality
Spot-check /reports/activity. Open 3–5 call logs randomly and read the remarks. If remarks are thin ("called", "no answer"), have a team conversation about remark standards.

### Check cold data
Go to /cold-calls. If cold data is 0 but you have imported MIS data, verify the import ran correctly. Cold lead sessions can only run when there is cold data in the system.

---

## ADMIN DAILY CHECKLIST

Morning:
- [ ] Log in before 10:30am
- [ ] Check dashboard — Dubai + India KPIs
- [ ] Check By Salesperson table — who was active yesterday?
- [ ] Check Admin morning queue — any escalations?
- [ ] Check Action List — any unowned or urgent leads?

During the day:
- [ ] Assign any unassigned leads from /leads → Unassigned filter
- [ ] Respond to agent escalations
- [ ] Check /reports/activity for call quality

Weekly:
- [ ] Review Leaderboard — identify agents to coach or commend
- [ ] Review Funnel — identify pipeline bottlenecks
- [ ] Review attendance grid — address absences
- [ ] Check for stale leads to archive

Before turning off Testing Mode:
- [ ] Configure at least 3 workflows
- [ ] Confirm pagination on /leads is live
- [ ] Confirm attendance auto-marking is working
- [ ] Confirm all agents have push notifications subscribed
- [ ] Complete agent and manager training sessions

---

## QUICK REFERENCE: ADMIN-ONLY URLS

| What you want | URL |
|--------------|-----|
| Dashboard (all teams) | /dashboard |
| Lead Intake | /intake |
| All users | /admin/users |
| Audit log | /admin/audit |
| Attendance grid | /admin/attendance |
| Targets | /admin/targets |
| Templates | /admin/templates |
| Workflows | /admin/workflows |
| System settings | /settings |
| Vault (all entries) | /admin/vault |
| CRM health check | /admin/health |
| Integrations | /admin/integrations |
| Deduplication tool | /admin/dedup |
| Bulk imports | /admin/imports |
| AI trial manager | /admin/ai-trial |
| Team management | /team |
| Awaiting team assignment | /admin/awaiting-team |
