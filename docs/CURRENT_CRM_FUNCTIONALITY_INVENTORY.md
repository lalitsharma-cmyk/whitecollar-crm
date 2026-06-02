# White Collar Realty CRM — Current Functionality Inventory

> **Audit basis.** This inventory was produced by reading the application
> source directly (the live app is login-gated, so click-through screenshots
> could not be captured). Every claim cites a real file path under
> `src/`. Anything not directly provable from code is marked
> **(inferred from code)**. Where the spec expects a screenshot, it reads
> **(screenshot to be captured during live UAT)**.
>
> **Stack.** Next.js 16.2.6 App Router · React 19.2.4 · Prisma 6.19.3 ·
> PostgreSQL (Neon) · custom cookie-session auth (bcryptjs + signed session,
> **not** next-auth despite the dependency being present). All `(app)` pages
> are server components rendered `force-dynamic`.
>
> **Roles.** `ADMIN`, `MANAGER`, `AGENT`. Auth helpers in `src/lib/auth.ts`:
> `requireUser()` (redirect `/login` if signed out), `requireRole(...roles)`
> (redirect `/dashboard` if role not allowed), `getCurrentUser()`.
> Ownership scoping in `src/lib/leadScope.ts`: ADMIN → all leads;
> MANAGER → self + recursive direct/indirect reports (Postgres `RECURSIVE`
> CTE); AGENT → own leads only. Helpers: `visibleOwnerIds()`,
> `leadScopeWhere()`, `canTouchLead()`, `loadOwnedLead()`.
>
> **Teams.** "Dubai" and "India" (`Lead.forwardedTeam` / `User.team`).
> Office hours 10:00–19:00 IST, Mon–Sat. Money is always tracked as a
> dual AED/INR pair and **never** summed across currencies (`fmtMoneyDual`,
> `src/lib/money.ts`).
>
> **Date.** Generated 2026-06-02. Reflects post-Round-11 source state
> (permission-leak fixes landed). **One known open item — Round 12 — is NOT
> fixed:** the dashboard's AGENT KPI count tiles still use team-wide scope
> (see §3.1 Dashboard).

---

## §3.1 Page-by-page inventory

Pages live under `src/app/(app)/…/page.tsx` unless noted. Readiness legend:
**Production-ready** · **Partially ready** · **Placeholder**.

---

### `/dashboard` — Home / KPI cockpit
- **File:** `src/app/(app)/dashboard/page.tsx`
- **Purpose:** Role-aware landing page. KPI tiles, today's action surface, pipeline snapshot, and (for admin/manager) a per-salesperson breakdown.
- **Current functionality:** `requireUser()`; computes IST day/week boundaries; KPI count tiles (calls, follow-ups, etc.), pipeline-by-stage, "By salesperson" table. Numerous server-side aggregations.
- **Buttons / actions:** Navigation into leads/activities; quick links to action surfaces.
- **Forms / dropdowns:** None of note (read dashboard).
- **Role access:** All roles (`requireUser`). "By salesperson" block is gated to ADMIN/MANAGER (confirmed: gated at line ~699).
- **Current UX issues:** (screenshot to be captured during live UAT).
- **Mobile issues:** Dense tile grid; verify wrap on small screens (screenshot to be captured during live UAT).
- **Missing / known-broken:** **Round 12 OPEN — NOT FIXED:** the AGENT KPI count tiles use `teamScope` rather than `ownerId: me.id` (lines ~49, ~64–90), so an agent sees team-wide counts on those tiles instead of their own. Tracked, not yet patched.
- **Readiness:** Partially ready (functional, but the Round 12 agent-scope leak should be closed before agent-facing rollout).

---

### `/leads` — Lead list / pipeline table
- **File:** `src/app/(app)/leads/page.tsx`
- **Purpose:** Master searchable/filterable lead list.
- **Current functionality:** Server-rendered table with filters; ownership-scoped via `leadScopeWhere()`.
- **Buttons / actions:** Row → `/leads/[id]`; "+ New lead"; filter chips.
- **Forms / dropdowns:** Status/owner/source filters via `searchParams`.
- **Role access:** All roles; **scoping enforced** — `?owner=` and `?source=` filters are gated (Round 11 fix), and `LOST` leads are hidden from agents.
- **Current UX issues:** (screenshot to be captured during live UAT).
- **Mobile issues:** Wide table → horizontal scroll (inferred from code; `min-w` table pattern used across the app).
- **Missing / expected:** —
- **Readiness:** Production-ready.

---

