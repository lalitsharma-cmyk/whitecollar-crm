# White Collar Realty CRM — Product Improvement Report

**Spec reference:** Master spec Section 11 (Product review & rollout plan).
**Author lens:** real-estate CRM product manager, writing for Lalit (owner/admin,
non-technical) ahead of letting four agents (Dubai: Mehak, Dinesh; India: Yasir,
Tanuj) onto the live app at `crm.whitecollarrealty.com`.
**Source audited:** working tree at commit `4f7308e` ("Round 12 + B-fix wave"), read-only.
**Grounding docs:** `docs/CRM_BUG_REPORT.md` and `docs/CRM_FULL_QA_REPORT.md`
(source of truth for per-item status after the B-01…B-20 fix wave).

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

Ordered by blocker severity. Items marked ✅ are **already done** and listed only
so they're not re-opened. The peer-data-leak blockers that were holding up rollout
are now **all closed** (Rounds 11–12 + B-fix wave, up to commit `4f7308e`).

| # | Fix | Status | Why it matters | Source / ref |
|---|-----|--------|----------------|--------------|
| 1 | **De-duplicate the same lead across India + Dubai.** Lalit's **#1 trust blocker** (QA Bucket A). | ⚠️ **PARTIAL — detection + admin merge live; on-intake guard + backfill pending** | Role-scoped "possible duplicate" warning on create **and** a working ADMIN Duplicate Detector + merge. Still to co-design: auto-merge/block on create/import + one-time historical-phone backfill. | `check-duplicate/route.ts` — role-scoped warning on `/leads/new`; **`/admin/duplicates` + `POST /api/admin/leads/merge`** merge a phone/email group into a chosen master (re-points all child records, audits each merge, then deletes the duplicate). **Intake auto-merge/block + historical backfill deferred to Lalit.** |
| 2 | **Agent↔agent permission leaks** (pipeline, team, leads `?owner=`, dashboard KPI tiles, dashboard by-salesperson, `/calls` list, properties matching, owner dropdown, WhatsApp tile, `Calls (mo)` label). | ✅ **ALL CLOSED** (Rounds 11–12, commits `4dd8ba1`, `1f30647`) | These were the rollout blockers. Agents now see only their own data on every surface. | `pipeline/page.tsx`; `team/page.tsx:26`; `leads/page.tsx:72-75`; `dashboard/page.tsx` (`meScope`/`meWaWhere`); `calls/page.tsx` (scoped `where`); `properties/[id]/page.tsx:34-36`; `LeadFilters.tsx` (owner dropdown hidden for agents). |
| 3 | **Enable AI in production.** `/ai` assistant + AI lead scoring are dormant because `ANTHROPIC_API_KEY` is not set in Vercel. Rule-based fallback runs instead. | ⚠️ **Pending — add key** | This is the single biggest "what's next" unlock for the team. Everything else is live; AI is the only gated capability. | `src/lib/ai.ts:30` — provider detection; add `ANTHROPIC_API_KEY` in Vercel → AI activates instantly, no code change needed. |
| 4 | **BANT stage-gating** — gate stage advancement on BANT completeness (Bucket B). | ⚠️ **Needs Lalit's co-design** | Non-blocking follow-up. The at-a-glance N/4 completeness pill is live; the hard gate needs the team to agree on rules first. | `leads/[id]/page.tsx` — `LeadScoreBreakdown` + BANT card with N/4 pill (`5aff9a3`). Stage-gating deliberately not enforced yet. |
| 5 | Vault privacy copy corrected (no more false "only you can see this"). | ✅ **DONE** | — | `VaultClient.tsx:5,265`; `admin/vault/page.tsx:60`. |
| 6 | Meeting scheduling capped at ≤7 days ahead. | ✅ **DONE** | QA Bucket F guardrail. | `src/app/api/leads/[id]/meeting/route.ts:37-40`. |

