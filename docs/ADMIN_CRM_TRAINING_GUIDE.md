# Admin Training Guide — White Collar Realty CRM

This guide is for the **Admin** (Lalit). As Admin you can see and control **everything** — every lead, every agent, every team, every report. This guide walks you through what you can see, how to run the team, and — most importantly — how the CRM keeps our data safe so we never lose a client again.

No technical knowledge needed. Everything here is buttons and screens.

> **What Admin can see:** Unlike agents (who see only their own leads) and managers (who see their own team), **you see all of it** — both teams (Dubai and India), every agent's stats, all leads, all reports, plus the setup screens nobody else can touch.

---

## 1. The Dashboard — your command center

Open the **Dashboard** first thing. Top to bottom:

- **"I am here"** — punch in for the day.
- **Team toggle (Dubai / India / All)** — switch which team you're looking at. Admins and managers can switch freely; agents are locked to their own team.
- **Today's mission** — the headline goal for the day.
- **Four hero tiles** — your daily early-warning system:
  - **🔥 Hot leads untouched** — hot leads with no activity in 6+ hours
  - **⏰ Overdue follow-ups** — promises the team hasn't kept
  - **💎 Closable deals** — leads in Negotiation with an EOI stage set
  - **🧊 Cold revival opportunities** — high-value dormant leads (30+ days)
  
  Note: agents see these tiles scoped to their own leads only. You see the full team.
- **Sales Floor Live Feed** — every team action as it happens.
- **KPI tiles** — the day's headline numbers.
- **EOI pipeline + weighted forecast** — expected revenue, weighted by how likely each stage is to close.
- **By Salesperson table** — every agent's activity side by side.
- **Admin morning queue** — fresh leads waiting; if not picked up quickly they **auto-assign** to an active agent so nothing sits idle.

> **Read it like a doctor reads vitals:** high "Hot untouched" or "Overdue" = the team needs a push *now*.

---

## 2. Assign & reassign leads

New leads are shared out automatically by **round-robin** — the CRM rotates them fairly across active agents, so no one is overloaded and nothing is dropped.

To move a lead by hand:
1. Open the lead.
2. In **Lead admin**, use **Reassign** to pick a new owner (or **Reject** a junk lead).
3. Check **Assignment history** to see everywhere the lead has been.

**Awaiting Team:** Open the **Awaiting Team** page (red badge in the menu). Leads whose team (Dubai / India) hasn't been chosen wait here and do **not** auto-route until you tag them. Tag them promptly so they start flowing.

---

## 3. Monitor the whole team

### By Salesperson table (Dashboard)
A fast side-by-side of every agent's activity today.

### Team & Roles page
Your full team scoreboard. For each agent:
- **Active leads** and **Total calls**
- **Workload** (green = healthy, amber = heavy, red = overloaded)
- **Pipeline value (90 days)**
- **Avg response time** (green = fast, red = slow)
- **Team** and **weekly off-day**, **manager**, **specializations**, **daily call target**

### Pipeline
See **Pipeline** for every deal as a board. Momentum colours: **Healthy** (≤3 days), **Slowing** (≤7 days), **Stuck** (>7 days). Risk chips flag **"Stuck Nd"**, **"HOT lead going cold"**, **"No activity since stage change"**, and **"Awaiting manager review."**

> Any deal **stuck > 7 days** deserves attention — either nudge the agent or reassign.

---

## 4. Manage users & roles (Team & Roles page)

This page is **Admin/Manager**, but only **you (Admin)** can do the sensitive edits.

- **+ Invite User** — add a new teammate.
- **Role** — ADMIN, MANAGER, or AGENT (this controls what each person can see).
- **Manager** — set who an agent reports to *(Admin only)*.
- **Acefone agent id** — map each agent to their calling line so click-to-call rings *their* phone *(Admin only)*.
- **Company WhatsApp #** — the number an agent messages clients from *(Admin only)*.
- **Specializations & daily call target** — set per agent.

A **Permission matrix** at the bottom of the page spells out exactly what each role can do — keep it open when deciding someone's role.