### `/leads/new` — Create lead
- **File:** `src/app/(app)/leads/new/page.tsx`
- **Purpose:** Full Dubai-depth lead intake.
- **Current functionality:** `requireUser()`; server action `createLeadAction` → `ingestLead`; IST follow-up parse via `fromISTLocalInput`. Sections: Identity / Requirement / Qualification / "Who is the client" free-text / Action.
- **Buttons / actions:** Submit (create + optional first follow-up).
- **Forms / dropdowns:** `PhoneInput`, `BudgetInput`, `FormDateTimeIST`; enums LeadSource, Potential, FundReadiness, MoodStatus, InvestTimeline, Profession.
- **Role access:** All roles (`requireUser`).
- **Current UX issues:** Long single-column form (screenshot to be captured during live UAT).
- **Mobile issues:** Many fields; verify input zoom/keyboard behaviour on mobile (screenshot to be captured during live UAT).
- **Missing / expected:** —
- **Readiness:** Production-ready.

---

### `/leads/[id]` — Lead detail / timeline
- **File:** `src/app/(app)/leads/[id]/page.tsx`
- **Purpose:** Single-lead workspace — full profile, activity timeline, call/WhatsApp/follow-up actions, stage controls.
- **Current functionality:** `canTouchLead()` ownership guard; ~20 cards (identity, requirement, qualification, timeline, calls, follow-ups, etc.).
- **Buttons / actions:** Call via Acefone, WhatsApp draft, log activity, schedule follow-up, change stage, reassign (role-permitting).
- **Forms / dropdowns:** Inline editors for stage/owner/fields.
- **Role access:** All roles, but a non-owning AGENT is blocked by `canTouchLead()`.
- **Current UX issues:** Very dense; many cards (screenshot to be captured during live UAT).
- **Mobile issues:** Long scroll; action buttons should remain reachable (screenshot to be captured during live UAT).
- **Missing / expected:** —
- **Readiness:** Production-ready.

---

### `/pipeline` — Kanban / stage board
- **File:** `src/app/(app)/pipeline/page.tsx`
- **Purpose:** Visual pipeline by stage.
- **Current functionality:** Ownership-scoped via `leadScopeWhere()` (Round 11 fix); columns per `LeadStatus`.
- **Buttons / actions:** Stage move; open lead.
- **Role access:** All roles; agents see only their own cards.
- **Current UX issues / Mobile:** Kanban columns on a narrow screen need horizontal scroll (screenshot to be captured during live UAT).
- **Readiness:** Production-ready.

---

### `/properties` — Project / inventory list
- **File:** `src/app/(app)/properties/page.tsx`
- **Purpose:** Property/project catalogue with best-match leads.
- **Current functionality:** `bestLeadsForProject` is ownership-scoped (Round 11 fix).
- **Role access:** All roles; lead-matching respects scope.
- **Readiness:** Production-ready. (screenshot to be captured during live UAT)

---

### `/properties/new` and `/properties/[id]`
- **Files:** `src/app/(app)/properties/new/page.tsx`, `src/app/(app)/properties/[id]/page.tsx`
- **Purpose:** Create / view a project. **(inferred from code — not separately re-read this pass; characterised by analogy to the properties list and the create-form pattern.)**
- **Readiness:** Partially ready (verify during live UAT).

---

### `/activities` — "Action Board"
- **File:** `src/app/(app)/activities/page.tsx`
- **Purpose:** The "what do I do right now" surface.
- **Current functionality:** `requireUser()`; `scope = me.role==="AGENT" ? {ownerId:me.id} : {}`; IST day boundaries; Top-5 plus six sections — Immediate, Hot (24h), Slipping (>5d), Site Visits (7d), Scheduled Today, Potential Closures. Per-row Call/WA buttons.
- **Role access:** All roles; AGENT scoped to own leads.
- **Readiness:** Production-ready.

---

### `/action-list` — Prioritised call list
- **File:** `src/app/(app)/action-list/page.tsx`
- **Purpose:** Ordered worklist of who to contact next.
- **Readiness:** Production-ready (read earlier; ownership-aware). (screenshot to be captured during live UAT)

---

### `/intake` — Quick capture
- **File:** `src/app/(app)/intake/page.tsx`
- **Purpose:** Fast lead capture surface.
- **Readiness:** Production-ready.

---

### `/cold-calls` — Revival Engine (cold-data working surface)
- **File:** `src/app/(app)/cold-calls/page.tsx`
- **Purpose:** Work old / cold data — the "Revival Engine".
- **Current functionality:** Surfaces cold leads for re-engagement; session flow at `/cold-calls/session`.
- **Readiness:** Production-ready (revival list + session). (screenshot to be captured during live UAT)

