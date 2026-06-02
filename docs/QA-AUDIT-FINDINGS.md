# QA Audit Findings — White Collar Realty CRM

**Method:** read-only code audit of the *deployed* commit `60fa393` (confirmed live via
`/api/health` → `{"ok":true,"commit":"60fa393","leads":45}` on 2026-06-02). The app is
login-gated, so authenticated pages could **not** be exercised live — every finding below is
inferred from **reading the committed source** (verified with `git show HEAD:<file>`), plus the
health endpoint and `docs/QA-POST-DEPLOY-CHECKLIST.md`. Where a behaviour could only be
confirmed by clicking, it is marked **(inferred from code)**. No source was edited; nothing was
committed or deployed.

This complements `docs/QA-FEEDBACK-2026-06-02.md` (Lalit's walk-through notes) — that doc lists
*product* gaps; this doc adds the *engineering* risks (security/permission leaks, bugs, perf,
build health). Several items overlap and are cross-referenced.

---

## 1. Ready for team rollout?  →  **PARTIALLY**

The deployed build is feature-rich, type-clean, and the core agent workflow (leads → lead detail →
log call/WhatsApp → update status → action list) is solid and correctly scoped. **But four
permission leaks let a regular AGENT see data they should not** — most seriously, **every company
lead's name, budget, owner and AI score via `/pipeline`**, and **every teammate's call counts,
pipeline value and response times via `/team` and the dashboard**. This directly contradicts the
app's own on-screen "Permission matrix" (Agent = *"Own only"*) and Lalit's stated intent in
QA-FEEDBACK Bucket G ("hide source from agents", "reject leads vanish from agent view"). For a team
of **first-time CRM users who are competitors on the same floor**, that cross-visibility is a
rollout blocker until fixed. The leaks are small, localized code changes (hours, not days).

**Recommendation:** fix the P0 + the three P1 leaks (Section 3), re-verify, then roll out. Everything
else (UX density, label bugs, perf) can follow in a fast second pass.

---

## 2. Findings by priority

Severity: **P0** = data leak / broken core flow, fix before rollout · **P1** = important, fix this
week · **P2** = polish / do soon.

### P0 — must fix before any agent logs in

| # | Finding | Where | Evidence |
|---|---------|-------|----------|
| P0-1 | **`/pipeline` shows ALL company leads to every agent.** The Kanban page has **no `requireUser()` and no ownership scope** — `where` is built only from `status` + optional `?team`/`?owner`/`?ai` URL params. Any AGENT sees every lead's name, budget, owner, project and AI score across both teams. | `src/app/(app)/pipeline/page.tsx:32-35` (guard list confirms `pipeline → NONE`) | `where = { status:{in:stages} }`; `if (sp.owner) where.ownerId = sp.owner` — no `leadScopeWhere`. |

### P1 — fix this week

| # | Finding | Where | Evidence |
|---|---------|-------|----------|
| P1-1 | **`/team` exposes every teammate's competitive stats to agents.** Page guard is only `requireUser()` (no `requireRole`/redirect). An AGENT sees all users' email, role, team, manager, active-lead count, total calls, **90-day pipeline value** and **avg response time**. The page's own Permission matrix on the same screen says "Agent → Own only." | `src/app/(app)/team/page.tsx:19` (only `requireUser()`; 0 `requireRole`/`redirect`) | Matrix contradiction at `team/page.tsx:232`. |
| P1-2 | **`/leads?owner=<otherId>` lets an agent read another agent's leads.** Scope is applied correctly (`leadScopeWhere`), then **overwritten** by the owner URL param. | `src/app/(app)/leads/page.tsx:42` then `:69-70` | `else if (sp.owner) where.ownerId = sp.owner;` clobbers the scoped `ownerId`. The owner dropdown that exposes other IDs is shown to all roles — `src/components/LeadFilters.tsx:73-77`. |
| P1-3 | **Dashboard "BY SALESPERSON" table leaks per-agent stats to agents.** The raw query returns calls/connected/due/overdue/closeable/clients for **every** active AGENT+MANAGER, and the JSX section has **no role guard** (other dashboard sections do — lines 349, 588 — but this one doesn't). | `src/app/(app)/dashboard/page.tsx:201-214` (query) + `:694-702` (ungated render) | `WHERE u.active = true AND u.role IN ('AGENT','MANAGER')`, no per-user filter. |
| P1-4 | **Dashboard KPI scope:** agents see **team/company-wide** counts, not their own. All KPI counts use `teamScope` (`{}` for the "all" view, or `{forwardedTeam}`), never `ownerId: me.id`. An agent's "Total clients / Hot / Ready to close" reflect the whole team. | `src/app/(app)/dashboard/page.tsx:49,64-79` | `teamScope = view==="all" ? {} : {forwardedTeam:view}`. Likely intended for managers; wrong for agents. **(inferred from code)** |

### P2 — polish / soon

| # | Finding | Where | Evidence |
|---|---------|-------|----------|
| P2-1 | **`/properties` "matching leads" expander leaks peer lead names + budgets.** `bestLeadsForProject` filters only by status + `forwardedTeam`, never `ownerId`, and the page renders `leadName` + budget for all users. | `src/lib/leadsForProject.ts:118-120`; render at `properties/page.tsx:341-359` | No `ownerId` in the `where`. |
| P2-2 | **Two dashboard KPI tiles are mislabeled.** Tiles titled **"📞 Calls (mo)"** (month) actually display `callsToday`. Matches QA-FEEDBACK Bucket C ("labels unclear"). | `src/app/(app)/dashboard/page.tsx:632,640` | `<KPI title="📞 Calls (mo)" value={callsToday} sub="today" />`. |
| P2-3 | **`waToday` ignores the team filter.** "WhatsApp Touches Today" counts company-wide messages even when viewing a single team. | `src/app/(app)/dashboard/page.tsx` (`waToday` count) | `whatsAppMessage.count({ where:{ receivedAt:{gte:todayStart} } })` — no `teamScope`. |
| P2-4 | **Dashboard "Automations active" panel hardcodes "ON" chips** regardless of real config (round-robin, dedupe shown ON unconditionally). Cosmetic but misleading during setup. | `src/app/(app)/ai/page.tsx` (Automations card) | Static `chip-won` "ON" markup. |
| P2-5 | **Sparse loading / error states.** Only 3 `loading.tsx` (dashboard, leads, leads/[id]) and **1** `error.tsx` (leads/[id]) across ~45 routes — all `force-dynamic`/DB-bound. A slow query or DB blip on, e.g., `/pipeline`, `/reports/*`, `/team` shows a blank/janky page or an unstyled crash. | `find src/app -name loading.tsx / error.tsx` | No global `app/error.tsx` or `not-found.tsx`. **(inferred from code)** |
| P2-6 | **Perf / N+1 hot-spots** (functional, but will drag as data grows): `bestLeadsForProject` runs **once per project** on `/properties` (`properties/page.tsx:135`); `findMatchingLeads` + `bestUnitsForLead` run **sequentially after** the main `Promise.all` on **every** lead-detail load; `runReconciler()` fires on page loads (30s throttle). Fine at 45 leads; revisit before scale. | `properties/page.tsx:131-138`; `leads/[id]/page.tsx`; `src/lib/reconciler.ts` | **(inferred from code)** |

### Build / process risks (not user-facing yet)

- **No CI build gate.** `.github/workflows/cron.yml` only pings cron endpoints; nothing runs
  `next build`/`tsc` on push. A broken commit deploys straight to production. The deployed commit
  `60fa393` **does** type-check cleanly (`tsc --noEmit --incremental false` → exit 0).
- **Working tree is mid-flight** (background agent "Dark mode + accents + festive"): `M` on
  `schema.prisma`, `festivals.ts`, `VaultClient.tsx`, theme files, etc., plus untracked
  `admin/vault/`, `set-weekly-offs.ts`, `VaultVoiceInput.tsx`, a new migration. It **currently
  compiles** (verified), but it is **uncommitted WIP** — do not `npm run push` until that work is
  finished and re-checked, and run the new migration on the DB before shipping `schema.prisma`.
- **Latent privacy contradiction (WIP, not live yet):** the new **`admin/vault/page.tsx` is
  untracked** — when shipped, it lets ADMIN/MANAGER read **every agent's full Vault entries,
  including VENT**, while the agent-facing `/vault` UI explicitly promises *"Private space — only
  you can see this"* / *"Nobody else will see this"* (`VaultClient.tsx:267,303,464`). The page's own
  header comment says this is Lalit's intentional decision — if so, **change the agent-facing copy**
  before that page goes live, or agents will feel misled. Flagging now so it doesn't ship silently.

---

## 3. Top 5 must-fix before rollout

1. **`/pipeline` — add `requireUser()` and apply `leadScopeWhere(me)`** so agents see only their own
   leads (managers/admins keep the team view). *(P0-1)*
2. **`/team` — gate behind `requireRole("ADMIN","MANAGER")`** (or strip it to a name/role-only
   directory for agents). Today every agent sees peers' pipeline value + response times. *(P1-1)*
3. **`/leads` — ignore `?owner=` for agents.** Apply the owner filter only on top of the scoped set
   (or only for ADMIN/MANAGER), and hide the owner dropdown from agents in `LeadFilters`. *(P1-2)*
4. **Dashboard — wrap "BY SALESPERSON" in `isAdminOrMgr &&`** (same pattern already used at lines
   349/588) and scope agent KPI tiles to `ownerId: me.id`. *(P1-3, P1-4)*
5. **`/properties` matching expander — scope `bestLeadsForProject` to the viewer** for agents (pass
   `ownerId`), so it stops naming peers' clients + budgets. *(P2-1)*

> All five are small, localized edits. None require schema changes. After fixing, re-run
> `tsc --noEmit --incremental false` and smoke-test `/api/smoke`.

---

## 4. Top 5 UX simplifications for first-time agents

1. **Thin the dashboard.** It renders ~15 cards. First-time agents need ~4: *My follow-ups due
   today, My hot leads, My overdue, Today's call count.* Move forecasting / by-salesperson /
   automations to a manager-only or "More" view. (Echoes QA-FEEDBACK Bucket C.)
2. **Thin the lead-detail page.** ~20 cards on one screen. Lead with the 3 things an agent acts on
   (next action, contact buttons, status) and collapse BANT / matching units / history into tabs or
   accordions. (Echoes QA-FEEDBACK Bucket B.)
3. **Fix and clarify labels now.** "Calls (mo)" (shows today), "Sales floor live", "Complete",
   "Selling leads", "investment" tag — all flagged by Lalit. Wrong/ambiguous labels erode trust
   fastest with new users. *(ties to P2-2)*
4. **Add hover/empty-state explanations** for derived widgets ("Top-5 action list", "Star of the
   month", "Stalled deals", "Why this score"). New users can't infer the logic. (QA-FEEDBACK C & E.)
5. **Make every dead-end clickable + add loading skeletons.** "Stalled deals → jump to pipeline"
   (QA-FEEDBACK C) and a `loading.tsx` on the heavy pages so a slow query doesn't look like a freeze.
   *(ties to P2-5)*

---

## 5. Real-estate workflow gaps (vs. an ideal sales motion)

| Stage | Built? | Gap / note |
|-------|--------|------------|
| **New lead intake & dedup** | Partial | Intake + round-robin + auto-dedupe exist, but **the same lead appears in BOTH India and Dubai**, and repeated phone/email show as separate leads — Lalit's #1 BLOCKER (QA-FEEDBACK Bucket A). Dedup on phone+email must collapse to one owned record before rollout. |
| **Hot lead** | Yes | AI score (rule-based fallback), "Ready to close", hot-lead surfacing on dashboard + action-list. Score reasoning ("why this score") not shown — agents distrust the label (QA-FEEDBACK E). |
| **Cold revival** | Partial | `/cold-calls` + cooling report exist and are agent-scoped. **No revival engine on the lead itself** and cold→warm rules are keyword-ish, not AI-driven (QA-FEEDBACK E). |
| **Manager escalation** | Yes | `needsManagerReview` flag, "Needs Lalit" counters, `/admin/awaiting-team`, reject flow with reasons. Solid. Reject should also **hide the lead from the agent** while keeping it in admin (QA-FEEDBACK G) — currently `/admin/rejected-leads` is admin-gated but the agent-side hide isn't confirmed. **(inferred from code)** |
| **Site visit** | Yes | `SITE_VISIT` stage, `/admin/site-visits`, travel report, visit logging. Present. Meeting-scheduling guardrail (≤1 week ahead) requested but not enforced (QA-FEEDBACK F). |
| **BANT / qualification** | Partial | BANT model + AI scoring exist; QA-FEEDBACK B wants BANT filled per-lead, "why" panel replaced with green/red signals, project field as type-ahead, interested-properties + sticky-note sections, and WhatsApp+call merged into one timeline. |

---

## 6. What's already built and working (inventory)

One line each (all login-gated via the `(app)` layout; guard in parentheses is the *page-level* check):

- **Dashboard** *(requireUser)* — ~15-card command center: KPIs, forecast, by-salesperson, automations. Rich; over-dense for agents; KPI scope + 2 labels are buggy (P1-4, P2-2/3).
- **Action list** *(requireUser)* — prioritized "what to do next"; correctly agent-scoped (`ownerId: me.id`). Good.
- **Leads** *(requireUser)* — list + filters; agent-scoped **except** the `?owner=` overwrite (P1-2). Has `loading.tsx`.
- **Lead detail** *(requireUser)* — ~20-card workspace (BANT, AI score, matching units, activity, call/WhatsApp). Properly scoped (`canTouchLead`); has loading + error boundary. Dense.
- **Pipeline** *(NONE)* — Kanban by stage. **Unscoped — P0 leak.**
- **Properties** *(requireUser)* — project/unit catalog, team-geo scoped, good empty states; matching-leads expander leaks peer names (P2-1). New/edit gated to ADMIN/MANAGER.
- **Reports** — index + commission/sources/team-comparison/ytd *(ADMIN/MANAGER)*; cooling/daily/sla/travel *(requireUser, agent-scoped to own data — verified)*. QA-FEEDBACK D wants calendar filters, back button, no print, CSV without agents column.
- **AI assistant** *(NONE, but benign)* — chat shell only; data access is server-side in the AI route, so the unguarded page is fine. "Automations ON" chips are hardcoded (P2-4).
- **Vault** *(requireUser, scoped to `userId: me.id`)* — private journal/vent/wins. UI promises privacy; see the WIP `admin/vault` contradiction above.
- **Cold-calls / Calls / Activities** *(requireUser)* — all correctly agent-scoped (`ownerId`/`userId: me.id`). Good.
- **Leaderboards** *(requireUser)* — gamified ranking of all agents (peer-visible *by design*; acceptable).
- **Admin/** — mostly correctly gated: `attendance, audit, cron-health, duplicates, health, integrations, site-visits, targets, workflows` *(ADMIN)*; `quality, team-mood, templates` *(ADMIN/MANAGER)*; `awaiting-team, rejected-leads` *(requireUser but redirect non-managers — verified)*. **`admin/vault` is untracked WIP (not live).**
- **Team** *(requireUser)* — user/role admin grid. **Unscoped peer data — P1 leak.** `/team/[id]` detail is correctly `ADMIN/MANAGER`.
- **Settings / Profile / Intake / Notifications / Help** *(requireUser)* — present. Intake shows API/website/WhatsApp keys to all roles (PreAssignedImporter itself is admin/manager-gated) — minor; consider hiding key copy from agents.

---

## Plain-English summary for Lalit

The CRM is genuinely close — the day-to-day path your agents will use most (open a lead, call or
WhatsApp them, update the status, see what to do next) works well and is built thoughtfully. **The
one thing to fix before you let the team in is privacy between agents.** Right now a regular agent
can open the **Pipeline** page and see **every** lead in the whole company — names, budgets, who
owns them — and the **Team** page and part of the **Dashboard** show each agent how many calls and
how much pipeline *every other agent* has. That's the opposite of what your own screens promise
("agents see their own only"), and on a competitive sales floor it'll cause friction. The good news:
these are small, quick code fixes (a few hours), not a rebuild. Fix those, fix the de-duplication
blocker you already flagged (the same lead showing in both India and Dubai), correct a couple of
mislabeled dashboard tiles, and you're in good shape to roll out — ideally with the dashboard and
lead pages slimmed down a bit so first-time users aren't overwhelmed on day one.
