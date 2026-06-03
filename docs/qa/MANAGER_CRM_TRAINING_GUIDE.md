# White Collar Realty CRM — Manager Training Guide
**For:** Managers (when MANAGER role is assigned)
**Version:** June 2026 | **CRM URL:** https://crm.whitecollarrealty.com

---

## OVERVIEW: THE MANAGER'S ROLE IN THE CRM

As a Manager, you sit between Admin and Agents. Your CRM access gives you visibility into your team's leads and performance, and the ability to intervene — reassign leads, escalate deals, review follow-up quality, and identify which agents need coaching.

**What you CAN do:**
- View all leads assigned to agents on your team
- Filter leads by agent within your team
- Assign or reassign leads to team agents
- View team-scoped dashboard (KPI tiles, scoreboard, by-salesperson table)
- Access all Reports (Funnel, Leaderboard, Activity Feed, Daily Report, SLA, Commission)
- View and manage Team & Roles and Awaiting Team pages
- Access /admin/targets (team targets) and /admin/attendance (team attendance)
- Log calls, add notes, mark actions done on any team lead

**What you CANNOT do:**
- View leads or agents from the other team (Manager is scoped to own team only)
- Access /admin/users, /admin/workflows, /admin/templates, /admin/integrations (admin-only)
- Change system settings (Testing Mode, Round-robin, AI Features, BANT gate, Travel rate)
- Access Lead Intake (/intake) — admin only

**Note:** No user currently has MANAGER role assigned. When you are promoted to Manager in the system, these permissions activate automatically.

---

## SECTION 1: DAILY MORNING REVIEW (10 minutes)

### Step 1 — Dashboard scan
Open /dashboard. As a Manager, you see:
- **KPI tiles scoped to your team** — New leads, contacted, qualified, won this week
- **Team Scoreboard** — each agent's call count and conversion rate for the period
- **Weekly Summary** — new leads, contacted, qualified+, won vs. last week comparison
- **Today's Mission** — the single highest-priority lead for your team right now

Key questions to answer from the dashboard each morning:
1. Which agent has the most overdue follow-ups today?
2. Are there any unassigned leads sitting in the queue?
3. Is the team's weekly trajectory up or down vs. last week?

### Step 2 — Action List review
Open /action-list. As a Manager, you see:
- All actions across your team's leads (not just your own)
- Filter by specific agent using the owner dropdown

Leads in "Needs Attention" are the ones that require your intervention today.

### Step 3 — Attendance check
Open /admin/attendance.
- Confirm which agents are marked PRESENT or LATE today
- If an agent is absent and not marked, contact them directly

---

## SECTION 2: MONITORING YOUR TEAM'S PIPELINE

### View team leads
Go to /leads. Use the **Owner filter** to switch between agents. Check:
- How many leads does each agent have in NEW stage? (Should be moving quickly)
- Who has the most OVERDUE follow-up dates?
- Are any leads in NEGOTIATION or EOI that need your attention?

### Using the Pipeline (Kanban) view
Go to /pipeline. Use the **Owner filter** to view one agent's pipeline at a time.

Red "at risk" badges mean a lead has been stuck in the same stage for too long. These need your attention — ask the agent what is happening with that lead.

Key pipeline health questions:
- Are there leads stuck in NEW for 7+ days? (No outreach made)
- Are QUALIFIED leads moving to SITE VISIT? (Conversion stalling?)
- Are any NEGOTIATION leads going cold? (Days-in-stage increasing)

---

## SECTION 3: REVIEWING AGENT CALL QUALITY

### Activity Feed (/reports/activity)
Shows today's calls with outcomes. Check:
- Which agents logged calls today?
- What were the outcomes? (Connected, No Answer, Call Back, Interested)
- Are remarks substantive, or one-word entries?

**Red flag:** An agent logging 15 calls with remarks like "No answer" and "Follow up" and zero detail is gaming the system. Real call notes describe what the client said.

### Leaderboard (/reports/leaderboard)
Shows call count, connect rate, conversion rate by agent for last 30 days.
Use this to identify:
- Who is making the most calls? (Volume)
- Who has the best connect rate? (Quality of numbers / timing)
- Who is converting the most? (Pitch quality + lead quality)

### Funnel Report (/reports or /reports/funnel)
Shows how many leads are at each stage across your team. Watch for bottlenecks:
- Large number in NEW → agents are not calling quickly enough (speed-to-lead problem)
- Large number in CONTACTED → not qualifying properly (conversion problem)
- Large number in QUALIFIED → not getting site visits booked (follow-through problem)

