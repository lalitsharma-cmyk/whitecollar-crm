# White Collar Realty CRM — Admin Presentation Outline
**Audience:** Lalit Sharma (Admin) and Sameer (Admin)
**Format:** 10 slides | **Duration:** 35–45 minutes
**Tone:** Comprehensive, strategic, operational
**Presenter:** Lalit (self-briefing) or developer

---

## SLIDE 1: TITLE SLIDE
**Headline:** "White Collar Realty CRM — Full System Overview"
**Subtext:** What is built, what it controls, and what to do before going live
**Visual:** System architecture overview — database, server, agents on phones

---

## SLIDE 2: THE SYSTEM IN ONE VIEW
**Headline:** "One platform. Two teams. Real-time data."

**System overview diagram:**
- 4 agents (Dinesh, Mehak, Tanuj, Yasir) → log calls, leads, WhatsApp
- 2 admins (Lalit, Sameer) → dashboard, reports, assignments, settings
- 1 manager (role to be assigned) → team-scoped view
- Automated workflows → follow-up reminders, SLA alerts, stage triggers
- Neon Postgres database (44 leads, 600+ call logs, attendance records)
- Vercel cloud hosting (crm.whitecollarrealty.com)

**Key capabilities:** Lead lifecycle, call logging, WhatsApp outreach, pipeline management, reports, gamification, mobile PWA, automation engine

---

## SLIDE 3: THE ADMIN DASHBOARD
**Headline:** "Your command center for both teams."

**What to point out:**
- Team filter tabs (Dubai / India / All) — Admin-only feature
- TODAY section: 4 urgent tiles + 5 scheduled tiles — what needs action right now
- UPCOMING section: follow-ups for next 7 days
- BY SALESPERSON table: each agent's performance at a glance
- ANALYTICS section: 8 KPI tiles with period comparison
- Admin morning queue widget: escalations, unassigned leads, SLA breaches

**Visual:** Annotated dashboard screenshot with sections labeled

---

## SLIDE 4: LEAD MANAGEMENT — THE FULL LIFECYCLE
**Headline:** "From inquiry to booking — every step is tracked."

**Flow diagram:** Inquiry → /intake → Assign → Agent calls → Logs activity → Stage advances → EOI → Booking → WON

**Key admin actions at each step:**
- Intake: Review and assign new leads
- NEW: Ensure assignment within 24 hours (speed-to-lead)
- QUALIFIED: Verify BANT is genuinely confirmed
- NEGOTIATION+: Monitor closely; involve yourself in deal progression
- LOST: Review reason codes to identify systemic issues

**Admin tools:** /leads (full view, all filters), /pipeline (visual), /admin/dedup (find duplicates), /admin/imports (bulk import history)

---

## SLIDE 5: THE REPORTS SUITE
**Headline:** "Every report you need to run the business."

| Report | URL | What it answers |
|--------|-----|----------------|
| Funnel Analysis | /reports | Where are leads dropping off? |
| Leaderboard | /reports/leaderboard | Who is performing? |
| Activity Feed | /reports/activity | What happened today? |
| Daily Report | /reports/daily | Full daily summary |
| SLA Report | /reports/sla | Who is violating response times? |
| Travel Reimbursement | /reports/travel | How much is owed per agent? |
| Team Comparison | /reports/team | Dubai vs. India performance |
| Commission Report | /reports/commission | Pipeline value and won commissions |

**CSV Export:** Available on most report pages. Use for Excel analysis or sharing with stakeholders.

**Notes for presenter:** Show the real /reports page. Walk through the 3 hero decision tiles at the top.

---

## SLIDE 6: AUTOMATION — HOW THE WORKFLOW ENGINE WORKS
**Headline:** "Set it once. The system does the follow-up."

**How workflows work:**
1. A Trigger fires (e.g., "Follow-up date passes without activity")
2. A Condition is checked (e.g., "Only for leads in CONTACTED or QUALIFIED stage")
3. An Action executes (e.g., "Send push notification to assigned agent")