---

### `/cold-calls/session` — Cold-calling session
- **File:** `src/app/(app)/cold-calls/session/page.tsx`
- **Purpose:** Guided run through a batch of cold leads.
- **Readiness:** Partially ready — **(inferred from code; not separately re-read this pass.)**

---

### `/calls` — Call Records
- **File:** `src/app/(app)/calls/page.tsx`
- **Purpose:** Call history + connect-rate analytics.
- **Current functionality:** `requireUser()`; connect-rate-by-hour IST heatmap (agent-scoped raw SQL: `userId = me.id` for agents, all otherwise); per-call quality scoring (+50 connected/interested, +20 ≥60s, +10 ≥180s, +20 note via `QualityList`); `CallsClient`.
- **Role access:** All roles.
- **Current UX issues / known leak:** **(inferred from code)** the recent-calls `findMany` (line ~67) has **no role scope**, so all roles see the latest 50 calls team-wide. Minor competitive-data leak; the heatmap above it *is* scoped. Worth tightening, though the Round 11 remit explicitly scoped edits elsewhere.
- **Readiness:** Partially ready (the unscoped recent-calls list is the one caveat).

---

### `/leaderboards` — Public rankings
- **File:** `src/app/(app)/leaderboards/page.tsx`
- **Purpose:** Gamified team rankings.
- **Current functionality:** `requireUser()` (all roles, intentionally public-within-company); six boards — Most calls, Fastest response (DISTINCT-ON first-call raw SQL), Most follow-ups, Highest connect rate (min 5 calls), Cold-to-warm, Most consistent (dailyStreak). Range today/week/month; gold/silver/bronze top-3.
- **Role access:** All roles.
- **Readiness:** Production-ready.

---

### `/profile` — My profile & stats
- **File:** `src/app/(app)/profile/page.tsx`
- **Purpose:** The agent's own stats + account.
- **Current functionality:** `requireUser()`; **own stats only** (`ownerId: me.id`); `XPBar`, 3 streak tiles, this-month stats, badges grid (`BADGES` from `@/lib/gamification`), `ProfilePasswordChange`.
- **Role access:** All roles (self only).
- **Readiness:** Production-ready.

---

### `/notifications` — Notification centre
- **File:** `src/app/(app)/notifications/page.tsx`
- **Purpose:** In-app notifications.
- **Current functionality:** `requireUser()`; own notifications; snooze handling; `NotificationsClient`.
- **Role access:** All roles (self only).
- **Readiness:** Production-ready.

---

### `/settings` — Personal + system settings
- **File:** `src/app/(app)/settings/page.tsx`
- **Purpose:** Personal prefs + admin system toggles.
- **Current functionality:** `requireUser()`; Testing-mode master kill-switch (admin), round-robin toggle, travel rate ₹/km, speed-to-lead, festival theme (admin), ICS calendar subscription (`buildIcsUrl`, HMAC with `NEXTAUTH_SECRET`), `TestPushButton`, `NotifPrefsEditor`, onboarding-tour reset.
- **Role access:** All roles for personal prefs; admin-only toggles guarded inline.
- **Current UX issues — STALE COPY:** read-only card (line ~260) still says the pipeline ends "Won/Lost"; line ~262 reads "AI provider: Anthropic Claude (set ANTHROPIC_API_KEY in .env)". Cosmetic / informational only.
- **Readiness:** Production-ready (with two stale copy strings noted above).

---

### `/ai` — AI assistant
- **File:** `src/app/(app)/ai/page.tsx`
- **Purpose:** Natural-language assistant over CRM data.
- **Current functionality:** `AIChat` client; backed by Anthropic (`ANTHROPIC_API_KEY`) with a rule-based fallback when no key is set. Gemini path was abandoned.
- **Buttons / actions:** Chat input / send.
- **Current UX issues — STALE COPY:** hardcoded "Automations active" string (tracked as P2-4).
- **Role access:** All roles (per permission matrix, "Use AI assistant" = Admin/Manager/Agent all ✅).
- **Readiness:** Partially ready — **depends on `ANTHROPIC_API_KEY`**; without it, responses fall back to rule-based (degraded, not broken).

---