---

## SECTION 4: REASSIGNING LEADS

When an agent leaves, changes team, or has too many leads, you can reassign.

1. Go to /leads
2. Find the lead(s) to reassign
3. Open the lead
4. In the assignment section, change the **Owner** to the new agent
5. Add a note explaining the reassignment (for the audit trail)

**Note:** You can only assign leads to agents within your own team. Cross-team reassignment requires admin.

---

## SECTION 5: RESPONDING TO ESCALATIONS

When an agent flags a lead for manager review:
1. You will see a notification in the bell icon
2. The lead appears in your Action List under "Needs Attention" with a flag icon
3. Open the lead, read the agent's note
4. Respond by: adding a note with your guidance, calling the client yourself, or adjusting the lead status/assignment

**Common escalation reasons:**
- Client asking for a special price or extended payment plan
- Client wants to speak with a senior person
- Agent unsure about BANT qualification
- Technical question about a project the agent cannot answer

---

## SECTION 6: REVIEWING ATTENDANCE

Navigate to /admin/attendance.

The grid shows the last 14 days for each agent with statuses:
- PRESENT (on time, before 10:30am login)
- LATE (logged in after 10:30am)
- ABSENT (no login at all)
- ON_LEAVE (manually marked)
- WFH (working from home)

**Note (known issue):** Auto-attendance marking is currently broken — most dates show as blank even when agents used the CRM. Until this is fixed, treat the attendance grid as incomplete and verify with agents directly.

To manually mark attendance: Click on any cell in the grid and select the correct status from the dropdown.

---

## SECTION 7: USING REPORTS

### Daily Report
Use this to see what happened today: calls made, leads created, stages moved. Useful for end-of-day team check-in.

### SLA Report
Shows which leads have violated follow-up SLA (gone overdue without action). This is your coaching dashboard — if an agent has 5 SLA violations in a week, that is a performance conversation.

### Commission Report
Shows commission pipeline by stage. Use this to forecast team revenue for the month.

### Team Comparison
Compares your team's metrics vs. the other team. Use this to benchmark and identify if your team needs support.

---

## SECTION 8: DAILY CHECKLIST FOR MANAGERS

Morning:
- [ ] Log in before 10:30am (attendance)
- [ ] Tap "I'm here" on dashboard
- [ ] Check dashboard — any team KPI changes?
- [ ] Check Action List — any leads in "Needs Attention"?
- [ ] Verify attendance grid (who is online today?)

During the day:
- [ ] Review /reports/activity for call quality (remarks substance)
- [ ] Check pipeline for stuck leads (7+ days in same stage)
- [ ] Respond to escalations from agents
- [ ] Reassign any unowned leads in the queue

Weekly:
- [ ] Review Leaderboard — identify top and underperforming agents
- [ ] Review Funnel Report — identify stage conversion bottlenecks
- [ ] Review SLA violations — identify agents needing coaching
- [ ] Check commission pipeline — project month-end revenue

---

## SECTION 9: COACHING CONVERSATIONS USING CRM DATA

Use these specific data points when coaching an agent:

**Agent is not making enough calls:**
"Your leaderboard shows 8 calls this week. The team average is 25. What is getting in the way?"

**Agent calls are not converting to site visits:**
"You have 12 leads in CONTACTED. Only 1 moved to QUALIFIED this month. Let's review the remarks on your CONTACTED leads together."

**Agent has many overdue follow-ups:**
"Your Action List shows 8 overdue items. When you log a call, are you setting a follow-up date before you move to the next lead?"

**Agent's remarks are too thin:**
"I can see from the activity feed that most of your remarks are 'No answer' or 'Follow up.' When you do reach a client, what are they telling you? I need to see that in the remarks so I can help you."

---

## QUICK REFERENCE: KEY URLS

| What you want | URL |
|--------------|-----|
| Team dashboard | /dashboard |
| Your team's leads | /leads |
| Team action list | /action-list |
| Pipeline overview | /pipeline |
| Reports home | /reports |
| Agent leaderboard | /reports/leaderboard |
| Today's activity feed | /reports/activity |
| Attendance grid | /admin/attendance |
| Team targets | /admin/targets |
| Team & Roles | /team |

---

## GETTING HELP

For system issues: Contact Lalit (Admin)
For access issues (cannot see a page you should have access to): Contact Lalit — a role change may be needed
For data questions: Check /admin/audit first — every action is logged with timestamp and user