**Current state:** Testing Mode is ON → zero workflows configured → no automation runs
**What to configure first:** (show checklist)
1. New lead assigned → notify agent
2. Follow-up overdue 24h → remind agent
3. 7 days in NEW with no activity → alert manager
4. Lead reaches EOI stage → notify Lalit

**URL:** /admin/workflows

**Visual:** IF/THEN workflow card with color-coded trigger → condition → action boxes

---

## SLIDE 7: SYSTEM SETTINGS AND MASTER SWITCHES
**Headline:** "These settings control how the entire CRM behaves."

| Setting | Currently | What it does |
|---------|-----------|-------------|
| Testing Mode | ON | Pauses all automation. Safe for testing. |
| Round-Robin | OFF | Auto-assigns leads to agents in rotation |
| Speed-to-Lead | OFF | Auto-sends first contact after new lead |
| BANT Gate | Set | Stage required before BANT fields are mandatory |
| AI Features | OFF | AI scoring, summaries, next-action suggestions |
| Travel Rate | ₹10/km | Used for travel reimbursement report |

**Before going live — checklist before turning Testing Mode OFF:**
- [ ] 3+ workflows configured
- [ ] Pagination on /leads is live
- [ ] Attendance auto-marking confirmed working
- [ ] All agents subscribed to push notifications
- [ ] Stale test leads archived

**URL:** /settings

---

## SLIDE 8: USER MANAGEMENT AND PERMISSIONS
**Headline:** "Who can see what — and current gaps."

**User table (current 7 users)** — show from /admin/users

**Role summary:**
- ADMIN: Full access — you and Sameer
- MANAGER: Team-scoped access — no one currently assigned
- AGENT: Own leads only — 4 agents

**Current gap:** User management is read-only from the UI. Cannot invite, edit, or deactivate users without database access. Building the "Invite User" form is a near-term priority.

**Assigning MANAGER role:** When a team lead is ready to be promoted, their role field must be updated in the database (via Neon Studio) to MANAGER. This unlocks team-scoped dashboard, reports access, and attendance management.

---

## SLIDE 9: PRE-LAUNCH CHECKLIST
**Headline:** "8 conditions to meet before the CRM is the primary sales system."

| # | Condition | Status |
|---|-----------|--------|
| 1 | Leads list has pagination (50/page) | NOT DONE |
| 2 | Attendance auto-marking works | NOT DONE |
| 3 | At least 3 workflows configured | NOT DONE |
| 4 | All agents subscribed to push notifications | NOT DONE |
| 5 | Stale test leads archived | NOT DONE |
| 6 | All agents completed agent training | NOT DONE |
| 7 | Invite agent UI built (or documented workaround) | NOT DONE |
| 8 | Reports route guard for agents added | NOT DONE |

**Estimated development effort to complete all:** 5–8 developer days
**Estimated training time:** 2–3 half-day sessions (1 admin, 1 manager, 1 agent group)

---

## SLIDE 10: WHAT IS NEXT + Q&A
**Headline:** "Near-term, mid-term, and future priorities."

**Near-term (this sprint):**
- Fix attendance auto-marking
- Add pagination to /leads
- Configure 3 starter workflows
- Add server-side route guard for reports

**Mid-term (next 30 days):**
- Build "Invite Agent" UI in /admin/users
- Turn on Testing Mode → observe automation for 1 week
- Add commission summary report
- Configure targets for each agent in /admin/targets

**Future (when team grows to 10+ agents):**
- Assign MANAGER role to a team lead
- Enable AI features (trial mode → gradual rollout)
- Build site visit confirmation workflow
- Upgrade Vercel plan and enable Neon connection pooling
- Property preference matching + client intelligence UI

**Q&A:** What operational gaps are you most concerned about? What should be prioritized first?
