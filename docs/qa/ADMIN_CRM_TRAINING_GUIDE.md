# White Collar Realty CRM — Admin Training Guide
**Audit target:** commit `64e779c`
**For:** Admin users (Lalit Sharma and any other ADMIN role)
**CRM URL:** https://crm.whitecollarrealty.com

---

## Before you start: testing mode

The CRM has a master safety switch called **Testing Mode**. When ON, all automated actions (WhatsApp, assignment, escalations, notifications, scheduled actions) are paused. You will see a yellow banner across the top of every page.

- Turn Testing Mode ON before importing real client data so nothing leaks
- Turn Testing Mode OFF when you are ready for the team to go live
- Found in: Settings → Testing mode (master switch)

---

## 1. User management

### Adding a new agent

1. Go to **Settings → Users** (or directly to `/admin/users`)
2. Click **"+ Invite Agent"**
3. Fill in: Full name, Email, Role (AGENT/MANAGER/ADMIN), Team (Dubai or India), Temporary password (min 8 characters)
4. Click "Create account"
5. Share the temporary password with the new agent by phone or WhatsApp — they can change it from their Profile page

### Editing a user's role or team

1. Go to Settings → Users
2. Click **Edit** next to the user
3. Change Role or Team, click Save
4. Use this when promoting an agent to manager, or moving someone between the Dubai and India teams

### Deactivating / reactivating a user

1. Go to Settings → Users
2. Click **Deactivate** next to the user (turns them inactive — they cannot log in)
3. Click **Reactivate** to restore access
4. Note: you cannot deactivate your own account

---

## 2. Lead intake (importing leads)

### CSV/Excel import

1. Go to **Lead Intake** (bottom of left sidebar, Admin only)
2. Select import type: CSV, WhatsApp, Google Sheet, website
3. For CSV: upload the file, map columns, choose whether leads are Dubai market or India market
4. Set **lead origin**: Active (goes into /leads pipeline) or Cold (goes into Revival Engine)
5. Before importing large existing-client lists, turn OFF **Round-Robin** in Settings to prevent auto-assignment while you manually route leads

### After import

- Check `/admin/awaiting-team` for any leads that landed without a team assignment
- Assign them to Dubai or India using the team picker
- The badge count on "Awaiting Team" in the sidebar shows how many are waiting

---

## 3. Settings you control

### Round-robin auto-assign
- When ON: new leads auto-assigned to the next available agent every 5 minutes
- Turn OFF before bulk uploads, then turn back ON after routing is done

### Speed-to-lead
- When ON: new leads automatically receive the WhatsApp and email first-touch templates within seconds
- Skips overnight hours (10pm–10am IST)

### BANT gate
- Off: agents can move leads to Qualified without completing BANT
- Warn (recommended): shows reminder but still allows the move
- Strict: blocks the move until BANT is fully captured

### Travel rate
- Set the INR per km reimbursement rate for India team home/site visits
- Update when petrol prices change

### Daily targets
- Go to `/admin/targets` to set each agent's daily call target
- Used for the progress bar in the Reports → Daily page

---

## 4. Monitoring the team

### Dashboard
- **By Salesperson table** shows: Calls today, Connected, Due today, Overdue, Closeable now, Needs [your name], Total clients
- The "Needs [your name]" column counts leads flagged for your review — action these first each morning

### Activity Feed (`/reports/activity`)
- Shows all calls and lead updates for a selected date (IST)
- Historical MIS-imported entries are labeled "(historical data)"
- Use the date picker to view any past date

### Call Logs (`/call-logs`)
- Full searchable/filterable list of all calls
- Filter by agent, outcome, date range
- Export as CSV for external reporting

### Leaderboard (`/reports/leaderboard`)
- 90-day window, sorted by calls made
- Shows: calls, leads assigned, qualified, won, conversion rate
- Empty state message shows if no call data in the window

---

## 5. System health

### Admin health check
- Go to `/admin/health` to see server status, cron job health, DB connectivity
- Also check `/admin/cron-health` for cron job run history

### Workflow automation
- Go to `/admin/workflows` to create and manage automation rules
- Currently zero rules are configured — set up at minimum:
  - Lead untouched 24h in NEGOTIATION → flag "Needs Manager"
  - New lead not contacted in 15 min → admin alert

### Duplicate management
- Go to `/admin/dedup` to review potential duplicate leads
- Merge duplicates here — this cannot be undone

---

## 6. AI features

### Turning AI on/off
- Go to Settings → AI Features
- When ON: leads are automatically scored (HOT/WARM/COLD) and get AI summaries
- When OFF: existing AI outputs are preserved, no new scoring runs
- Use the AI Trial feature at `/admin/ai-trial` to run a bounded cost preview before enabling globally

---

## 7. Attendance

- Attendance is automatically marked when an agent loads any CRM page while logged in
- View the full attendance calendar at `/admin/attendance`
- Agents can force-override their attendance (e.g. they were marked absent but are actually present) from their dashboard widget

---

## 8. Before go-live checklist

- [ ] Turn Testing Mode OFF
- [ ] Delete test leads from development (use `/admin/wipe-leads`)
- [ ] Verify all agents have accounts with correct teams (`/admin/users`)
- [ ] Set daily call targets for each agent (`/admin/targets`)
- [ ] Configure at least one workflow rule (`/admin/workflows`)
- [ ] Confirm push notifications working for key users (Settings → Push notifications → Test)
