# White Collar Realty CRM — Product Improvement Report

**Spec reference:** Master spec Section 11 (Product review & rollout plan).
**Author lens:** real-estate CRM product manager, writing for Lalit (owner/admin,
non-technical) ahead of letting four agents (Dubai: Mehak, Dinesh; India: Yasir,
Tanuj) onto the live app at `crm.whitecollarrealty.com`.
**Source audited:** working tree at commit `4dd8ba1` ("Round 11"), read-only.
**Grounding docs:** `docs/QA-AUDIT-FINDINGS.md` (engineering risks) and
`docs/QA-FEEDBACK-2026-06-02.md` (Lalit's walk-through, "Bucket A–I").

Where the spec expects before/after screenshots, items are marked
**(screenshot to be captured during live UAT)**.

> **Context that shapes every recommendation:** these are **first-time CRM
> users** who are **competitors on the same sales floor**, selling **Dubai
> off-plan property to Indian investors**. The product is already feature-rich
> and the core path (open lead → call/WhatsApp → update status → see next
> action) is solid and correctly scoped post-Round-11. The risk now is **not
> missing features — it is overwhelm and trust.** Most of this report is about
> *removing, clarifying, and sequencing*, not building.

---

## 1. Immediate fixes before team rollout

Ordered by blocker severity. Items marked ✅ are **already done in `4dd8ba1`**
and listed only so they're not re-opened.

| # | Fix | Status | Why it blocks rollout | Source / ref |
|---|-----|--------|-----------------------|--------------|
| 1 | **De-duplicate the same lead across India + Dubai.** Lalit's **#1 blocker** (QA Bucket A): the identical investor appears in *both* team sections, and repeated phone/email show as separate leads. | ⚠️ **PARTIAL — must close** | A lead worked by two teams = double-dialling the same investor, internal conflict, and wrong pipeline counts. | Intake-time dedupe by phone+email fingerprint **exists** (`src/lib/leadIngest.ts:36-37,58-121` — bumps `duplicateCount`, keeps one record). **Gap:** it does not collapse *already-split* historical records, and a lead `forwardedTeam`-routed to both teams isn't merged. `/admin/duplicates` + `/api/admin/leads/merge` exist for manual cleanup but there's no automatic "one investor → one owner" guarantee on the existing 45 leads. **Action:** run a one-time merge pass on current data, and add a cross-team guard so a fingerprint can only live on one team. |
| 2 | **Last cross-visibility gap: dashboard KPI tiles are team-wide for agents.** | ⚠️ **OPEN (Round 12)** | Agents' headline numbers (Total clients, Hot, Ready to close) show the *whole team's* totals, contradicting "Agent → own only". Lower severity than the now-fixed leaks (counts only, no per-peer names) but still erodes the privacy promise on day one. | `src/app/(app)/dashboard/page.tsx:49,64-90` use `teamScope`, never `ownerId: me.id`. Fix: scope agent tiles to `leadScopeWhere(me)` like `/action-list:86`. See `CRM_ROLE_PERMISSION_MATRIX.md §3`. |
| 3 | **Correct the two mislabeled dashboard tiles.** "📞 Calls (mo)" actually shows *today's* count. | ⚠️ **Open, trivial** | Wrong labels erode trust fastest with new users (QA Bucket C). | `dashboard/page.tsx:632,640` render `value={callsToday}` under a "(mo)" title. Also `waToday` ignores the team filter (`:70`). |
| 4 | Agent↔agent permission leaks (pipeline, team, leads `?owner=`, dashboard by-salesperson, properties matching). | ✅ **DONE (Round 11)** | — | `pipeline/page.tsx:37`; `team/page.tsx:26`; `leads/page.tsx:72-75`; `dashboard/page.tsx:699-701`; `properties/[id]/page.tsx:34-36`. |
| 5 | Vault privacy copy corrected (no more false "only you can see this"). | ✅ **DONE** | — | `VaultClient.tsx:5,265`; `admin/vault/page.tsx:60`. |
| 6 | Meeting scheduling capped at ≤7 days ahead. | ✅ **DONE** | QA Bucket F asked for this guardrail. | `src/app/api/leads/[id]/meeting/route.ts:37-40` returns a clear error past 7 days. |

**Recommendation:** ship after closing items 1, 2, 3. Everything else can follow
in a fast second pass. Capture before/after of the dashboard and a de-duped lead
**(screenshot to be captured during live UAT)**.

---

## 2. UX simplification needed

The two densest screens are the dashboard (~15 cards) and lead detail (~20
sections). New users can't tell signal from noise.

1. **Thin the dashboard to ~4 agent tiles.** First-time agents need only: *My
   follow-ups due today, My hot leads, My overdue, My calls today.* Move
   forecasting, EOI funnel, by-salesperson, automations into a manager view or a
   collapsed "More" drawer. (QA Bucket C; QA-AUDIT §4.1.) Ground: dashboard
   renders the hero strip + KPI grid + forecast + by-salesperson + activity feed
   in one scroll (`dashboard/page.tsx`).
2. **Keep lead-detail lean — but credit what's done.** Bucket B's structural
   asks are **already implemented** in `4dd8ba1`: BANT green/red signals replace
   the old "why" free-text (`BuyingSignalsCard`, `leads/[id]/page.tsx:30,213-220`),
   Profession+Company merged into one cell (`:301-322`), Timeline present
   (`:378-380`), sticky note (`:102`), interested-units section (`:82`). **Remaining
   UX work:** collapse the long right rail into tabs/accordions on mobile (the
   sticky tab bar at `:405` is a good start), and make sure the *primary three*
   (next action, call/WhatsApp buttons, status) sit above the fold.
3. **Explain every derived widget inline.** Add one-line hover/empty-state copy
   for "Top-5 action list" logic, "Star of the month" criteria, "Stalled deals",
   "Sales floor live", "Cooling leads". New users distrust labels they can't
   decode (QA Buckets C & E).
4. **Make dead-ends clickable.** "Stalled deals" should link into `/pipeline`
   filtered to those leads (QA Bucket C). General principle: every number on the
   dashboard should be a link to the list behind it.
5. **Clarify ambiguous labels** beyond the buggy ones: "Complete" (= new +
   follow-up?), "Selling leads", the "investment" client tag (QA Bucket C).
   Prefer plain words over jargon for non-CRM-native users.

**(screenshot to be captured during live UAT)** — before/after of dashboard and
lead-detail density.

---

## 3. Mobile improvements

Agents will live in this on a phone between site visits. The shell already does a
lot right (`src/components/MobileShell.tsx`): bottom nav of the 5 core routes
(`:71-77`), global back button on non-root pages (`:107-108,194-202`),
safe-area insets for iPhone notch/home-indicator, body-scroll lock when the
drawer is open (`:114`), PWA install nudge (`:352`).

1. **Lead-detail tabs on mobile.** A 20-section page is a long thumb-scroll. Use
   the existing sticky tab bar (`leads/[id]/page.tsx:405`) to page between
   Overview / Timeline / Properties / Activity rather than stacking all cards.
2. **Bigger tap targets on inline-edit chips.** BANT/signal chips are dense;
   confirm ≥44px hit areas (the nav already uses `min-h-11`/`min-w-11`).
3. **One-tap call & WhatsApp from the lead card** in the list, not just the
   detail page — agents triage on the move. (Quick-add FAB already exists at
   `:334`.)
4. **Confirm dropdown/popup behaviour on mobile forms.** Lalit reported
   "popups/dropdowns distort the form" — the scroll-lock hook addresses the
   shell drawer; verify every modal opts into the same hook during UAT.
5. **Offline-tolerant logging.** Site visits happen in basements/lifts with no
   signal; queue "log call/visit" writes and retry. (inferred need; not in code.)

**(screenshot to be captured during live UAT)** — lead detail on a real phone.

---

## 4. Real-estate workflow gaps (vs. an ideal Dubai-off-plan motion)

| Stage | Built? | Gap to close |
|-------|--------|--------------|
| **Intake & dedup** | Partial | Intake + round-robin + auto-dedupe exist (`leadIngest.ts`). **Same investor in both teams** + buyer-list verification (verify phone/email/name before a lead becomes a "buyer", QA Bucket A) still open. **This is the #1 workflow gap.** |
| **Hot-lead qualification** | Yes | AI score + green/red buying signals now shown (`BuyingSignalsCard`). Remaining: surface a plain-English "why this is hot" line (the signals exist; add a one-sentence rollup). Cold→warm/hot is still partly keyword-driven, not fully AI (QA Bucket E). |
| **Cold revival** | Partial | `/cold-calls` ("Revival Engine") + cooling report are agent-scoped. A per-lead "revive" action/engine on the lead itself is still thin (QA Bucket E: "revival engine — add to leads"). |
| **Manager escalation / reject** | Yes | `needsManagerReview`, `/admin/awaiting-team`, reject-with-reason, and **agent-side hide of LOST leads** are done (`leads/page.tsx:51-53`; `/admin/rejected-leads`). Solid. |
| **Site visit / meeting** | Yes | `SITE_VISIT` stage, `/admin/site-visits`, travel report, and the **≤7-day meeting guardrail** (`meeting/route.ts:37-40`) are in. Add a simple visit-prep checklist (units to show, docs). |
| **EOI → booking** | Partial | EOI stage/KYC/approval funnel exists (dashboard EOI tiles + `leads/page.tsx:87-90`). Bucket G asks to *define* EOI and Smart CMA for users — these are unlabeled jargon today. Add definitions before exposing. |
| **Commission / payout** | Yes (admin) | Commission report is ADMIN/MANAGER (`reports/commission`). Fine. |

---

## 5. Features that are overcomplicated (simplify or rethink)

1. **Dashboard as a 15-card command center.** Powerful for Lalit, overwhelming
   for agents. Split by role (see §8–10).
2. **AI score without a human-readable reason.** The green/red signals exist now,
   but the underlying score is still a black box label; pair the score with the
   2–3 signals that drove it so agents trust it (extends Bucket E).
3. **EOI / Smart CMA / "Buying signal" jargon.** These ship as labels with no
   in-app definition (QA Buckets E & G). Either add a tooltip definition or hide
   until trained.
4. **Reports surface (10+ report types).** Agents need ~3 (my daily, my SLA, my
   cooling). The confidential set (commission, sources, team comparison, YTD) is
   correctly admin/manager-gated already — but even the index is busy. Give
   agents a stripped 3-report view.
5. **Quality / "quality of an agent's day" metric** (QA Bucket I) — undefined
   (hours? dates? week/month?). Don't expose a score whose definition the team
   can't state.

---

## 6. Features to hide initially (turn on after the team is comfortable)

Hide these from the **agent** experience for the first few weeks; keep them for
admin/manager. None require deletion — most are nav/section toggles.

1. **Forecasting & EOI funnel tiles** on the dashboard (manager concepts).
2. **Leaderboards** *visible but de-emphasised* — gamification can demotivate
   nervous first-timers; keep it (it's peer-visible by design,
   `leaderboards/page.tsx:89`) but don't make it the landing surface.
3. **Smart CMA / EOI advanced flows** until defined and trained (Bucket G).
4. **AI Assistant chat** (`/ai`) — keep, but don't front-load it; the automations
   "ON" chips there are currently hardcoded/cosmetic (QA P2-4) and can mislead
   during setup.
5. **Source field everywhere for agents** — already enforced server-side
   (`leads/page.tsx:65`); also hide the residual owner dropdown in
   `LeadFilters` for agents for polish (`components/LeadFilters.tsx:73-77`).
6. **Templates / Workflows / Audit / Integrations** — already admin-gated; just
   confirm agents never see the nav entries (they don't —
   `MobileShell.tsx:53-67` `adminOnly`).

---

## 7. Features to add later (post-rollout backlog)

1. **Automatic cross-team duplicate prevention** + a periodic dedupe sweep
   (hardening of Bucket A beyond the one-time merge).
2. **Per-lead revival engine** with suggested re-engagement timing/templates
   (Bucket E).
3. **AI-driven cold→warm→hot transitions** replacing keyword rules (Bucket E).
4. **Calendar filters + back button on all reports**, remove print, CSV without
   the agents column (Bucket D — partly addressed: back button is global in the
   shell; date pickers and CSV column trimming still pending).
5. **Best-time-to-call in correct IST 12-hour format** (Bucket D flagged AM/PM /
   timezone wrong).
6. **Motivation-from-history & voice capture** (Bucket H) — Vault voice input
   exists (`VaultVoiceInput`); extend to motivational recall of past wins.
7. **Visit-prep checklist** and **interested-properties → auto-CMA** linkage.
8. **Offline write queue** for mobile logging (§3.5).
9. **Loading skeletons / error boundaries** on heavy pages (`/pipeline`,
   `/reports/*`, `/team`) — only 3 `loading.tsx` and 1 `error.tsx` today
   (QA P2-5). Polish, not a blocker.

---

## 8. What should come FIRST for agents

The agent's whole job is: **work my leads today.** Give them, in this order:

1. **A clean "My Day" landing** — *follow-ups due, my hot leads, my overdue, my
   calls today* (4 tiles, scoped to `ownerId: me.id` — close §1 item 2 first).
2. **Leads list + lead detail** — already strong and correctly scoped
   (`leadScopeWhere`). This is their home base.
3. **One-tap call / WhatsApp + status update + next action** on the lead.
4. **Action List** (`/action-list`) — "what to do next", already agent-scoped
   (`:86`). Make this a primary nav anchor (it already is, with the "HOT" tag).
5. **My 3 reports** (daily, SLA, cooling) — agent-scoped, no peer pickers.

Defer: forecasting, by-salesperson, EOI funnel, leaderboard-as-landing,
templates, AI chat.

---

## 9. What should come first for MANAGERS

Managers (recursive report tree via `visibleOwnerIds`,
`leadScope.ts:28-41`) need oversight without admin clutter:

1. **Team view** (`/team`) — call counts, pipeline value, response times across
   their reports (now correctly gated `requireRole("ADMIN","MANAGER")`,
   `team/page.tsx:26`).
2. **Awaiting-team inbox** (`/admin/awaiting-team`) — assign incoming leads;
   surfaced in their nav with a live badge (`MobileShell.tsx:50,148`).
3. **Dashboard with team toggle** + by-salesperson breakdown (already gated
   `isAdminOrMgr`, `dashboard/page.tsx:699-701`).
4. **Reassign** leads across their tree (`/api/leads/[id]/assign`,
   `requireRole("ADMIN","MANAGER")`).
5. **Manager reports**: team comparison, sources, commission, cooling (all
   ADMIN/MANAGER-gated).
6. **Quality / team-mood** (aggregate; wellbeing column hidden from managers,
   `admin/quality/page.tsx:67`).

Defer for managers: workflows, integrations, audit, org targets (admin-only).

---

## 10. What should come first for ADMIN (Lalit)

Lalit runs the floor and is non-technical; lead with control + visibility:

1. **Full dashboard** (all teams, `?team=all`) with forecasting and EOI funnel.
2. **Intake control** — CSV / Google Sheet / WhatsApp / pre-assigned importers
   (`intake/page.tsx:13,20`), and the **duplicates merge** tool
   (`/admin/duplicates`) to fix Bucket A.
3. **Team & roles** — create users, set managers, Acefone/WhatsApp numbers,
   specializations (`team/page.tsx:92-93`).
4. **Targets** (`/admin/targets`) and **attendance** (`/admin/attendance`).
5. **CSV export** (admin-only, audited + watermarked,
   `reports/export/route.ts:3,8-10`) and confidential reports.
6. **Audit log** (`/admin/audit`), **system health**, **integrations**,
   **workflows/automations**, **Vault (team) oversight** (`/admin/vault`).

These are all built and correctly admin-gated; the work is *sequencing the
onboarding*, not building.

---

## 11. What to postpone (explicitly out of the initial rollout)

1. **AI-driven scoring overhaul** — keep the current rule-based score + signals;
   replace later (Bucket E).
2. **Smart CMA & advanced EOI flows** — until defined and trained (Bucket G).
3. **Full report-suite polish** (calendar filters, CSV column trimming, best-time
   IST fix) — Bucket D; non-blocking.
4. **Gamification depth** (leaderboard tuning, "Star of the month" criteria) —
   keep visible, refine later (Bucket C).
5. **Voice/motivation expansion** (Bucket H) beyond the existing Vault voice
   input.
6. **Perf hardening / N+1 cleanup & loading skeletons** (QA P2-5/P2-6) — fine at
   45 leads; revisit before scale.
7. **Hardcoded "automations ON" chip** correctness on `/ai` (QA P2-4) — cosmetic;
   fix when automations config is finalised.

---

## Plain-English summary for Lalit

The CRM is close. The day-to-day path your agents use most works well and, after
Round 11, the privacy between agents is almost completely fixed — pipeline, the
team page, lead filters, and property matching all now show an agent only their
own work. **Three things stand between you and rollout:** (1) finish the
de-duplication you flagged — make sure one investor is one record on one team,
including the leads already in the system; (2) close the last small leak where an
agent's dashboard headline numbers still show the *whole team's* totals; and
(3) fix two mislabeled dashboard tiles. After that, **the biggest favour you can
do your first-time agents is to give them less, not more**: a clean four-tile "my
day", their leads, one-tap call/WhatsApp, and a short action list — with the
heavier forecasting, funnels, and leaderboards saved for you and your managers
until the team finds its feet.
