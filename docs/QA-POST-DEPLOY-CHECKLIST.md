# Post-Deploy QA Checklist

> **For Lalit (or anyone running QA).** Walk through this top-to-bottom after every `npm run push`. Items are grouped by **Round** (the wave of changes that introduced them) and by **surface** (where in the app to test). Tick the box once verified.
>
> **Before you start:** open the site, log in as an ADMIN user, and keep one AGENT login handy in an incognito window (some tests need both perspectives).
>
> **Smoke-test command (run first):**
> ```
> curl https://crm.whitecollarrealty.com/api/smoke
> ```
> Expect `{ "ok": true, "checks": [...] }`. If `ok: false`, look at the `failed` array — those subsystems are down and the rest of this checklist will mostly fail too. **Stop and fix or roll back.**
>
> **Rollback procedure:** If anything stays red after a 2-minute investigation:
> ```
> git revert HEAD && git push
> ```
> Vercel auto-deploys the previous commit. Re-run the smoke command to confirm green.

---

## Round 2 — BANT, sticky notes, project picker, reject modal, cleanup

### Dashboard

- [ ] Open `/dashboard` → confirm there's **no "My To-Do" widget** (it was removed; if you still see it, the deploy didn't take)
- [ ] Confirm there's **no Print button** in the top-right of the dashboard header
- [ ] Open the team filter dropdown → confirm **no "Delhi" entry duplicates "India"** (Delhi was a stale alias and is gone)
- [ ] Scroll the dashboard → confirm tiles still load without console errors (open DevTools → Console)

### Lead detail

- [ ] Open any lead → see **4 BANT chips (B / A / N / T)** at the top of the qualification card instead of a single status dropdown
- [ ] Click the **A (Authority)** chip → dropdown shows `DECISION_MAKER` / `INFLUENCER` / `GATEKEEPER` / `UNKNOWN`; pick one and reload — value persists
- [ ] Click into the **N (Need)** chip → type a 1-line `needSummary` (e.g. "Move-in for daughter's school year"), blur → reload — text persists
- [ ] On the right rail, locate the **Sticky Note** widget → type a private note, blur — reload, note persists
- [ ] Switch to a DIFFERENT user account (incognito) and open the SAME lead → the sticky note from the previous user is **NOT visible** (sticky notes are per-user private)
- [ ] Click **"Add discussed project"** → project picker opens with searchable list; pick one → it appears in the "Discussed projects" list
- [ ] Click **"Reject this lead"** → modal opens with a dropdown of reasons (`FUND_ISSUE` / `WAR_FEAR` / `LOW_BUDGET` / `LOOK_AFTER_2_YEARS` / `WAITING_FOR_PROPERTY_SALE` / `OTHER`)
- [ ] Pick `OTHER` → confirm the free-text "note" field becomes required (Submit is disabled until filled)
- [ ] Submit the reject → lead status flips to `LOST`, `rejectionReason` + `rejectedAt` populated, lead disappears from the active list

### Intake

- [ ] Open `/intake` → CSV importer is present; **CSV button + Copy button removed from main `/leads` page** (intake is the only entry now — see Round 6)

---

## Round 3 — AI scoring, revival, EOI removed, Smart CMA placeholder, QualityScore, reports

### Dashboard / lead detail

- [ ] Open a lead with an interested-project set → the **AI score chip** (HOT / WARM / COLD) is visible near the top
- [ ] Click the score → expandable card shows `whyShort` (1-sentence explanation) and a `nextAction` line — not generic phrases
- [ ] Re-score a lead manually (button in lead detail) → `aiUpdatedAt` timestamp updates
- [ ] Confirm `aiScoreValue` is a 0–100 integer in the chip's tooltip
- [ ] If `GEMINI_API_KEY` is unset (check via `/api/smoke`), confirm the rule-based fallback message appears in the summary ("Rule-based (no AI key set)...")

### Revival surface

- [ ] Open `/dashboard` → **Daily Revival Mission** card appears for AGENT role with at least 1 candidate lead
- [ ] Click "Mark as revived" on a candidate → it disappears from the mission and lead's `lastTouchedAt` updates
- [ ] Open the **Revival Leaderboard** card → shows the top agents by revival count this week

### EOI cleanup

- [ ] Open a lead in `NEGOTIATION` → **there is no "EOI Workflow" panel inline on the main lead card** (it was removed from the visible card stack; the underlying schema is still there for later)
- [ ] Confirm the EOI sub-stages do NOT appear as a pipeline filter at `/pipeline`

### Smart CMA placeholder (Round 3 stub)

- [ ] Open a lead → see a **"Smart CMA"** card with a placeholder body ("Coming in Round 4" or similar) — confirms the card slot is wired

### Quality Score

- [ ] Open `/admin/quality` → page renders without errors
- [ ] Sub-axes display: Activity, Funnel, Behavioural (Wellbeing is HIDDEN for managers — only shown to the agent themselves)
- [ ] Open `/profile` (as an AGENT) → see your **own** Quality Score with all 4 axes including Wellbeing

### Reports

- [ ] Open `/reports/sla` → table renders; column for `rejectionReason` exists in the SLA breakdown
- [ ] Open `/reports/sources` → conversion-by-source chart renders
- [ ] Open `/reports/daily` → today's row renders (no spinner stuck)
- [ ] Open `/reports/ytd` → year-to-date table renders

---

## Round 4 — Smart CMA v1, voice playback, reports retrofit, IamHere

### Smart CMA v1

- [ ] Open a lead with `budgetMin`, `configuration`, and `city` set → the **Smart CMA card** shows comparable units pulled from `Unit` rows
- [ ] Confirm the comparables match the lead's city/budget band (not random results)
- [ ] If lead has no budget → card shows "Add budget to generate CMA" prompt instead of an empty table