### `/vault` — Private agent vault
- **File:** `src/app/(app)/vault/page.tsx`
- **Purpose:** Each agent's private notes/credentials store.
- **Current functionality:** `requireUser()`; strictly `userId`-scoped (each user sees only their own entries).
- **Role access:** All roles, self only.
- **Privacy contradiction (documented):** `/admin/vault` (below) intentionally exposes **all** agents' vault content to admins — an owner (Lalit) decision that overrides the "private-per-user" framing here. Flagged in `docs/QA-AUDIT-FINDINGS.md` as a copy/expectation contradiction to reconcile.
- **Readiness:** Production-ready (resolve the privacy copy vs. `/admin/vault` exposure before telling agents it's "private").

---

### `/help` — In-app training guide
- **File:** `src/app/(app)/help/page.tsx`
- **Purpose:** Friendly self-serve help.
- **Current functionality:** `requireUser()`; sticky TOC, keyboard-shortcut table, FAQ, contact lalit@whitecollarrealty.com.
- **Readiness:** Production-ready.

---

## Reports

### `/reports` — Reports hub
- **File:** `src/app/(app)/reports/page.tsx`
- **Purpose:** Index of all report pages.
- **Readiness:** Production-ready (navigation hub).

### `/reports/daily` — Daily activity report
- **File:** `src/app/(app)/reports/daily/page.tsx`
- **Purpose:** Mirrors Lalit's manual daily sheet (7 metrics: Target / Achieved / Pending / %).
- **Current functionality:** `requireUser()`; AGENT sees self, ADMIN/MANAGER pick `?agent=`; targets pulled from `/admin/targets`; PDF download (admin/manager only) via `/api/reports/daily/pdf`; native date picker + prev/next.
- **Role access:** All roles (self-scoped for agents); PDF gated to admin/manager.
- **Readiness:** Production-ready.

### `/reports/sla` — SLA & Meeting report
- **File:** `src/app/(app)/reports/sla/page.tsx`
- **Purpose:** Site visits / office / virtual meetings — scheduled, completed, no-show, rescheduled, who attended.
- **Current functionality:** `requireUser()`; AGENT scoped to self (`agentScope = me.id`), per-agent table hidden from agents; dual-block current-vs-prior period; `ReportDateRangePicker` (`?from=&to=`, default this-month).
- **Role access:** All roles; agent self-scoped.
- **Readiness:** Production-ready.

### `/reports/sources` — Lead source breakdown
- **File:** `src/app/(app)/reports/sources/page.tsx`
- **Purpose:** Which sources convert (full funnel + avg first-call mins + avg AI score per source).
- **Current functionality:** `requireRole("ADMIN","MANAGER")`; five Prisma `groupBy` + one raw SQL (first-call latency); best/worst summary tiles; `?from=&to=` with legacy `?range=` accepted one release.
- **Role access:** ADMIN/MANAGER only.
- **Readiness:** Production-ready.

### `/reports/ytd` — Year-to-Date
- **File:** `src/app/(app)/reports/ytd/page.tsx`
- **Purpose:** Dubai vs India side-by-side YTD (9 metrics each).
- **Current functionality:** `requireRole("ADMIN","MANAGER")`; team split via `Lead.forwardedTeam`; AED + INR tracked separately and **never summed**; default Jan-1→today, `?from=&to=` override.
- **Role access:** ADMIN/MANAGER only.
- **Readiness:** Production-ready.

### `/reports/team-comparison` — Dubai vs India head-to-head
- **File:** `src/app/(app)/reports/team-comparison/page.tsx`
- **Purpose:** Weighted composite team contest.
- **Current functionality:** `requireRole("ADMIN","MANAGER")`; `ReportDateRangePicker` (`?from=&to=`, legacy `?range=`); composite winner = bookings 50% + pipeline 30% + connect 20%; never sums AED+INR; team = `Lead.forwardedTeam`.
- **Role access:** ADMIN/MANAGER only.
- **Readiness:** Production-ready.

### `/reports/commission` — Commission / earnings
- **File:** `src/app/(app)/reports/commission/page.tsx`
- **Purpose:** Commission tracking and earnings.
- **Current functionality:** `requireRole("ADMIN","MANAGER")`; `fmtMoneyDual`; status PENDING / INVOICED / RECEIVED; per-agent + per-booking detail; period keyed bookingDoneAt → commissionReceivedAt → updatedAt.
- **Note:** `commissionAmount` is stored whole-currency (not smallest unit, despite a schema comment) **(inferred from code)**.
- **Role access:** ADMIN/MANAGER only.
- **Readiness:** Production-ready.

### `/reports/travel` — Travel reimbursement
- **File:** `src/app/(app)/reports/travel/page.tsx`
- **Purpose:** Per-agent distance + reimbursement (₹/km rate from Settings).
- **Current functionality:** `requireUser()`; AGENT scoped to self; dual-block period compare; `getTravelRatePerKmInr()`; `?from=&to=`.
- **Role access:** All roles; agent self-scoped.
- **Readiness:** Production-ready.

### `/reports/cooling` — Cooling leads
- **File:** `src/app/(app)/reports/cooling/page.tsx`
- **Purpose:** "Save the deal" — HOT leads recently downgraded to WARM/COLD.
- **Current functionality:** `requireUser()`; AGENT scoped (`scopedOwnerId = me.id`, passed as a parameter into raw SQL — no interpolation); detects `STATUS_CHANGE` activities titled "(HOT → WARM/COLD)"; excludes anything re-promoted to HOT; `?from=&to=` (default 14d).
- **Role access:** All roles; agent self-scoped.
- **Readiness:** Production-ready.

---

## Admin pages (`/admin/*`)

### `/admin/integrations`
- **File:** `src/app/(app)/admin/integrations/page.tsx`
- **Purpose:** At-a-glance health of every integration.
- **Current functionality:** `requireRole("ADMIN")`; env-presence + DB counts only (no outbound calls); 6 StatusCards — Push/VAPID, Acefone, Resend, WhatsApp (wa.me always green), Cron health vs an 8-cron `EXPECTED_CRONS` catalogue, Neon DB ping.
- **Role access:** ADMIN only.
- **Readiness:** Production-ready.

### `/admin/workflows` (+ `/admin/workflows/[id]/runs`)
- **Files:** `src/app/(app)/admin/workflows/page.tsx`, `…/[id]/runs/page.tsx`
- **Purpose:** Zoho-style IF/THEN automation builder + run history.
- **Current functionality:** `requireRole("ADMIN")`; `WorkflowBuilderPanel`; perf widget (24h runs, success %, hot loops ≥10/24h, idle workflows 0-runs-7d). Run-history sub-page per workflow **(inferred from code; not separately re-read this pass)**.
- **Role access:** ADMIN only.
- **Readiness:** Production-ready (builder + perf); runs sub-page verify during UAT.

### `/admin/templates`
- **File:** `src/app/(app)/admin/templates/page.tsx`
- **Purpose:** WhatsApp + Email template library.
- **Current functionality:** `requireRole("ADMIN","MANAGER")`; derived tone chips, best-use pill, send/reply stats, score = sends×10 + replies×50, `{{placeholder}}` cheat-sheet, `TemplateEditor` / `TemplatePreview`.
- **Role access:** ADMIN/MANAGER.
- **Readiness:** Production-ready (the templates these create only *send for real* once WhatsApp Cloud API keys are live — see §3.3).

### `/admin/attendance`
- **File:** `src/app/(app)/admin/attendance/page.tsx`
- **Purpose:** 14-day attendance grid.
- **Current functionality:** `requireRole("ADMIN")`; auto-marked on login (PRESENT before 10:30 IST, LATE after); only PRESENT/LATE enter round-robin; `AttendanceCellEditor` override.
- **Role access:** ADMIN only.
- **Readiness:** Production-ready.

### `/admin/audit`
- **File:** `src/app/(app)/admin/audit/page.tsx`
- **Purpose:** Append-only audit trail.
- **Current functionality:** `requireRole("ADMIN")`; last 1000 entries; category colour chips; IP/meta; `AuditUserFilter`.
- **Role access:** ADMIN only.
- **Readiness:** Production-ready.

### `/admin/targets`
- **File:** `src/app/(app)/admin/targets/page.tsx`
- **Purpose:** Per-agent daily targets.
- **Current functionality:** `requireRole("ADMIN")`; 8 `TargetMetric` (CALLS, CONNECTED_CALLS, VIRTUAL_MEETINGS, F2F_MEETINGS, FRESH_CLIENTS, DEALS_CLOSED, REVENUE_AED, REVENUE_INR). Feeds `/reports/daily`.
- **Role access:** ADMIN only.
- **Readiness:** Production-ready.

### `/admin/duplicates`
- **File:** `src/app/(app)/admin/duplicates/page.tsx`
- **Purpose:** Find & merge duplicate leads.
- **Current functionality:** `requireRole("ADMIN")`; phone (last-10-digit) + email (lowercased) dup groups via raw SQL; `DuplicatesMergeClient` merges into a chosen master.
- **Role access:** ADMIN only.
- **Readiness:** Production-ready.

### `/admin/quality`
- **File:** `src/app/(app)/admin/quality/page.tsx`
- **Purpose:** Quality Score leaderboard.
- **Current functionality:** `requireRole("ADMIN","MANAGER")`; `computeQualityScores` (`@/lib/qualityScore`) — Activity 30% + Funnel 35% + Behavioural 25% + Wellbeing 10%; MANAGER view **hides the Wellbeing column** and is scoped to direct reports + self (`OR:[{id:me.id},{managerId:me.id}]`); window today/week/month; team filter Dubai/India.
- **Role access:** ADMIN (full) / MANAGER (reduced + scoped).
- **Note:** This page **implements** `docs/SPEC-quality-score.md` — that spec should now be considered **BUILT**, not a proposal.
- **Readiness:** Production-ready.

### `/admin/team-mood`
- **File:** `src/app/(app)/admin/team-mood/page.tsx`
- **Purpose:** Anonymous team-wellbeing insight (spec §10.6).
- **Current functionality:** `requireRole("ADMIN","MANAGER")`; burnout gauge (≥3 low-mood days/7d), team pressure index, 30-day mood SVG, reset-mode adoption, "agents needing support" (first names only). **Explicitly never selects `VaultEntry.content`.**
- **Role access:** ADMIN/MANAGER.
- **Readiness:** Production-ready.

### `/admin/vault`
- **File:** `src/app/(app)/admin/vault/page.tsx`
- **Purpose:** Admin oversight of agent vaults.
- **Current functionality:** `requireRole("ADMIN")`; **intentionally shows full agent vault content** for oversight (owner Lalit decision; comment notes it "overrides the original private-per-user design of /vault"). Filter by agent / kind.
- **Role access:** ADMIN only.
- **Privacy contradiction:** This is the documented contradiction with `/vault`'s "private" framing (see `/vault` above and `docs/QA-AUDIT-FINDINGS.md`).
- **Readiness:** Production-ready (resolve the privacy messaging before launch).

### `/admin/site-visits`
- **File:** `src/app/(app)/admin/site-visits/page.tsx`
- **Purpose:** Live agent location during site visits (built because Lalit asked "where can admin see live location of agent on a site visit").
- **Current functionality:** `requireRole("ADMIN")`; LIVE (startedAt set, endedAt null) + RECENT 50 SITE_VISIT; GPS captured at start / every 60s / end into `Activity.locationTrack`; Google Maps deep-links; `LiveVisitsAutoRefresh` 30s.
- **Role access:** ADMIN only.
- **Readiness:** Production-ready. **Depends on agent device granting GPS permission** (inferred dependency).

### `/admin/health` (+ `/admin/cron-health`)
- **Files:** `src/app/(app)/admin/health/page.tsx`, `…/cron-health/page.tsx`
- **Purpose:** System health dashboards.
- **Current functionality:** `requireRole("ADMIN")`; DB row counts + 24h activity + push/auth signals (cheap COUNTs); link to `/admin/cron-health` (per-cron last-run status) **(cron-health sub-page inferred from code; not separately re-read this pass)**.
- **Role access:** ADMIN only.
- **Readiness:** Production-ready.

### `/admin/rejected-leads`
- **File:** `src/app/(app)/admin/rejected-leads/page.tsx`
- **Purpose:** Structured rejection analytics.
- **Current functionality:** `requireUser()` + manual ADMIN/MANAGER redirect; `status = LOST` + `rejectionReason` not null; 6 reasons (FUND_ISSUE, WAR_FEAR, LOW_BUDGET, LOOK_AFTER_2_YEARS, WAITING_FOR_PROPERTY_SALE, OTHER); reason-breakdown filter chips.
- **Role access:** ADMIN/MANAGER (manual redirect).
- **Readiness:** Production-ready.

### `/admin/awaiting-team`
- **File:** `src/app/(app)/admin/awaiting-team/page.tsx`
- **Purpose:** Triage leads with no team assigned (mandatory-team policy).
- **Current functionality:** `requireUser()` + ADMIN/MANAGER redirect; leads with `forwardedTeam: null`; `AssignButtons` → Dubai/India; round-robin reconciler skips null-team leads.
- **Role access:** ADMIN/MANAGER (manual redirect).
- **Readiness:** Production-ready.

---

### `/team` — Team & Roles
- **File:** `src/app/(app)/team/page.tsx`
- **Purpose:** Manage teammates; exposes everyone's call counts, pipeline value, response times (competitive data) + role/Acefone editors.
- **Current functionality:** `requireRole("ADMIN","MANAGER")`; active-user grid with active leads, total calls, workload chip, 90-day pipeline value (`fmtMoneyDual`), avg first-response (raw SQL); per-row editors — `ManagerPicker`, `UserSpecializationEditor`, `AcefoneAgentIdEdit`, `WhatsAppNumberEdit` (Acefone/manager/WhatsApp edits gated to ADMIN); Acefone setup banner; permission matrix.
- **Buttons / actions:** "+ Invite User" button is present but **(inferred from code)** appears to be a non-wired placeholder (no handler in this server component).
- **Role access:** ADMIN/MANAGER (agents are redirected to `/dashboard`).
- **Readiness:** Partially ready — fully functional grid/editors; the "+ Invite User" button is a likely placeholder to confirm during UAT.

### `/team/[id]` — Agent deep-dive
- **File:** `src/app/(app)/team/[id]/page.tsx`
- **Purpose:** One agent's full scorecard.
- **Current functionality:** `requireRole("ADMIN","MANAGER")`; today/week/month `TileGrid`s, 6 leaderboard ranks, XP/level (`levelForXp`), badges earned/unearned, recent 15 activities, specializations, daily call target.
- **Role access:** ADMIN/MANAGER.
- **Readiness:** Production-ready.

---

## §3.2 Capability status table

Status legend: **Built** (working in code) · **Partial** (works with caveats / stub / missing scope) · **Placeholder** (UI exists, not wired) · **Not built**.

| Capability | Status | Notes |
|---|---|---|
| Lead creation | **Built** | `/leads/new` → `createLeadAction` → `ingestLead`; full Dubai-depth form. |
| Lead assignment | **Built** | Reassign on `/leads/[id]`; round-robin engine (attendance-aware); `/admin/awaiting-team` for null-team triage. |
| Lead detail | **Built** | `/leads/[id]`, ~20 cards, `canTouchLead()` guard. |
| Follow-up creation | **Built** | On create (`/leads/new`) and on `/leads/[id]`; IST parsing. |
| WhatsApp button | **Partial** | Free `wa.me` draft links always work (opens WhatsApp on the user's device). Programmatic send (Meta Cloud API) is **stub** until env keys live — see §3.3 / `docs/WHATSAPP_BUSINESS_SETUP.md`. |
| Call logging | **Built (manual) / Partial (auto)** | Manual call logging works. Auto-logging via Acefone webhook needs Acefone env keys (`acefoneEnabled()`); until then the "📞 Call via Acefone" path is inactive. |
| Pipeline stage move | **Built** | `/pipeline` + stage controls on lead detail; scoped via `leadScopeWhere()`. |
| Cold data import | **Built** | CSV bulk import (admin/manager per permission matrix). |
| Cold data conversion | **Built** | `/cold-calls` Revival Engine + `/cold-calls/session`. |
| Reports | **Built** | Hub + daily, sla, sources, ytd, team-comparison, commission, travel, cooling. |
| Attendance | **Built** | `/admin/attendance`; auto-mark on login (PRESENT/LATE at 10:30 IST), gates round-robin. |
| Templates | **Built (mgmt) / Partial (send)** | `/admin/templates` library + stats fully built; real WhatsApp send depends on Cloud API keys; email send works via Resend. |
| Notifications | **Built** | `/notifications` + web-push (VAPID) infra; push delivery depends on VAPID keys. |
| AI assistant | **Partial** | `/ai` works with `ANTHROPIC_API_KEY`; rule-based fallback without it. Gemini path abandoned. |
| Roles | **Built** | `requireRole` + `leadScope` recursive CTE; permission matrix rendered on `/team`. |
| Mobile nav | **Built** | `MobileShell.tsx` bottom/drawer nav. |
| Dashboard widgets | **Partial** | Built, **but Round 12 open:** agent KPI count tiles use team-wide scope, not own (NOT fixed). |
| Team mood | **Built** | `/admin/team-mood`, anonymous, never reads vault content. |
| Daily targets | **Built** | `/admin/targets` (8 metrics) → `/reports/daily`. |
| Workflows | **Built** | `/admin/workflows` IF/THEN engine + perf widget + run history. |
| Audit log | **Built** | `/admin/audit`, append-only, last 1000. |
| Data backup | **Partial / inferred** | No dedicated in-app backup UI seen; Neon (managed Postgres) provides platform-level backups. Verify operational backup story during UAT. |
| Data export / import | **Partial** | Import: CSV bulk import built. Export: PDF for daily report (`/api/reports/daily/pdf`); no confirmed general CSV/Excel export of leads (inferred — verify during UAT). |
| Gamification | **Built** | XP/levels (`levelForXp`), badges (`@/lib/gamification`), streaks, `/leaderboards`, `/profile`. |
| Vault | **Built** | `/vault` private per-user; `/admin/vault` admin oversight (intentional override — privacy copy to reconcile). |
| HR module | **Not built (as a module)** | No dedicated HR module. Adjacent pieces exist: attendance, weekly-off, travel reimbursement, team-mood. A unified "HR" surface is not present. |

---

## §3.3 Dependency list

What each capability relies on. "Env-gated" means the feature degrades or no-ops until the named environment variable(s) are set in Vercel.

### Depends on the Backend API / server actions
- All lead CRUD, follow-ups, stage moves, reassignment, attendance auto-mark, workflow runs, AI chat, report generation. Implemented as Next.js server components + server actions + `/api/*` route handlers (e.g. `/api/reports/daily/pdf`, `/api/acefone/webhook`, `/api/cron/*`, `/api/health`).

### Depends on the database (PostgreSQL / Neon via Prisma)
- **Core tables:** `Lead`, `User`, `Activity`, `CallLog`, `VaultEntry`, plus workflow / template / target / attendance / audit / notification tables (see `prisma/schema.prisma`).
- Several analytics pages use **raw SQL** (`prisma.$queryRaw`): leaderboards (first-call DISTINCT ON), team avg-response, `/admin/duplicates`, `/reports/sources`, `/reports/cooling`, `/calls` heatmap. These depend on Postgres-specific features (`DISTINCT ON`, `EXTRACT(EPOCH …)`, `RECURSIVE` CTE in `leadScope`).

### Depends on Auth (custom cookie session)
- Every `(app)` page (`requireUser` / `requireRole`). Session signing uses `NEXTAUTH_SECRET` (also reused for the ICS-subscription HMAC in `/settings`). bcryptjs for password hashing.

### Depends on Role permissions (`src/lib/leadScope.ts` + `requireRole`)
- Lead visibility/scoping everywhere; admin/manager-only reports (sources, ytd, team-comparison, commission); all `/admin/*` pages; `/team` competitive data. **Round 12 open item lives here:** the dashboard agent KPI tiles bypass own-scope.

### Depends on WhatsApp
- **Free path (always on):** `wa.me` draft links — open WhatsApp on the user's own device; no env needed.
- **Programmatic send (env-gated, currently stub):** Meta WhatsApp Business Cloud API. Needs `WA_BUSINESS_TOKEN`, `WA_BUSINESS_PHONE_NUMBER_ID`, and approved templates (`afterhours_welcome`, `first_query_welcome`, `site_visit_reminder`). Until set: speed-to-lead WA, after-hours auto-WA, and workflow `SEND_WA` actions **log intent only**. See `docs/WHATSAPP_BUSINESS_SETUP.md`.

### Depends on Acefone (click-to-call)
- Env-gated via `acefoneEnabled()`: `ACEFONE_API_KEY`, `ACEFONE_DID_NUMBER`, `ACEFONE_WEBHOOK_TOKEN`, optional `ACEFONE_BASE_URL`. Per-agent `acefoneAgentId` set on `/team`. Inbound/outbound auto-CallLog arrives via `/api/acefone/webhook?token=…`. Until configured, "📞 Call via Acefone" is inactive and `/admin/integrations` shows Acefone as not-configured. See `docs/ACEFONE_SETUP.md`.

### Depends on the AI API
- `/ai` assistant and AI lead-scoring/re-scoring. Primary: `ANTHROPIC_API_KEY` (Anthropic Claude). `GEMINI_API_KEY` path abandoned. Rule-based fallback runs without a key (degraded). `/reports/sources` "avg AI score" and `/reports/cooling` ("AI re-score" STATUS_CHANGE activities) depend on the scorer having run.

### Depends on file upload
- **(inferred)** Vault attachments / any document storage. No dedicated upload provider confirmed in the pages re-read; verify storage backend during UAT.

### Depends on PWA / mobile config
- `MobileShell.tsx` nav; web-push needs **VAPID keys** (`/admin/integrations` Push/VAPID card, `TestPushButton` in `/settings`). PWA install/offline behaviour to confirm during UAT.

### Depends on email (Resend)
- Speed-to-lead email + workflow email send. Env-gated by the Resend key; `/admin/integrations` surfaces Resend status. (Email send is already real; only WhatsApp send is stub.)

### Depends on cron scheduling (Vercel Hobby constraints)
- `vercel.json.crons` is capped at **2 daily-or-less** jobs; all sub-daily jobs live in `.github/workflows/cron.yml`, hitting `/api/cron/*` with `Authorization: Bearer ${CRON_SECRET}`. `/admin/integrations` checks observed crons against an 8-entry `EXPECTED_CRONS` catalogue. (Per `AGENTS.md`: violating the Hobby cron limit makes Vercel silently drop the deployment.)

---

*End of inventory. Items marked **(inferred from code)** and all "(screenshot to be captured during live UAT)" notes should be confirmed during live user-acceptance testing.*