> **Roles in plain English:**
> - **Agent** — sees only their **own** leads. Calls, logs, follows up.
> - **Manager** — sees **their team** (themselves + reports); can reassign and coach.
> - **Admin (you)** — sees **everything**; manages users, roles, integrations, and the whole system.

---

## 5. Check overdue leads & today's actions

1. The **Dashboard** hero tile **⏰ Overdue follow-ups** gives the headline count.
2. Open **Action List** for the full picture, grouped into **🔥 Ready to close**, **🚩 Need your attention**, and **⏰ Follow-ups overdue**.
3. Open **Activities** (Action Board) for the team's **⭐ Top 5 Actions** and upcoming site visits.

> Drive **overdue** toward zero daily — overdue follow-ups are broken client promises.

---

## 6. View the pipeline & forecast

- **Pipeline** screen — the full board, by stage, with momentum and risk chips.
- **Dashboard weighted forecast / EOI tiles** — expected revenue weighted by stage likelihood.
- **Reports → Pipeline overview** — funnel health, and where deals leak out.

The stages: **New → Contacted → Qualified → Site Visit → Negotiation → Booking Done.**

---

## 7. Track cold data (Revival Engine)

Open **Revival Engine** (💎, also called Cold Calls). Quiet leads aren't dead — they're a goldmine. As Admin you can see **all** cold leads, including **Unassigned** ones.

Buckets include: **All**, **Unassigned** (admin), **Manual cold**, **BANT not qualified**, and **30+ days stale**. There's a **Daily Revival Mission**, **Hidden Gems**, a leaderboard, and streaks to keep the team digging. When a cold lead warms up, **Promote to Lead** brings it back into the active pipeline.

---

## 8. Reports

Open **Reports**. The **decisions strip** answers three questions instantly:
- **Forecasted revenue**
- **Biggest funnel leak** (the stage where most deals die)
- **Stalled deals > 7 days**