### Voice playback

- [ ] Open a lead with a logged call that has `recordingUrl` populated → an audio play button appears next to the call entry in the history
- [ ] Click play → audio loads and plays (test in 1 browser; if no recording URLs in your data yet, mark this N/A)
- [ ] Calls without `recordingUrl` show no audio control — just the text outcome

### Reports retrofit

- [ ] Open `/reports/team-comparison` → multi-team revenue/conversion chart loads
- [ ] Open `/reports/cooling` → list of leads gone cold renders
- [ ] Open `/reports/commission` → commission earned per agent renders
- [ ] All reports respect the date-range picker at the top — change the range, refresh, numbers shift

### IamHere

- [ ] Open `/dashboard` as an AGENT → **IamHere** card visible at top with a "Punch in" / "Punch out" toggle
- [ ] Click "Punch in" → `Attendance` row created for today; button switches to "Punch out"
- [ ] Refresh → state persists (you're still punched in)
- [ ] As ADMIN → open `/admin/attendance` → see today's row for the agent you just tested

---

## Round 5 — Quality Score impl, property scoping, off-shift round-robin, avatar fix, investor banner

### Quality Score (full impl)

- [ ] As an AGENT, open `/profile` → score updates after you log a new call (not stale)
- [ ] As an admin, open `/admin/quality` → manager view shows composite total but **Wellbeing column shows "—" or is hidden** (per spec §4)
- [ ] Switch the window selector (today / week / month) → numbers re-compute

### Property scoping

- [ ] Log in as an AGENT with `team = "Dubai"` → open `/properties` → only **UAE country** projects visible
- [ ] Log in as an AGENT with `team = "India"` → only **India country** projects visible
- [ ] Log in as an AGENT with `team = "HQ"` or NULL team → **all** projects visible (no crippling)
- [ ] Log in as ADMIN/MANAGER → all projects visible regardless of team
- [ ] Open a Dubai lead's project picker → suggested projects filtered to UAE first

### Off-shift round-robin

- [ ] Open `/admin/awaiting-team` → only agents currently **on shift** (per `Attendance` punch-in) are eligible for round-robin assignment
- [ ] Stop one agent's attendance manually (or have them punch out) → next lead skips them in the rotation
- [ ] If everyone is off-shift, fallback message appears ("No agents on shift — manual assignment required")

### Avatar fix

- [ ] Open `/team` → every agent row shows a photo OR initials avatar (no broken-image icon)
- [ ] Confirm `photoUrl` empty string and NULL both fall back to initials (test by clearing one in `/profile`)
- [ ] Agent's avatar color (`avatarColor`) matches their tailwind class

### Investor banner

- [ ] Open a lead where `categorization` contains "Investor" → **InvestorBanner** appears at the top of the lead detail with an "Investor — focus on yield" callout
- [ ] Open a lead NOT flagged as investor → banner does NOT appear

---

## Round 6 — CSV/Copy removed from leads, investor detection

### Leads list cleanup

- [ ] Open `/leads` → **no "Upload CSV" button** in the toolbar (intake-only; see Round 2)
- [ ] **No "Copy" / "Copy to clipboard" button** in the toolbar
- [ ] Bulk actions menu still has Email + WhatsApp (those stay)

### Investor detection (auto)

- [ ] Create a new lead with `whoIsClient` containing "investor", "rental yield", "ROI", or "portfolio" → after AI re-score runs, `categorization` is set to a value containing "Investor"
- [ ] Reload the lead → **InvestorBanner** appears (proving the auto-detection wired correctly through to UI)
- [ ] Without those keywords, lead does NOT get auto-tagged Investor

### Reports / health

- [ ] `/admin/health` page renders without error
- [ ] `/admin/cron-health` page renders → confirms cron jobs ran today (last 24h column non-empty)

---

## Cross-cutting checks (every deploy)

- [ ] **Login flow:** `/logout` → `/login` → log back in. Session cookie set, redirect to dashboard works.
- [ ] **Mobile:** load `/dashboard` on a phone (or DevTools mobile emulator) → no horizontal scroll, MobileShell tabs render
- [ ] **PWA install nudge** appears on first visit in supported browsers
- [ ] **Notifications:** open `/notifications` → page renders; if you have a Notification row, it displays
- [ ] **WhatsApp panel:** open a lead → `WhatsAppPanel` renders an outbound message draft box
- [ ] **AI Chat:** open `/ai` → "Ask the CRM" box renders; type a question → response or "AI not configured" message
- [ ] **Console:** open DevTools → no red errors on any of the surfaces above (yellow warnings OK)
- [ ] **Cron secret:** confirm `CRON_SECRET` env var is set in Vercel (check `/api/smoke` output)

---

## Smoke-test command

```
curl https://crm.whitecollarrealty.com/api/smoke
```

Expected when healthy:
```json
{ "ok": true, "checks": [ { "name": "db.lead.count", "ok": true, "durationMs": 12 }, ... ] }
```

When unhealthy:
```json
{ "ok": false, "failed": [ { "name": "...", "ok": false, "error": "..." } ], "checks": [...] }
```

Optional: pass `?token=$SMOKE_TOKEN` (or `Authorization: Bearer $SMOKE_TOKEN` header) if `SMOKE_TOKEN` is configured. Otherwise the endpoint requires a logged-in user.

## Rollback procedure

If anything goes red and you can't fix in 2 minutes:

```
git revert HEAD && git push
```

Vercel auto-deploys the previous commit (~60 seconds). Re-run the smoke command to confirm green. Then investigate the bad commit at leisure on a branch.