**Recommendation:** rollout is now reasonable. The peer-data-leak blockers are
closed. The three genuine follow-ups are: (a) Lalit co-designing the on-intake dedup
auto-merge/block + historical-phone backfill (the ADMIN Duplicate Detector +
merge already exists) and BANT stage-gating, and (b) adding `ANTHROPIC_API_KEY` to
Vercel to unlock AI. Neither blocks day-one use. Capture before/after of the
dashboard and a de-duped lead **(screenshot to be captured during live UAT)**.

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
   asks are **already implemented**: BANT green/red signals replace the old
   "why" free-text (`BuyingSignalsCard`), an at-a-glance **N/4 captured**
   completeness pill shows qualification status instantly, "Why this score"
   (`LeadScoreBreakdown`) surfaces the top contributing signals, Smart CMA v1
   (`SmartCMACard`) is on the page, "Who is client" is now an
   Investor/End-user/Both dropdown, Copy Snapshot + CSV removed, investor
   banner on new-lead (`InvestorBanner`). **Remaining UX work:** collapse the
   long right rail into tabs/accordions on mobile (the sticky tab bar is a good
   start), and make sure the *primary three* (next action, call/WhatsApp
   buttons, status) sit above the fold.
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
| **Intake & dedup** | Partial | Intake + round-robin + auto-dedupe exist (`leadIngest.ts`); a role-scoped "possible duplicate" warning fires on create and the ADMIN **Duplicate Detector + merge** (`/admin/duplicates`) cleans up existing dupes. Still open: an **auto-merge/block guard on create/import** (so the **same investor in both teams** can't slip in) + buyer-list verification (QA Bucket A). **This is the #1 workflow gap.** |
| **Hot-lead qualification** | Yes | AI score + green/red buying signals shown (`BuyingSignalsCard`) + "Why this score" top signals (`LeadScoreBreakdown`) now on lead detail. Cold→warm/hot scoring is rule-based in prod (AI dormant until `ANTHROPIC_API_KEY` added). |
| **Cold revival** | Partial | `/cold-calls` ("Revival Engine") + cooling report are agent-scoped. A per-lead "revive" action/engine on the lead itself is still thin (QA Bucket E: "revival engine — add to leads"). |
| **Manager escalation / reject** | Yes | `needsManagerReview`, `/admin/awaiting-team`, reject-with-reason, and **agent-side hide of LOST leads** are done (`leads/page.tsx:51-53`; `/admin/rejected-leads`). Solid. |
| **Site visit / meeting** | Yes | `SITE_VISIT` stage, `/admin/site-visits`, travel report, and the **≤7-day meeting guardrail** (`meeting/route.ts:37-40`) are in. Add a simple visit-prep checklist (units to show, docs). |
| **EOI → booking** | Partial | EOI stage/KYC/approval funnel exists (dashboard EOI tiles + `leads/page.tsx:87-90`). Smart CMA v1 (`SmartCMACard`) ships on lead detail. Bucket G asks to *define* EOI and CMA for users in plain English — add tooltips before exposing to new agents. |
| **Commission / payout** | Yes (admin) | Commission report is ADMIN/MANAGER (`reports/commission`). Fine. |

---

## 5. Features that are overcomplicated (simplify or rethink)

1. **Dashboard as a 15-card command center.** Powerful for Lalit, overwhelming
   for agents. Split by role (see §8–10).
2. **AI score explainability — now shipped.** "Why this score" (`LeadScoreBreakdown`) surfaces the top contributing signals on lead detail. In prod the breakdown is rule-based (AI dormant until the API key is added); the display is the same either way.
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
   Smart CMA v1 is live on lead detail; add an in-app definition tooltip before
   first-time agents encounter it.
4. **AI Assistant chat** (`/ai`) — keep, but don't front-load it; AI is dormant
   in prod until `ANTHROPIC_API_KEY` is added. Automations toggles now show
   real state (round-robin ON/OFF, auto-dedupe "Always on" — B-16 fixed).
5. **Source field everywhere for agents** — already enforced server-side
   (`leads/page.tsx:65`); owner dropdown in `LeadFilters` already hidden for
   agents (`components/LeadFilters.tsx` — B-13 fixed).
6. **Daily motivation pilot** (`☕ Daily motivation (pilot)`) — **now ON for
   both teams** (`motivationPilot.team=ALL`, `bfe636e`). Deterministic daily
   quote + optional browser voice; no AI call. Lalit can toggle it off at any
   time from **Settings → "☕ Daily motivation (pilot)"** if tone disappoints.
7. **Templates / Workflows / Audit / Integrations** — already admin-gated; just
   confirm agents never see the nav entries (they don't —
   `MobileShell.tsx:53-67` `adminOnly`).

---

## 7. Features to add later (post-rollout backlog)

1. **On-intake dedup auto-merge/block + historical-phone backfill** — the ADMIN
   Duplicate Detector + merge (`/admin/duplicates`) is already live; co-design
   with Lalit to decide the create/import rules, wire the auto-merge/block
   prompt, and run the one-time historical backfill (hardening of B-01).
2. **BANT stage-gating** — once Lalit and the team agree on which fields must
   be filled before a lead can advance, wire the gate (`leads/[id]` stage
   selector) to the N/4 completeness pill already on screen (B-17 structural
   half).
3. **Add `ANTHROPIC_API_KEY` to Vercel** — unlocks the full AI assistant and
   AI-driven scoring in one step; no code change required.
4. **Per-lead revival engine** with suggested re-engagement timing/templates
   (Bucket E).
5. **AI-driven cold→warm→hot transitions** replacing keyword rules (Bucket E) —
   activate after real data accumulates and the API key is in.
6. **Calendar filters on all reports**, CSV column trimming (Bucket D — back
   button is global in the shell; date pickers already on most reports).
7. **Voice/motivation expansion** (Bucket H) — pilot is on for both teams;
   extend to motivational recall of past wins once tone is validated in use.
8. **Visit-prep checklist** and **interested-properties → auto-CMA** linkage
   (builds on Smart CMA v1 already live).
9. **Offline write queue** for mobile logging (§3.5).

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

The CRM is ready for rollout. After the Round 11/12 fixes and the B-01…B-20 fix
wave, every agent↔agent data leak is closed — pipeline, calls, dashboard numbers,
lead filters, properties, and the owner dropdown all now show an agent only their
own work. **You can put the team on it now**, with three follow-up items to keep
in mind: (1) the de-duplication you flagged has a working "possible duplicate"
warning on new leads **and** an admin "Duplicate Detector" you can use to merge
any that slip through, but the automatic merge-on-import and the one-time
historical clean-up still need you to sign off on the rules — treat that as
week-one admin work; (2) AI features
(scoring, the chat assistant) are sitting dormant until the Anthropic API key is
added to Vercel — add it when you're ready and they switch on instantly; and
(3) the BANT stage-gating (making sure an agent fills in the qualification fields
before moving a lead forward) still needs us to agree on exactly which fields to
require — the at-a-glance pill is there, the hard gate is not. Neither of these
blocks day-one use. **The biggest favour you can do your first-time agents is to
give them less, not more**: a clean four-tile "my day", their leads, one-tap
call/WhatsApp, and a short action list — with the heavier forecasting, funnels,
and leaderboards saved for you and your managers until the team finds its feet.
