# White Collar Realty CRM — Full QA Report

**Product:** White Collar Realty CRM (Next.js 16 · React 19 · Prisma 6 · PostgreSQL) — live at `crm.whitecollarrealty.com`.
**Business context:** Dubai off-plan property sold to Indian investors. Two calling teams — **Dubai** (Mehak, Dinesh) and **India** (Yasir, Tanuj). Roles: **ADMIN** / **MANAGER** / **AGENT**. Office hours 10:00–19:00 IST, Mon–Sat. Non-technical owner (Lalit) is the escalation point.
**Audited build:** commit `4dd8ba1` ("Round 11").
**Method:** **Source-only** audit (the app is login-gated; no live clicking). Every claim cites a real file path. Behaviour implied by a click sequence is marked *(inferred from code)*. Where the spec expects an image, this report says *(screenshot to be captured during live UAT)*.
**Cross-references:** `docs/QA-AUDIT-FINDINGS.md` (older commit `60fa393`), `docs/QA-FEEDBACK-2026-06-02.md` (Lalit's UAT buckets A–I), `docs/CRM_BUG_REPORT.md` (companion bug table — bug IDs **B-xx** below map to it).
**Voice:** rigorous QA tester + sales-ops manager. No filler; findings are evidence-backed.

**Legend per page:** ✅ Working · ❌ Broken · ⚠️ Confusing · ➕ Missing — followed by a one-line **UX read** and a **Mobile note**.

---

## 1. Login / Authentication

**Files:** `src/lib/auth.ts` (`requireUser`, `requireRole`), used across every `(app)` route.

- ✅ `requireUser()` redirects unauthenticated visitors to `/login`; `requireRole(...roles)` redirects wrong-role users to `/dashboard`. Consistent gate used everywhere.
- ✅ Role model is coherent: ADMIN (all), MANAGER (self + reports), AGENT (self).
- ⚠️ No evidence reviewed of lockout/rate-limiting or password-reset UX (out of audited scope — flag for live UAT).
- ➕ Session-expiry messaging *(inferred — not observed in source)*.

**UX read:** Auth is the strongest part of the codebase — one well-understood pattern applied uniformly.
**Mobile note:** Redirects are server-side, so they behave identically on mobile. *(Login screen layout: screenshot to be captured during live UAT.)*

---

## 2. Dashboard (`/dashboard`)

**File:** `src/app/(app)/dashboard/page.tsx` (~794 lines).

- ✅ "BY SALESPERSON" peer-comparison table is gated `{isAdminOrMgr && (...)}` (~line 699) and `spStatsRaw` is skipped for agents (~line 205) — **fixed Round 11** (was audit P1-3). See **B-11**.
- ✅ Team toggle (Dubai/India/all) is locked for agents to their own team (lines 42–47) — agents can't pivot onto the other team.
- ✅ Sales Floor Live Feed (lines 124–129, 434–466) and leaderboards are team-scoped and **peer-visible by design** (spec §12.2) — *not* a bug.
- ❌ **Agent KPI tiles are team-scoped, not own-scoped.** Total clients / New today / Hot leads / Calls today / Ready-to-close / Needs-you / follow-ups all use `teamScope` (`forwardedTeam`) rather than `ownerId: me.id` (lines 49, 64–90, 96–120). An agent sees **whole-team** totals on their personal dashboard. **B-03 (P2), open — Round 12.**
- ❌ **WhatsApp tile ignores the team filter:** `waToday` counts company-wide (`receivedAt` only, line 70) while adjacent Calls/Connected tiles honour the team filter — inconsistent. **B-04 (P2), open.**
- ⚠️ **"📞 Calls (mo)" tile is mislabelled:** it binds `callsToday` (`startedAt ≥ todayStart`, line 68) with `sub="today"` but a title that says "(mo)" (~lines 636/644). Today's number wearing a monthly label. **B-05 (P3), open.**

**UX read:** Dense but genuinely action-first (hot-untouched, overdue follow-ups, closable deals up top). The scope/label bugs undermine an agent's trust in "their" numbers — fix B-03 before agents rely on it.
**Mobile note:** Tile grid is responsive; the long page means agents scroll a lot on a phone — the hero strip up top mitigates this. *(Screenshot to be captured during live UAT.)*

---

## 3. Action List (`/action-list`)

**File:** `src/app/(app)/action-list/page.tsx`.

- ✅ Correctly scoped: `scope = me.role === "AGENT" ? { ownerId: me.id } : {}` (line ~86). Agents see only their own actionable leads.
- ✅ Action-first framing matches how a calling team works (what to do next, now).

**UX read:** This is the page an agent should live in during a calling shift — focused and correctly private.
**Mobile note:** List layout suits a phone well. *(Screenshot to be captured during live UAT.)*

---

## 4. Leads (`/leads`)

**Files:** `src/app/(app)/leads/page.tsx`, `src/components/LeadFilters.tsx`, `LeadsListClient`.

- ✅ `?owner=` honoured only when `me.role !== "AGENT"` (lines ~72–75) — agents can't pivot onto a peer's book — **fixed Round 11** (audit P1-2). See **B-10**.
- ✅ `?source=` gated to non-agents (line ~65); agents hide LOST leads (lines ~51–53); `showSource={me.role!=="AGENT"}` passed to filters/list.
- ⚠️ The owner `<select>` in `LeadFilters.tsx` (lines ~73–77) still renders for everyone. It's **inert** for agents server-side, but listing peers' names in a dropdown is a minor leak + a dead control. **B-13 (P3), open.**

**UX read:** Core list is correctly private now; the leftover owner dropdown is cosmetic debris to remove.
**Mobile note:** Filter bar collapses acceptably; confirm the owner dropdown removal also tidies the mobile filter sheet. *(Screenshot to be captured during live UAT.)*

---

## 5. Lead Detail (`/leads/[id]`)

**File:** `src/app/(app)/leads/[id]/page.tsx`.

- ✅ Ownership-gated: `canTouchLead(me, lead)` else `redirect("/leads")` (line ~113). Agents can't open a peer's lead by guessing the URL.
- ✅ Sticky note is per-user (lines ~102–106) — private scratchpad, good.
- ⚠️ ➕ **BANT / qualification depth (Bucket B).** Fields exist (`bantStatus`, `bantReason`, `whoIsClient`, budget, configuration) but the page is a dense ~20-card workspace and, per Lalit, doesn't yet match how the team actually qualifies. Stage advancement isn't gated on BANT completeness. **B-17 (P1 product), open — co-design with Lalit.**

**UX read:** Powerful but heavy. The risk isn't data safety (that's handled) — it's cognitive load and an under-structured qualification flow. Prioritise the BANT fields visually.
**Mobile note:** ~20 cards on a phone is a long scroll; consider collapsing secondary cards by default on mobile. *(Screenshot to be captured during live UAT.)*

