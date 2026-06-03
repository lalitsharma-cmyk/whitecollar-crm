# White Collar Realty CRM — Manager Training Guide
**Audit target:** commit `64e779c`
**For:** MANAGER role users
**CRM URL:** https://crm.whitecollarrealty.com

---

## Your role in the CRM

As a Manager, you have visibility into all leads for your team (Dubai or India). You can see reports, call logs, and the leaderboard for your team. You cannot access admin tools (user management, settings toggles, etc.) — those are reserved for ADMIN.

---

## 1. Your morning routine

### 1. Check the dashboard
- Open `/dashboard` each morning
- The **By Salesperson table** shows: Calls, Connected, Due today, Overdue, Closeable now, Needs [your name]
- Focus on the "Needs [your name]" column — these leads need your personal intervention today

### 2. Action List
- Go to `/action-list`
- The **IN NEGOTIATION / EOI** section shows your highest-value deals — these are ready to close, push agents on these today
- The **NEED YOUR ATTENTION** section shows leads your agents have flagged for your help
- The **FOLLOW-UPS OVERDUE** section is your early warning system — deals slipping

### 3. Activity Feed
- Go to `/reports/activity`
- Use the date picker to see yesterday's activity if you're reviewing the previous day
- Historical MIS-import entries show "(historical data)" so you know they're not from your current team

---

## 2. Monitoring your team

### Call Logs (`/call-logs`)
- See all calls your team made, filterable by agent, outcome, date range
- Export as CSV for weekly or monthly reporting
- You only see your team's calls (Dubai or India — whichever you're assigned to)

### Leaderboard (`/reports/leaderboard`)
- 90-day window
- Sorted by calls made
- Shows: calls, leads assigned, qualified, won, conversion rate
- Use this in weekly team meetings to recognise top performers
- Empty state shows if no calls logged — this may indicate a data import issue

### Activity Feed (`/reports/activity`)
- Daily log of all calls and lead updates for your team
- Use the date picker to look back at any date

---

## 3. Pipeline review

### Sales Pipeline (`/pipeline`)
- Kanban board showing all active leads by stage
- Use the team filter to see only Dubai or India leads
- Cards with red "at risk" rings need attention — hover for the risk reason
- Momentum chips: green (healthy ≤3 days), amber (slowing ≤7 days), red (stuck >7 days)

### Moving a lead's stage (on behalf of an agent)
1. Find the lead card on the pipeline
2. Desktop: drag the card to the new column, fill in "What changed?" and click Move
3. Mobile: tap "Move Stage" button on the card, pick the new stage from the bottom sheet

---

## 4. Following up with clients (Action List)

### Using the Action List effectively
- Cards in **IN NEGOTIATION / EOI** show the WhatsApp draft message pre-filled — use it
- Each card has: Next step (what to say), Why you (why your involvement matters), WhatsApp draft
- Use the **Escalate** action on overdue cards to flag them and add a note
- Use **Snooze** if you want to revisit in 24–48 hours

---

## 5. Awaiting Team inbox

- Go to **Awaiting Team** in the sidebar (TEAM section)
- These are leads that have been received but not yet assigned to Dubai or India market
- Pick up leads here and assign them to the correct team before agents can work them

---

## 6. Reports available to you

| Report | Where | What it shows |
|---|---|---|
| Activity Feed | `/reports/activity` | Daily calls and lead updates with date picker |
| Leaderboard | `/reports/leaderboard` | 90-day agent performance ranking |
| Daily targets | `/reports/daily` | Agent calls vs. targets with % achievement |
| Lead sources | `/reports/sources` | Which marketing channels produce the best leads |
| SLA compliance | `/reports/sla` | Speed-to-lead: how fast agents are picking up new leads |
| Cooling leads | `/reports/cooling` | Leads going cold — needs re-engagement |
| Commission | `/reports/commission` | Estimated commission on won deals |
| Team comparison | `/reports/team-comparison` | Dubai vs. India metrics side by side |
| Travel | `/reports/travel` | India team site visit travel reimbursement |
| Year-to-date | `/reports/ytd` | Annual cumulative summary |
| Best time to call | `/reports` (heatmap) | Best DOW and hour for agent calls (30-day data) |

---

## 7. What you cannot do as a Manager

- Cannot add or edit users (Admin only — ask Lalit)
- Cannot toggle system settings (testing mode, round-robin, speed-to-lead, BANT gate)
- Cannot access the admin tools grid (duplicates, audit log, templates, workflows, etc.)
- Cannot see the other team's data (Manager's lead/report scope is limited to their assigned team)
