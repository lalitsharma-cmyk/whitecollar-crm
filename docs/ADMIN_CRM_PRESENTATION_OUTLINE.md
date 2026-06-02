# White Collar Realty CRM — Admin Presentation Outline

> Audience: Lalit (Owner / Admin). Tone: clear, confident, business-first.
> Each slide = title + bullets + a speaker note. ~10 slides.

---

## Slide 1 — What is White Collar CRM?

- One web app at **crm.whitecollarrealty.com** for our entire Dubai-property sales operation — works on phone and desktop.
- Replaces scattered Google Sheets + WhatsApp chats with **one single source of truth**.
- Built around two teams — **Dubai** (Mehak, Dinesh) and **India** (Yasir, Tanuj) — with three roles: **Admin, Manager, Agent**.
- Mobile-first and action-first: it tells each person what to do next, not just stores data.
- You sit at the top — full visibility across every lead, agent, call, and deal.

> Speaker note: Frame it as "the office moved from a filing cabinet to a live cockpit." Everything the team did in sheets now lives here, but it works for you.

---

## Slide 2 — Why we're moving from Google Sheets

- Sheets had no ownership, no history, no reminders — leads quietly went cold.
- Anyone could overwrite anyone; no record of **who changed what, when**.
- No way to see today's follow-ups, overdue calls, or which agent is behind.
- WhatsApp numbers were copy-pasted by hand; calls were never logged.
- The CRM fixes all of this: assigned owners, full timeline per lead, automatic follow-up tracking, and click-to-call.

> Speaker note: This is the "why bother" slide. Lead with the pain — forgotten leads and zero accountability — then show the CRM removes it.

---

## Slide 3 — Admin dashboard overview