Reports available:
- **Daily** · **SLA & Meetings** · **Lead Sources** · **Cooling leads**
- **Team comparison** · **Commission** · **YTD** · **Travel Reimbursement** · **Pipeline overview**
- **Best-time-to-call heatmap** (you see the whole team's)

Every report now has a **← Back to reports** link and a **shared date-range picker** (calendar) so you can query any date window. The old "Agent productivity" chart has been removed — use the **By Salesperson table** on the Dashboard instead.

**CSV exports are Admin-only** — Leads CSV and Calls CSV export buttons appear only for you. They're in the exports section at the bottom of the Reports page.

---

## 9. Bringing leads in (Lead Intake)

Open **Lead Intake** (Admin menu) to connect lead sources:
- **Website embed**, **WhatsApp**, **CSV upload**, **Google Sheets / Forms**, **Email**
- **Pre-assigned import** — bulk-import a file that already names the owner (e.g. an agent's MIS sheet)

All new leads then flow through **round-robin** assignment (unless pre-assigned or awaiting a team tag).

---

## 10. Preventing data loss (this is the big one)

The whole reason we moved off spreadsheets was to **stop losing clients**. Here's how the CRM protects our data — and what you should check.

- **Nothing is ever hard-deleted in day-to-day use.** Leads aren't wiped — they're rejected/closed but stay in the system. There is no "delete everything" button. Your team **cannot** accidentally erase data. *(The one deliberate exception is the admin **Duplicate Detector** below: when you merge duplicates, the extra copy is folded into the master you keep — all its calls, notes, and history move over — and the merge is written to the audit log. That's the only place a record is removed, and only an Admin can do it.)*
- **Audit Log** — open the **Audit Log** page (Admin only). It's an **append-only** trail: who did what, when, and from where. Columns: **When / Who / Action / Entity / Detail / IP.** Filter by exports, admin actions, failed logins, and bulk lead changes. If anything ever looks wrong, the answer is here.
- **Automatic database backups** — the system backs up the database on a schedule, so even in a worst case we can restore.
- **System health / Integrations** — open the **Integrations** (and **System health**) page to confirm everything is green: **Push notifications**, **Acefone calling**, **Email (Resend)**, **WhatsApp**, **scheduled jobs (crons, including the backup)**, and the **database**. A red card here is your signal to call for technical help before it becomes a problem.

> **Peace of mind:** Spreadsheets let one wrong click delete a month of work. This CRM does not. Between **no hard delete**, the **audit log**, and **automatic backups**, our client data is safe.

---

## 11. Other Admin-only screens worth knowing

- **Attendance** — who punched in and when.
- **Daily Targets / Quality** — set targets and review call/remark quality.
- **Site Visits** — track every scheduled and completed viewing.
- **Workflows / Templates** — automate routine steps and standard messages.
- **Duplicates** — find and merge the same client entered twice.
- **Team Mood / Vault** — keep a pulse on morale.
- **Settings** — working hours (10:00–19:00 IST, Mon–Sat), round-robin controls, speed-to-lead, travel ₹/km, the **🧪 Testing mode** master switch, and the **☕ Daily motivation (pilot)** toggle.

> **About Testing mode:** When ON, it pauses round-robin, SLA timers, overnight messages, and speed-to-lead. Great for trying things safely — just remember to turn it **OFF** so real leads flow again.

> **About the ☕ Daily motivation (pilot):** In **Settings**, find the "Daily motivation (pilot)" card. Switch it ON and choose which team sees it (Dubai, India, or Both). The card shows a daily quote on every team member's dashboard, with an optional **Listen** button the browser reads aloud. Start with one team to check the tone before rolling out to everyone. This has nothing to do with AI — it runs on a deterministic daily quote list and is always on even without an AI key.

> **About AI features:** Several features (AI score explanations, the AI Motivator card voice line) say "available once AI is switched on." To activate them, add the Anthropic API key to the server environment variables. Until then, rule-based fallbacks are shown instead — no errors, just no AI-generated text.

---

## 12. What NOT to do

- ❌ **Don't** leave **Testing mode ON** by accident — real leads stop routing while it's on.
- ❌ **Don't** ignore a **red card** on Integrations / System health — flag it for technical help early.
- ❌ **Don't** forget the **Awaiting Team** queue — those leads route to no one until tagged.
- ❌ **Don't** assign new leads to an agent already showing a **red workload** chip.
- ❌ **Don't** worry about deletion — there's no way for the team to wipe data. The audit log and backups have your back.
- ❌ **Don't** share admin login credentials.

---

## 13. Need help?

Open the in-app **Help** page, or for anything technical, escalate to your developer. Day-to-day team questions come to **you** — **lalit@whitecollarrealty.com**.

---

# ⭐ Admin's One-Page Daily Checklist

**☀️ Morning**
- [ ] Punch in (**"I am here"**)
- [ ] Scan the **4 hero tiles** (Hot untouched / Overdue / Closable / Cold revival opportunities)
- [ ] Clear the **Admin morning queue** (or let auto-assign handle it)
- [ ] Tag any **Awaiting Team** leads so they start routing
- [ ] Confirm **Testing mode** is **OFF** (unless you're deliberately testing)

**📊 Run the floor**
- [ ] Watch the **Sales Floor Live Feed** — is everyone active?
- [ ] Review **By Salesperson** and **Team & Roles** (workload, response time)
- [ ] Work the **Pipeline** — flag deals **stuck > 7 days**
- [ ] Rebalance leads from **red** (overloaded) to **green** agents
- [ ] Push **overdue follow-ups** toward zero

**👥 People & pipeline**
- [ ] Handle any role/user changes on **Team & Roles**
- [ ] Check **Revival Engine** — cold + unassigned leads being worked
- [ ] Glance at **Reports** decisions strip (forecast / leak / stalled)

**🛡️ Data safety (quick but vital)**
- [ ] **Integrations / System health** — all cards green? (push, calling, email, WhatsApp, **backups**, database)
- [ ] Skim the **Audit Log** if anything looked unusual today

**🌙 End of day**
- [ ] Recognise a win on the **Leaderboard**
- [ ] Note team **mood** — anyone need support tomorrow?
- [ ] Everything green, overdue near zero, data safe ✅