---

## 6. Cold Data / Revival Engine (`/cold-calls`)

**File:** `src/app/(app)/cold-calls/page.tsx`.

- ✅ Correctly scoped: `baseScope = isAdminOrMgr ? {} : { ownerId: me.id }` (line ~50). Agents revive only their own cold leads.
- ✅ "Revival Engine" framing is motivating and on-brand for a calling floor.

**UX read:** Solid. Pairs well with the dashboard's cold-revival tile.
**Mobile note:** Works as a list on mobile. *(Screenshot to be captured during live UAT.)*

---

## 7. Pipeline (`/pipeline`)

**File:** `src/app/(app)/pipeline/page.tsx`.

- ✅ **Fixed Round 11 (was the audit's P0-1 blocker).** `scope = await leadScopeWhere(me)`; board where-clause `{ ...scope, status:{ in: ... } }`; `?owner=` honoured only `if (me.role !== "AGENT")` (lines ~42–45). Agents see only their own Kanban. See **B-08**.

**UX read:** Kanban is the right metaphor for stage movement; now correctly private.
**Mobile note:** Horizontal Kanban is inherently awkward on a phone — verify columns scroll cleanly and consider a stage-filtered single-column view on mobile. *(Screenshot to be captured during live UAT.)*

---

## 8. Properties (`/properties` and `/properties/[id]`)

**Files:** `src/app/(app)/properties/page.tsx`, `src/app/(app)/properties/[id]/page.tsx`, `src/lib/leadsForProject.ts`.

- ✅ **Fixed Round 11 (audit P2-1).** "Matching leads" expander passes `leadScope` into `bestLeadsForProject(p.id, 5, leadScope)`; the helper spreads `...scope` into its where-clause (`leadsForProject.ts` line 124). See **B-06**.
- ✅ Property detail scopes **both** "Matching leads" (`bestLeadsForProject(id, 10, leadScope)`) and "Active discussions" (`...leadScope` in the `lead.findMany`) (`[id]/page.tsx` lines 34–46). See **B-07**.
- ✅ Inventory table, India/Dubai currency (INR/AED), unit-status chips, CSV import gated to admin/manager (`canImportUnits`) — all sound.

**UX read:** Reverse-matching (which of *my* leads fit this project) is a genuinely useful sales tool and is now correctly private per agent.
**Mobile note:** Inventory table uses `overflow-x-auto` — horizontal scroll on a phone is acceptable but cramped. *(Screenshot to be captured during live UAT.)*

---

## 9. Activities / Action Board (`/activities`)

**File:** `src/app/(app)/activities/page.tsx`.

- ✅ Correctly scoped: `scope = me.role === "AGENT" ? { ownerId: me.id } : {}` (line ~97).
- ✅ "Action Board" + Top-5 framing is clear and motivating.

**UX read:** Good. Reinforces daily activity discipline (meetings, site visits, cold-to-lead).
**Mobile note:** List-based; fine on mobile. *(Screenshot to be captured during live UAT.)*

---

## 10. Call Records (`/calls`)

**Files:** `src/app/(app)/calls/page.tsx`, `src/components/CallsClient.tsx`.

- ✅ Connect-rate-by-hour **heatmap** is correctly agent-scoped: the `$queryRaw` adds `AND "userId" = ${me.id}` for agents (lines 31–50). Leadership sees all. IST hour extraction is correct.
- ❌ **OPEN AGENT↔AGENT DATA LEAK — the recent-calls list is unscoped.** `prisma.callLog.findMany({ orderBy:{startedAt:"desc"}, take:50, include:{ ... } })` (lines 67–83) has **no `userId`/owner filter**. An AGENT sees the latest **50 company-wide** calls. Tapping a row opens `CallsClient`'s right-hand summary panel, which exposes the peer lead's **name, phone, email, status, AI score, BANT status + reason, budget, configuration, "who is client", follow-up date, to-do, owner name, and the last 5 call notes** (row mapping lines 98–137). `CallsClient.tsx` is purely presentational — it does no filtering, so the leak is entirely in the page query.
- ❌ **Same leak in the QualityList.** `quality` is mapped from the same unscoped `calls` array (lines 89–96) and rendered for everyone (lines 245–277) — agents see peers' lead names + call quality.
  > **Important:** `docs/QA-AUDIT-FINDINGS.md` stated "Cold-calls / Calls / Activities all correctly agent-scoped." That is **inaccurate for `/calls`** — the heatmap is scoped, the **list and QualityList are not**. This leak survived Round 11. **B-02 (P1), open.** The fix is a one-liner mirroring the heatmap: `const callScope = isAgent ? { userId: me.id } : {}` spread into the `findMany` where-clause (and the `quality` map).
- ⚠️ Over-include / N+1: 50 rows × (`lead → owner` + nested `callLogs(take:5) → user`). Heavy even after scoping. **B-15 (P2).**

**UX read:** The heatmap and quality scoring are good ideas, but the page currently leaks the most sensitive cross-agent data in the app. This is the single most important data-safety fix remaining.
**Mobile note:** Tap-row-to-open-summary is a mobile-friendly pattern; the leak makes that worse on mobile, not better. *(Screenshot to be captured during live UAT.)*

---

## 11. Reports (`/reports`)

**File:** `src/app/(app)/reports/page.tsx` (+ `reports/cooling`, `reports/sla`, `reports/daily`, `reports/travel`).

- ✅ Heatmap uses `scopedUserId` (line ~46); source chart gated `me.role !== "AGENT"` (line ~430); CSV export admin-only (line ~416).
- ✅ Sub-reports verified agent-scoped: cooling (`scopedOwnerId` ~line 70), SLA (`agentScope` ~line 104, `where.userId` ~line 59), daily (`targetUserId` ~line 50), travel (`agentScope` ~line 59).
- ✅ Best-time-to-call IST formatting corrected (Bucket D).
- ⚠️ Label clarity across reports still wanted (Bucket C/D). **B-18 (P3).**

**UX read:** Reports are correctly scoped per role and the IST fix lands. Mostly a labelling polish remains.
**Mobile note:** Charts/tables need horizontal room — confirm they degrade gracefully on a phone. *(Screenshot to be captured during live UAT.)*

---

## 12. Notifications (`/notifications`)

- ✅ Scoped to `userId: me.id` — each user sees only their own notifications.
- ✅ Present in the mobile bottom-nav (see §15) — reachable in one tap.

**UX read:** Correctly private; well-placed in nav.
**Mobile note:** First-class in bottom nav. *(Screenshot to be captured during live UAT.)*

---

## 13. Settings / Team / Roles (`/team`)

**File:** `src/app/(app)/team/page.tsx`.

- ✅ **Fixed Round 11 (audit P1-1).** Page calls `requireRole("ADMIN","MANAGER")` (line ~26) → agents are redirected away from team pipeline value / response-time leaderboards. See **B-09**.
- ✅ Contains the Permission matrix (Agent = "Own only") — useful for training and self-documentation.

**UX read:** Leadership-only surface, now correctly gated.
**Mobile note:** Matrix/table — verify it scrolls on a phone. *(Screenshot to be captured during live UAT.)*

---

## 14. Attendance / Targets / Team-Mood

- ✅ Targets feed the dashboard team KPIs (this-month activity counts, lines 83–89).
- ⚠️ ➕ **Team-mood / motivation / voice (Bucket H)** is partially specced (`docs/SPEC-smart-cma-and-voice.md`) but tone/usefulness is unvalidated. **B-20 (P4).**
- ⚠️ Attendance vs office-hours (10:00–19:00 IST) enforcement not confirmed from audited files — flag for live UAT.

**UX read:** Motivational surfaces are promising but should be piloted with one team before a full switch-on.
**Mobile note:** *(Screenshot to be captured during live UAT.)*

---

## 15. Navigation / Mobile Shell

**File:** `src/components/MobileShell.tsx`.

- ✅ **Fixed Round 11.** "Team & Roles" and "Awaiting Team" carry `managerOrAdmin: true` (lines ~48–51) and are filtered from both desktop (line ~141) and mobile (line ~236) nav. See **B-12**.
- ✅ Bottom nav = Dashboard / Action List / Leads / Pipeline / Notifications — a sensible agent default set.

**UX read:** Role-aware nav is correct; bottom-nav choices match an agent's daily loop.
**Mobile note:** This is the backbone of the mobile experience and it's well-structured. *(Screenshot to be captured during live UAT.)*

---

## 16. Templates / Workflows / Automations

- ❌ **Automations shown hardcoded ON** regardless of backend state (audit P2-4) — the UI can claim a workflow is running when it isn't. **B-16 (P2), open.**
- ⚠️ Several toggles may not be wired to persisted config.

**UX read:** Misleading state erodes trust in automation. Bind to real state or label "Coming soon" + disable.
**Mobile note:** *(Screenshot to be captured during live UAT.)*

---

## 17. Data import / Dedup (Bucket A) — cross-cutting

- ❌ **No evidenced phone-normalisation + dedup/merge guard** on lead create / CSV / sheet import. Per Lalit (Bucket A) duplicates are entering the pipeline — two agents can unknowingly work the same client. **B-01 (P0), open — the top rollout blocker.**

**UX read:** Everything else is downstream of clean data. Fix this first.
**Mobile note:** N/A (import is a desktop/admin task).

---

## 18. Audit & Data-safety summary

**The Round-11 fixes are genuinely present in source** (all verified, all map to bug IDs):

| Area | Status | Evidence |
|------|--------|----------|
| Pipeline unscoped (P0-1) | ✅ Resolved | `pipeline/page.tsx` lines ~42–45 (**B-08**) |
| `/team` exposed to agents (P1-1) | ✅ Resolved | `team/page.tsx` line ~26 (**B-09**) |
| Leads `?owner=` / `?source=` (P1-2) | ✅ Resolved | `leads/page.tsx` lines ~65, 72–75 (**B-10**) |
| Dashboard BY SALESPERSON (P1-3) | ✅ Resolved | `dashboard/page.tsx` ~line 699 (**B-11**) |
| Properties matching-leads leak (P2-1) | ✅ Resolved | `properties/page.tsx` + `leadsForProject.ts` line 124 (**B-06/B-07**) |
| Nav links to agents | ✅ Resolved | `MobileShell.tsx` lines ~48–51 (**B-12**) |

**Still-open data-safety / correctness items:**

| Item | Severity | Evidence |
|------|----------|----------|
| `/calls` recent-calls list + QualityList unscoped (NEW — found this audit) | **P1** | `calls/page.tsx` lines 67–83, 89–96 (**B-02**) |
| Dashboard agent KPI tiles team-scoped | P2 | `dashboard/page.tsx` lines 64–90 (**B-03**) |
| WhatsApp tile ignores team filter | P2 | `dashboard/page.tsx` line 70 (**B-04**) |
| "Calls (mo)" mislabel | P3 | `dashboard/page.tsx` ~636/644 (**B-05**) |
| Inert owner dropdown visible to agents | P3 | `LeadFilters.tsx` ~73–77 (**B-13**) |
| Lead dedup/merge | **P0** | import path (**B-01**) |

**By design (not bugs):** Sales Floor Live Feed and leaderboards are intentionally peer-visible (spec §12.2).

---

## Verdict — Ready for team rollout?

### Partially.

Round 11 closed every **major** cross-agent leak the original audit found (pipeline, team, leads pivots, dashboard salesperson table, properties matching, nav). The architecture (`requireUser`/`requireRole` + `leadScope.ts`) is sound and consistently applied. But three things stand between this build and a confident full rollout — two are data-safety/trust, one is product depth.

**Must fix BEFORE full rollout (blocking):**
1. **B-01 (P0) — Lead dedup/merge.** Clean data is the foundation of pipeline trust; this is Lalit's #1 blocker (Bucket A).
2. **B-02 (P1) — `/calls` recent-calls list + QualityList agent scoping.** A live agent↔agent leak of peer BANT/budget/notes that survived Round 11 and was mis-described as scoped in the prior audit. One-line fix; high stakes.
3. **B-03 (P2) — Dashboard agent KPI-tile scope.** Agents must see their own numbers, not the team's, on their personal dashboard. Ship with B-02.

**Can wait (fix in the first week post-launch):**
- B-04 (WhatsApp team filter), B-05 ("Calls (mo)" label), B-16 (Automations hardcoded ON), B-13 (inert owner dropdown), B-14/B-15 (loading/error states + pagination/N+1), B-18 (label pass).

**Hide initially (don't expose to agents until validated):**
- **Automations/Workflows toggles** (B-16) — hide or mark "Coming soon" until bound to real state, so nobody trusts a workflow that isn't running.
- **Team-mood / voice / motivation** surfaces (B-20) — pilot with one team first.
- Anything still showing the **inert owner dropdown** (B-13) — hide for agents.

**Explain in training (known-good behaviour that looks surprising):**
- The **Sales Floor Live Feed and leaderboards are intentionally team-visible** (spec §12.2) — tell agents peers can see activity (not client details), so it doesn't feel like a leak.
- **Ownership scoping rules:** AGENT sees own only; MANAGER sees own + reports; ADMIN sees all. Set expectations so agents don't think the CRM is "hiding" leads from them.
- **BANT/qualification flow** (B-17) — train the team on what to capture and when, while the structured flow is being co-designed with Lalit.

**Bottom line:** Fix B-01, B-02, B-03 → this is ready for full team rollout. Until then, a **limited rollout** (leadership + one pilot team, with `/calls` and the Automations toggles hidden from agents) is safe and would surface real-data feedback for the AI-score and BANT work.