- Opens on the **Sales Command Center** — toggle between Dubai, India, or All teams.
- Top strip: **"I am here"** attendance widget first, then the hero action strip (hot leads untouched, overdue follow-ups, closable deals, cold-revival opportunities).
- **KPI tiles** each labelled with their time window and scope (today / this month / team vs you): calls dialed, calls connected, follow-ups due/overdue, ready-to-close, needs-attention, WhatsApp touches, total clients, and **"❄→🔥 Cold→Lead" (this month's conversions)**.
- **Weighted sales forecast** in AED + INR, a **live Sales Floor feed** of the team's latest actions, and leaderboards (intentionally visible to everyone — motivating, not surveillance).
- **☕ Daily motivation (pilot)** card: a rotating daily quote for both teams, with an optional spoken morning message. Admin-controlled from Settings.
- Admin-only morning queue: overnight leads waiting for you to assign.

> Speaker note: Emphasise the toggle (Dubai/India/All) — you can run each team's view or the whole company from one screen. Point out the attendance widget at the top — it doubles as a quick "who is in today" check.

---

## Slide 4 — Lead visibility

- You see **every lead** across both teams; agents see **only their own** (role-scoped — verified in the current build).
- Each lead detail shows: **Investor / End-user / Both** dropdown, full BANT card with **"N/4 captured" pill** at a glance, and a "why this score" explanation next to the AI score.
- Powerful filters: by team, owner, status, AI score, source, follow-up window, and tags (NRI / Investor / HNI).
- One-tap **smart filters**: Hot today, Ghosting, Site-visit potential, High budget; plus "Not picked 3+ / 7+ days".
- **EOI pipeline tiles** surface deals mid-booking, waiting on KYC, needing your sign-off, or stuck 7+ days.
- Full-text search across name, phone, email, company — and **CSV export is Admin-only**.
- New-lead entry warns instantly if the same phone number is already in the system — no more duplicate clients sneaking in.

> Speaker note: Stress the privacy point — agents can no longer browse each other's leads or back-derive lead sources. Also call out the duplicate-phone warning: that's the fix for the #1 complaint from the old sheets era.

---

## Slide 5 — Team monitoring

- **Team & Roles** page (Admin/Manager only): every agent's active leads, total calls, workload, 90-day pipeline value, and average response time.
- Colour-coded workload so over-loaded or idle agents jump out instantly.
- **By Salesperson** table on the dashboard: calls today, connected, due today, overdue, closeable, "needs Lalit", clients.
- Set each agent's **daily call target**, specialization, weekly-off, manager, and Acefone ID here.
- **Awaiting Team** inbox: leads with no team tag wait here until you pick Dubai or India (a red badge shows the count).

> Speaker note: This is your people-management cockpit. Point out the response-time column — it shows who's fast to a new lead.

---

## Slide 6 — Pipeline monitoring

- Visual **Kanban**: New → Contacted → Qualified → Site Visit → Negotiation → Booking Done.
- Cards auto-sort so **stuck and at-risk deals float to the top** of each stage.
- Risk flags: "Stuck X days", "No activity since stage change", "HOT lead going cold", "Awaiting manager review".
- Every stage move is saved with the agent's name and time — nothing is silently changed.
- Filter the board by team, owner, or AI score to zoom into any slice.

> Speaker note: The momentum colouring (healthy / slowing / stuck) is the key story — you instantly see where deals are rotting.

---

## Slide 7 — Reports & performance

- **Reports hub** leads with decisions: forecasted revenue, biggest funnel leak, and stalled-deal money tied up.
- All reports share a **date-range picker** (set once, all numbers update) and have **back buttons** so you never lose your place.
- Ready-made reports: Daily (target vs achieved), SLA & Meetings, Travel reimbursement, Lead Sources, Cooling leads, **Team comparison (Dubai vs India)**, Commission & earnings, Year-to-Date.
- **Best-time-to-call heatmap** (last 30 days, IST) shows when connects actually happen — down to the hour.
- Conversion funnel + per-source funnel reveal which channels truly close.
- **CSV export** of leads and calls is Admin-only.

> Speaker note: Team comparison and commission reports are the two you'll open most — call those out by name. The shared date picker means you can compare last month vs this month in seconds.

---

## Slide 8 — Data safety

- **Soft-delete by default**: rejected leads, LOST leads, and old imports are never wiped — full history is always there. *(The single exception is the admin Duplicate Detector: merging duplicates folds the extra copy into the one you keep, with an audit-log record.)*
- Role-based access: agents are locked to their own leads; team/comparison stats are Admin/Manager only. Every scoping rule is enforced server-side, not just hidden in the UI.
- **System health** page keeps the data clean and the app honest.
- **Testing mode** lets you pause automations (round-robin, escalation, auto-WhatsApp) safely while you experiment.
- **AI features** (AI score explanations, morning voice message) are built and ready — they switch on the moment an API key is added. Present as "ready to go", not yet live in production.

> Speaker note: Reassure on the big fear of leaving sheets — "we didn't lose control, we gained a safety net." Soft-delete means nobody can accidentally erase a client's history.

---

## Slide 9 — Daily admin workflow

- **Morning**: clear the assign queue + Awaiting Team, scan the Command Center hero tiles.
- **Midday**: check the By-Salesperson table and EOI pipeline — who needs a push, what needs your sign-off.
- Use **Lead Intake** to import new lists (CSV, Google Sheet, pre-assigned agent MIS) — all auto-dedupe and round-robin.
- **End of day**: glance at the Daily Report and team comparison; flag anything for tomorrow.
- Approve discounts/waivers and reassign leads as needed — all from your phone.

> Speaker note: Keep it to a 5-minute morning routine and a 5-minute evening routine — that's the pitch for adoption.

---

## Slide 10 — Rollout plan

- **Week 1**: you + managers go live; import existing sheets; confirm every agent has login + Acefone ID set.
- **Week 2**: agents start on the **Action List** daily; enforce "log every call + set a follow-up date".
- Turn on **Acefone click-to-call** and **WhatsApp** templates once the business number is connected.
- **Daily motivation pilot** is already ON for both teams — if the tone doesn't land, you can switch it off or back on from **Settings → "☕ Daily motivation (pilot)"** in seconds.
- **Review after 30 days**: compare connect rates, follow-up discipline, and bookings vs the old sheet era. Use the Reports date-range picker to pull a clean before/after.

> Speaker note: Close on momentum — small daily habits, one team leading, then both. Sheets get switched off only once everyone trusts the CRM.
