# White Collar Realty CRM — Role & Permission Matrix

**Spec reference:** Master spec Section 9 (Role-based access).
**Source audited:** working tree at commit `4f7308e` (HEAD, 2026-06-03, post-B-01…B-20 wave).
**Method:** read-only audit of the committed source. The live app
(`crm.whitecollarrealty.com`) is login-gated and could **not** be clicked
through — every claim below is taken from **reading the actual route guard** at
the top of each `src/app/(app)/**/page.tsx`, the matching API handlers under
`src/app/api/**/route.ts`, and the shared ownership helpers
`src/lib/leadScope.ts` and `src/lib/auth.ts`. Inferences that could only be
confirmed by clicking are marked **(inferred from code)**. No source was edited.

Screenshots requested by the spec are marked **(screenshot to be captured
during live UAT)**.

> **Build status (HEAD `4f7308e`, 2026-06-03):** all B-01…B-20 permission and
> scoping bugs are resolved. The full wave closed: **B-02** `/calls` recent-calls
> + QualityList scoped to `userId: me.id` for agents; **B-03** dashboard agent KPI
> tiles use `meScope`/`meActWhere`/`meCallWhere`; **B-04** WhatsApp tile scoped via
> lead relation; **B-13** owner dropdown hidden from agents; **B-01** dedup probe
> `GET /api/leads/check-duplicate` ANDs in `leadScopeWhere(me)`; **B-12** nav links
> gated; **B-17** BANT pill shipped. The only two items not fully resolved: B-15
> (N+1 performance, groundwork done) and the structural half of B-17 (BANT
> stage-gating, pending Lalit co-design). See `docs/CRM_BUG_REPORT.md`.

---

## 0. How permission is enforced (the three primitives)

Everything in the matrix reduces to three building blocks. Read these first —
the per-module rows just cite which one applies.

| Primitive | File | Behaviour |
|-----------|------|-----------|
| `requireUser()` | `src/lib/auth.ts:26-30` | Any logged-in user; redirects to `/login` if no valid session. **Authentication only — not authorisation.** |
| `requireRole(...roles)` | `src/lib/auth.ts:32-36` | Logged-in **and** `role ∈ roles`, else `redirect("/dashboard")`. This is the hard role gate. |
| `leadScopeWhere(me)` / `canTouchLead` / `visibleOwnerIds` | `src/lib/leadScope.ts:28-59` | Ownership scope on lead data: **ADMIN → all** (`{}`); **MANAGER → self + recursive direct/indirect reports** (Postgres recursive CTE, lines 32-40); **AGENT → own only** (`ownerId === me.id`). Out-of-scope single-lead reads return **404, not 403** (lines 76-79) so the API never confirms a lead exists to someone who shouldn't see it. |

Property data uses the parallel helper `projectWhereForUser(me)` /
`teamToCountry` (`src/lib/propertyScope.ts`): AGENT is hard-scoped to their
team's geography (Dubai team → UAE projects, India team → India projects);
ADMIN/MANAGER default to their team but may switch via `?team=all`.

**Legend for the matrix:**
`Y` = allowed · `—` = not applicable / no such action on this module ·
`Own` = own records only (AGENT) / own + reports (MANAGER) · `Team` =
team-scoped (forwardedTeam / geography) · `N` = blocked (route redirects or API
returns 4xx) · `n/a` = capability does not exist in the product.

The role model is **ADMIN, MANAGER, AGENT** (`Role` enum). Teams are **Dubai**
(Mehak, Dinesh) and **India** (Yasir, Tanuj); Lalit is the single ADMIN.

---

## 1. Capability matrix by module

For each module: **View / Create / Edit / Delete / Export / Assign / Reassign /
View reports / View all-team data / View settings.** "View all-team data" means
"can this role see records owned by people outside their own scope?"

### 1.1 Dashboard — `src/app/(app)/dashboard/page.tsx`
Guard: `requireUser()` (`:28`). Team view via `?team=` for ADMIN/MANAGER;
AGENT locked to own team (`:41-47`).

| Cap | ADMIN | MANAGER | AGENT | Guard / note |
|-----|:--:|:--:|:--:|---|
| View | Y | Y | Y | `requireUser()` |
| Create | — | — | — | dashboard is read-only |
| Edit | — | — | — | — |
| Delete | — | — | — | — |
| Export | — | — | — | no export on this page |
| Assign | — | — | — | — |
| Reassign | — | — | — | — |
| View reports | Y (all teams) | Y (own team, toggle) | Own (fixed) | KPI tiles now use `meScope`/`meActWhere`/`meCallWhere` (`:64`) — agents see only their own numbers; ADMIN/MANAGER keep team view. (B-03 resolved) |
| **View all-team data** | Y | Team + reports | **N (fixed)** | "BY SALESPERSON" per-agent table is gated `isAdminOrMgr &&` (`:205` query, `:699-701` render). KPI tiles now scoped to `ownerId: me.id` for agents (B-03). No team-wide data visible to agents on this page. |
| View settings | Y | partial | — | "Set targets" / morning-queue links are `me.role === "ADMIN"` only (`:592`) |

### 1.2 Action List — `src/app/(app)/action-list/page.tsx`
Guard: `requireUser()` (`:82`); scope `me.role === "AGENT" ? { ownerId: me.id } : {}` (`:86`).

| Cap | ADMIN | MANAGER | AGENT | Guard / note |
|-----|:--:|:--:|:--:|---|
| View | Y (all) | Team-wide | Own | `:86` — agent sees only own leads' actions |
| Create | — | — | — | derived list, not directly authored |
| Edit (snooze/complete/escalate) | Y | Y | Own | actions route through `/api/leads/[id]/action-*`, each scoped via `loadOwnedLead`/`canTouchLead` |
| Delete | — | — | — | — |
| Export | — | — | — | — |
| Assign / Reassign | — | — | — | — |
| View reports | — | — | — | — |
| View all-team data | Y | Reports only | N | scope at `:86` |
| View settings | — | — | — | — |

### 1.3 Leads (list) — `src/app/(app)/leads/page.tsx`
Guard: `requireUser()` (`:34`) + `leadScopeWhere(me)` (`:42`).

| Cap | ADMIN | MANAGER | AGENT | Guard / note |
|-----|:--:|:--:|:--:|---|
| View | Y (all) | Own + reports | Own | `leadScopeWhere` (`:42`). Agents also have `LOST` hidden by default (`:51-53`) so rejected leads vanish from their queue. |
| Create | Y | Y | Y | `/leads/new` is `requireUser()` (`leads/new/page.tsx:15`) — agents may add leads. |
| Edit (bulk) | Y | Y | N (UI) | bulk toolbar `canBulk = ADMIN \|\| MANAGER` (`:254`) |
| Delete (bulk) | Y | Own + reports | N (UI) | `/api/leads/bulk` `deleteMany({ id:{in}, ...scope })` (`bulk/route.ts:67`) is itself scoped, but the bulk UI is admin/manager-only (`:254`). |
| **Export** | **Y only** | **N** | **N** | `/api/reports/export` = `requireRole("ADMIN")`, audited + watermarked (`reports/export/route.ts:3,8-10`). |
| Assign | Y | Y | N | initial assignment is server/round-robin or admin/manager |
| Reassign | Y | Y (own tree) | N | `/api/leads/[id]/assign` = `requireRole("ADMIN","MANAGER")` (`assign/route.ts:7`); bulk reassign gated inside its branch (`bulk/route.ts:39-40`) |
| View reports | — | — | — | (reports live under /reports) |
| **View all-team data** | Y | Own + reports | **N (fixed)** | `?owner=` is **ignored for agents** (`:72-75`); `?source=` ignored for agents (`:65`). Owner/Source dropdowns hidden via `showSource={me.role !== "AGENT"}` (`:453,459`). |
| View settings | — | — | — | — |

> **Owner dropdown fixed (B-13 resolved):** the owner `<select>` in `LeadFilters`
> is now hidden from agents behind the same `showSource` (leadership-only) flag.
> Agents no longer see peer names in the dropdown. Server-side discard of
> `?owner=` for agents remains in place as a belt-and-braces guard.

### 1.4 Lead Detail — `src/app/(app)/leads/[id]/page.tsx`
Guard: `requireUser()` (`:70`) **and** `if (!(await canTouchLead(me, lead))) redirect("/leads")` (`:113`).

| Cap | ADMIN | MANAGER | AGENT | Guard / note |
|-----|:--:|:--:|:--:|---|
| View | Y | Own + reports | Own | `canTouchLead` (`:113`); off-scope → redirect to /leads |
| Create (notes / activity / call / WA / EOI / visit / sticky) | Y | Own + reports | Own | each write API uses `loadOwnedLead` → `canTouchLead` (`src/lib/leadScope.ts:66-81`) |
| Edit (status / stage / BANT / fields) | Y | Own + reports | Own | `/api/leads/[id]/update`, `/stage` scoped via `loadOwnedLead` |
| Delete | Y | Own + reports | Own-via-bulk only | no single-lead delete button on detail; deletion is the scoped bulk path |
| Export | — | — | — | — |
| Assign / **Reassign** | Y | Y (own tree) | **N** | reassign control rendered only when `canReassign = ADMIN \|\| MANAGER` (`:145`); API `requireRole("ADMIN","MANAGER")` |
| View reports | — | — | — | — |
| View all-team data | Y | Own + reports | N | matching-units/projects scoped via `projectWhereForUser` (`:96`); unit-match scope-country is `null` for ADMIN/MANAGER, team-country for agents (`:820`) |
| View settings | — | — | — | reject/merge admin actions appear only for ADMIN/MANAGER (`:902`) |

### 1.5 Cold Data / Revival Engine — `src/app/(app)/cold-calls/page.tsx` (+ `/session`)
Guard: `requireUser()` (`:38`); `isAdminOrMgr` flag at `:47`.

| Cap | ADMIN | MANAGER | AGENT | Guard / note |
|-----|:--:|:--:|:--:|---|
| View | Y | Team | Own | cold leads scoped like leads; agents see own cold queue |
| Create / Edit | Y | Y | Own | promote-cold etc. via scoped lead APIs |
| Delete | — | — | — | — |
| **Export / bulk-assign** | Y | Y | N | `/api/cold-data/bulk-assign` (admin/manager assignment path) |
| Assign / Reassign | Y | Y | N | as Leads |
| View reports | Y | Y | Own | cooling report is agent-scoped (see §1.10) |
| View all-team data | Y | Team | N | `isAdminOrMgr` controls the team-wide widgets (`:47`) |
| View settings | — | — | — | — |

### 1.6 Pipeline (Kanban) — `src/app/(app)/pipeline/page.tsx`
Guard: `requireUser()` (`:33`) **+ `leadScopeWhere(me)`** (`:37`). **Fixed in Round 11.**

| Cap | ADMIN | MANAGER | AGENT | Guard / note |
|-----|:--:|:--:|:--:|---|
| View | Y (all) | Own + reports | **Own (fixed)** | `where = { ...scope, status:{in:stages} }` (`:38`). Was previously unscoped (old P0-1); now agents see only their own cards. |
| Create | — | — | — | board is a view over existing leads |
| Edit (drag = stage change) | Y | Own + reports | Own | stage change → `/api/leads/[id]/stage` (scoped) |
| Delete | — | — | — | — |
| Export | — | — | — | — |
| Assign / Reassign | — | — | — | — |
| **View all-team data** | Y | Own + reports | **N (fixed)** | `?owner=` honored only for non-agents (`:42-45`); `?team=` filter applies on top of scope (`:39`) |
| View settings | — | — | — | — |

### 1.7 Properties — `src/app/(app)/properties/page.tsx` (+ `/[id]`, `/new`)
List/detail guard: `requireUser()`; create/edit: `requireRole("ADMIN","MANAGER")`.

| Cap | ADMIN | MANAGER | AGENT | Guard / note |
|-----|:--:|:--:|:--:|---|
| View | Y (all geos) | Team geo (toggle) | Team geo | `projectWhereForUser(me)` (`:57`); agent hard-scoped to team country |
| Create (project/unit) | Y | Y | **N** | `/properties/new` = `requireRole("ADMIN","MANAGER")` (`new/page.tsx:9,79`); unit import `canImportUnits = ADMIN \|\| MANAGER` (`[id]/page.tsx:16`) |
| Edit | Y | Y | N | same gate |
| Delete | Y | Y | N | (inferred from code) |
| Export | — | — | — | — |
| Assign / Reassign | — | — | — | — |
| **"Matching leads" / "Active discussions"** | Y (all) | Own + reports | **Own (fixed)** | `bestLeadsForProject(id, n, leadScopeWhere(me))` on both list (`page.tsx:134-139`) and detail (`[id]/page.tsx:34-36`); `leadsForProject.ts:124` spreads `...scope`. Agents no longer see peer client names/budgets (old P2-1). |
| View all-team data | Y | Team | Team geo | — |
| View settings | — | — | — | — |

### 1.8 Activities — `src/app/(app)/activities/page.tsx`
Guard: `requireUser()` (`:96`); scope `me.role === "AGENT" ? { ownerId: me.id } : {}` (`:97-98`).

| Cap | ADMIN | MANAGER | AGENT | Guard / note |
|-----|:--:|:--:|:--:|---|
| View | Y (team-wide) | Team-wide | Own | `:97` — "Your leads, prioritised" vs "Team-wide view" (`:293`) |
| Create / Edit | Y | Y | Own | scoped activity writes |
| Delete | — | — | — | — |
| Export | — | — | — | — |
| Assign / Reassign | — | — | — | — |
| View reports | — | — | — | — |
| View all-team data | Y | Team | N | `:97-98` |
| View settings | — | — | — | — |

### 1.9 Call Records — `src/app/(app)/calls/page.tsx`
Guard: `requireUser()` (`:25`); `isAgent` flag (`:26`) scopes to `userId: me.id`.

| Cap | ADMIN | MANAGER | AGENT | Guard / note |
|-----|:--:|:--:|:--:|---|
| View | Y | Team | Own | agent sees only own call logs (`:26`); recent-calls list AND QualityList both scoped — `where: isAgent ? { userId: me.id } : {}` (B-02 resolved) |
| Create (log call) | Y | Y | Own | `/api/leads/[id]/log-call` scoped via `loadOwnedLead` |
| Edit / Delete | — | — | — | call logs are append-only (inferred from code) |
| Export | — | — | — | — |
| View all-team data | Y | Team | **N (fixed)** | B-02 closed the unscoped recent-calls list that previously leaked the latest 50 company-wide calls to agents |
| View settings | — | — | — | — |

### 1.10 Reports — `src/app/(app)/reports/*`
Mixed guards. **Confidential / cross-agent reports are `requireRole("ADMIN","MANAGER")`; personal operational reports are `requireUser()` + agent-scoped.**

| Report | Guard | ADMIN | MANAGER | AGENT |
|--------|-------|:--:|:--:|:--:|
| Reports index (`reports/page.tsx:37`) | `requireUser()` | Y | Y | Y (own data; `agentScope = me.id` at `:47`) |
| Commission (`commission/page.tsx:125`) | `requireRole("ADMIN","MANAGER")` | Y | Y | **N** |
| Sources (`sources/page.tsx:102`) | `requireRole("ADMIN","MANAGER")` | Y | Y | **N** |
| Team comparison (`team-comparison/page.tsx:348`) | `requireRole("ADMIN","MANAGER")` | Y | Y | **N** |
| YTD (`ytd/page.tsx:204`) | `requireRole("ADMIN","MANAGER")` | Y | Y | **N** |
| Daily (`daily/page.tsx:36,50`) | `requireUser()` | Y (any agent) | Team | Own (`targetUserId = me.id`) |
| SLA (`sla/page.tsx:101,104`) | `requireUser()` | Y | Team | Own (`agentScope = me.id`) |
| Travel (`travel/page.tsx:57,59`) | `requireUser()` | Y | Team | Own (`agentScope = me.id`) |
| Cooling (`cooling/page.tsx:68,70`) | `requireUser()` | Y | Team | Own (`scopedOwnerId = me.id`) |
| **CSV export** (`/api/reports/export`) | `requireRole("ADMIN")` | **Y only** | **N** | **N** |

For the agent-scoped reports the cross-agent picker is shown only when
`me.role !== "AGENT"` (e.g. `sla/page.tsx:171,213`, `travel/page.tsx:122`,
`daily/page.tsx:125`). Agents cannot pass `?agent=<peerId>` — it is overridden
to `me.id` server-side.

### 1.11 Notifications — `src/app/(app)/notifications/page.tsx`
Guard: `requireUser()` (`:8`). Per-user feed (`mark-all-read`, `[id]/snooze`).

| Cap | ADMIN | MANAGER | AGENT | Note |
|-----|:--:|:--:|:--:|---|
| View / Edit (read, snooze) | Own | Own | Own | personal notification feed |
| All other caps | — | — | — | — |

### 1.12 Settings — `src/app/(app)/settings/page.tsx`
Guard: `requireUser()` (`:44`); `isAdmin = me.role === "ADMIN"` (`:52`).

| Cap | ADMIN | MANAGER | AGENT | Guard / note |
|-----|:--:|:--:|:--:|---|
| View (own preferences) | Y | Y | Y | `requireUser()` |
| **Edit org settings** (round-robin, testing-mode, speed-to-lead, travel-rate) | **Y only** | N | N | each `/api/settings/*` write is admin-gated; UI behind `isAdmin` (`:52`). (inferred from code for per-toggle API) |
| **View settings (org-level)** | Y | partial | partial | non-admins see personal prefs only |

### 1.13 Team / Roles — `src/app/(app)/team/page.tsx` (+ `/[id]`)
Guard: **`requireRole("ADMIN","MANAGER")`** (`:26`). **Fixed in Round 11.** Detail `/team/[id]` = `requireRole("ADMIN","MANAGER")` (`[id]/page.tsx:73`).

| Cap | ADMIN | MANAGER | AGENT | Guard / note |
|-----|:--:|:--:|:--:|---|
| View (peer call counts, pipeline value, response times) | Y | Y | **N (fixed)** | agents redirected to `/dashboard`. Was previously `requireUser()` only (old P1-1). |
| Create user | Y | partial | N | (inferred from code) |
| Edit role / manager / Acefone / WhatsApp / specialization | Y | partial | N | `canEditAcefone = ADMIN` (`:92`); `canEditProfile = ADMIN \|\| MANAGER` (`:93`) |
| Delete user | Y | N | N | (inferred from code) |
| View all-team data | Y | Y | N | the whole page is the team grid |
| Nav visibility | shown | shown | **hidden** | "Team & Roles" lives in the `managerOrAdmin: true` TEAM nav group (`MobileShell.tsx:48-51,141`) — not rendered for agents |

### 1.14 Attendance — `src/app/(app)/admin/attendance/page.tsx`
Guard: `requireRole("ADMIN")` (`:17`). (Agent self check-in is the dashboard `AttendanceBadge` / `/api/attendance/mark`, scoped to self.)

| Cap | ADMIN | MANAGER | AGENT | Note |
|-----|:--:|:--:|:--:|---|
| View team attendance | Y | **N** | **N** | admin-only page |
| Mark own attendance | Y | Y | Y | via dashboard badge → `/api/attendance/mark` (self) |
| Edit/Export | Y | N | N | (inferred from code) |

### 1.15 Targets — `src/app/(app)/admin/targets/page.tsx`
Guard: `requireRole("ADMIN")` (`:22`). Set via `/api/admin/targets/set`.

| Cap | ADMIN | MANAGER | AGENT | Note |
|-----|:--:|:--:|:--:|---|
| View / Create / Edit daily targets | Y | **N** | **N** | admin-only |
| See own target | Y | Y | Y | surfaced on dashboard / daily report (read-only) |

### 1.16 Team Mood — `src/app/(app)/admin/team-mood/page.tsx`
Guard: `requireRole("ADMIN","MANAGER")` (`:39`). Aggregate signals only.

| Cap | ADMIN | MANAGER | AGENT | Note |
|-----|:--:|:--:|:--:|---|
| View aggregate mood | Y | Y | **N** | mood self-check-in is on dashboard (`MoodCheckIn` → `/api/mood`, self) |
| Submit own mood | Y | Y | Y | `/api/mood` (self) |

### 1.17 Templates — `src/app/(app)/admin/templates/page.tsx`
Guard: `requireRole("ADMIN","MANAGER")` (`:80`). Render endpoint `/api/templates/render` available to senders.

| Cap | ADMIN | MANAGER | AGENT | Note |
|-----|:--:|:--:|:--:|---|
| View / Create / Edit / Delete templates | Y | Y | **N** | admin/manager manage; `/api/admin/templates/*` |
| Use template when messaging | Y | Y | Y | rendering used in WA/email send flows |

### 1.18 Workflows — `src/app/(app)/admin/workflows/page.tsx` (+ `/[id]/runs`)
Guard: `requireRole("ADMIN")` (`:13`; runs `:68`). APIs `/api/admin/workflows/*` admin-only.

| Cap | ADMIN | MANAGER | AGENT | Note |
|-----|:--:|:--:|:--:|---|
| View / Create / Edit / Clone / Test-fire / View runs | Y | **N** | **N** | admin-only automation engine |

### 1.19 Audit Log — `src/app/(app)/admin/audit/page.tsx`
Guard: `requireRole("ADMIN")` (`:25`).

| Cap | ADMIN | MANAGER | AGENT | Note |
|-----|:--:|:--:|:--:|---|
| View audit log | **Y only** | **N** | **N** | admin-only; redirect to /dashboard otherwise |

### 1.20 Vault — `src/app/(app)/vault/page.tsx` (agent) + `src/app/(app)/admin/vault/page.tsx` (oversight)
Agent vault guard: `requireUser()` (`:11`), scoped to `userId: me.id`.
Admin vault guard: **`requireRole("ADMIN")`** (`admin/vault/page.tsx:60`).

| Cap | ADMIN | MANAGER | AGENT | Guard / note |
|-----|:--:|:--:|:--:|---|
| View own entries | Y | Y | Y | `/vault` scoped to self |
| Create / Edit own entries | Y | Y | Y | `/api/vault`, `/api/vault/[id]` (self) |
| **View other agents' full entries (incl. VENT)** | **Y** | **N** | **N** | `/admin/vault` is `requireRole("ADMIN")` (`:60`) — **ADMIN only**, despite the file header comment saying "admins/managers" (`:5`); the TEAM nav exposes "Vault (team)" only in the `adminOnly` section (`MobileShell.tsx:63`). **Intentional owner decision** (header `:1-7`). |
| Privacy copy | — | — | — | Agent-facing copy was corrected: `/vault` now reads "Your space to journal, vent, log wins, and reset" (`VaultClient.tsx:265`) and notes admin/manager review (`:5`). The earlier false "only you can see this / Nobody else" strings are **gone** — the QA privacy-contradiction is resolved. |

### 1.21 Admin/* pages (remaining)
All `requireRole("ADMIN")` unless noted: `admin/duplicates` (`:36`),
`admin/health` (`:58`), `admin/cron-health` (`:55`), `admin/integrations`
(`:102`), `admin/site-visits` (`:72`).
`admin/quality` is `requireRole("ADMIN","MANAGER")` (`:33`); managers have the
wellbeing column hidden (`hideWellbeingColumn = me.role === "MANAGER"`, `:67`).
`admin/awaiting-team` and `admin/rejected-leads` use `requireUser()` **then**
`if (me.role !== "ADMIN" && me.role !== "MANAGER") redirect("/dashboard")`
(`awaiting-team/page.tsx:18`; `rejected-leads/page.tsx:56-57`) — i.e.
ADMIN/MANAGER only.

| Page | ADMIN | MANAGER | AGENT |
|------|:--:|:--:|:--:|
| duplicates, health, cron-health, integrations, site-visits, attendance, targets, workflows, audit | Y | **N** | **N** |
| quality, team-mood, templates | Y | Y | **N** |
| awaiting-team, rejected-leads | Y | Y | **N** |
| vault (team) | Y | **N** | **N** |

### 1.22 Intake — `src/app/(app)/intake/page.tsx`
Guard: `requireUser()` (`:10`) with an in-page `isAdminOrMgr` gate (`:13,20`).

| Cap | ADMIN | MANAGER | AGENT | Guard / note |
|-----|:--:|:--:|:--:|---|
| View page | Y | Y | Y* | page loads for all, but importer is gated |
| **Run importer** (CSV / Google Sheet / WhatsApp / pre-assigned) | Y | Y | **N** | `PreAssignedImporter` rendered only when `isAdminOrMgr` (`:13,20`); APIs `/api/intake/*` (inferred admin/manager-gated for the privileged ones) |
| See API / website / WhatsApp keys | Y | Y | shown* | minor: key-copy UI is visible to agents who reach the page — consider hiding (matches QA §6 note). The TEAM/ADMIN nav does not link agents here (`MobileShell.tsx:54` is in the `adminOnly` group). (inferred from code) |

### 1.23 Peer-visible **by design** (NOT leaks) — Leaderboards & Sales Floor Live Feed
These intentionally show cross-agent data and are **correct as-is** per the
master spec (§12.2 Sales Floor Live Feed; gamified leaderboards).

| Module | Guard | Behaviour |
|--------|-------|-----------|
| Leaderboards — `src/app/(app)/leaderboards/page.tsx` | `requireUser()` (`:89`) | Gamified ranking of all agents; **peer-visible by design**. Acceptable. |
| Dashboard "Sales Floor Live" feed — `dashboard/page.tsx` (`salesFloorFeed`, `:96`) | `requireUser()` | Live team activity ticker; **intentionally peer-visible** (§12.2). Label clarity is a UX item (QA Bucket C), not a permission issue. |

---

## 2. "Agents must NOT be able to access" — verification section

This is the privacy contract the app promises on its own screens
("Agent → Own only"). Each row states the **current** status at HEAD
`4f7308e`, with the guard that enforces it.

| # | An AGENT must NOT see/do… | Current status | Enforced by | Evidence |
|---|---------------------------|----------------|-------------|----------|
| V1 | **All leads** (whole-company lead list) | ✅ **CORRECT** | `leadScopeWhere(me)` on `/leads` and `/pipeline`; `?owner=`/`?source=` ignored for agents | `leads/page.tsx:42,65,72-75`; `pipeline/page.tsx:37,42-45`; `leadScope.ts:44-49` |
| V2 | **All phone numbers / contact details** of unowned leads | ✅ **CORRECT** | single-lead access returns 404 off-scope; lists scoped; matching-leads expanders scoped | `leadScope.ts:52-59,76-79`; `leads/[id]/page.tsx:113`; `leadsForProject.ts:124`; `properties/page.tsx:134` |
| V3 | **Export data** (CSV of leads/reports) | ✅ **CORRECT** | export endpoint is **ADMIN-only**, audited + watermarked | `reports/export/route.ts:3,8-10` |
| V4 | **Admin settings** (round-robin, automations, integrations, targets, workflows, attendance) | ✅ **CORRECT** | org-setting pages/APIs are `requireRole("ADMIN")`; settings UI behind `isAdmin` | `settings/page.tsx:52`; `admin/workflows/page.tsx:13`; `admin/targets/page.tsx:22`; `admin/integrations/page.tsx:102`; `admin/attendance/page.tsx:17` |
| V5 | **Confidential reports** (commission, sources, team comparison, YTD) | ✅ **CORRECT** | each `requireRole("ADMIN","MANAGER")` → agent redirected to `/dashboard` | `reports/commission/page.tsx:125`; `reports/sources/page.tsx:102`; `reports/team-comparison/page.tsx:348`; `reports/ytd/page.tsx:204` |
| V6 | **Audit logs** | ✅ **CORRECT** | `requireRole("ADMIN")` | `admin/audit/page.tsx:25` |
| V7 | **Peers' pipeline** (other agents' Kanban / lead cards) | ✅ **CORRECT (fixed Round 11)** | `/pipeline` now scoped; `/team` now ADMIN/MANAGER; properties matching scoped | `pipeline/page.tsx:37`; `team/page.tsx:26`; `properties/[id]/page.tsx:34-36` |
| V8 | **Peers' stats** (call counts, pipeline value, response times, per-agent KPIs) | ✅ **CORRECT (fixed B-03)** | `/team` gated (ADMIN/MANAGER); dashboard "BY SALESPERSON" gated `isAdminOrMgr`; dashboard KPI tiles now use `meScope`/`meActWhere`/`meCallWhere` so agents see only their own numbers. | `team/page.tsx:26`; `dashboard/page.tsx:64` (`meScope = isAdminOrMgr ? teamScope : { ownerId: me.id }`). B-03 resolved `1f30647`. |
| V9 | **Other agents' Vault entries** | ✅ **CORRECT** | `/admin/vault` is `requireRole("ADMIN")`; agent-facing copy corrected to disclose admin review | `admin/vault/page.tsx:60`; `VaultClient.tsx:5,265` |
| V10 | **Reassign / hand off leads** | ✅ **CORRECT** | `/api/leads/[id]/assign` + bulk reassign are `requireRole("ADMIN","MANAGER")` | `assign/route.ts:7`; `bulk/route.ts:39-40` |
| V11 | **Source of a lead** (where it came from) | ✅ **CORRECT** | `?source=` ignored for agents; source dropdown hidden | `leads/page.tsx:65,453,459`; matches QA Bucket G "hide source from agents" |
| V12 | **Rejected/LOST leads in their queue** | ✅ **CORRECT** | agents' default list hides `LOST`; admin/manager retain oversight via `/admin/rejected-leads` | `leads/page.tsx:51-53`; `admin/rejected-leads/page.tsx:56-57` |
| V13 | **Team attendance / mood / quality of peers** | ✅ **CORRECT** | admin/admin-manager gated pages; self-only submission | `admin/attendance/page.tsx:17`; `admin/team-mood/page.tsx:39`; `admin/quality/page.tsx:33` |
| V14 | **Create/edit properties (catalog)** | ✅ **CORRECT** | `requireRole("ADMIN","MANAGER")` | `properties/new/page.tsx:9,79`; `properties/[id]/page.tsx:16` |

### Peer-visible **by design** (explicitly NOT in scope of the no-access list)
- **Leaderboards** (`leaderboards/page.tsx:89`) — gamified, all-agent ranking.
- **Dashboard "Sales Floor Live" feed** (`dashboard/page.tsx:96`) — live team
  activity ticker (master spec §12.2).
These are intentional and should remain visible to agents.

---

## 3. Known open items (post B-01…B-20 wave)

All permission and scoping bugs from the B-01…B-20 wave are resolved. The two items that remain are product/design co-work, not permission leaks:

- **B-15 (performance):** list-query N+1 groundwork shipped (`078b353`); low urgency at ~45 leads in prod. No privacy impact.
- **B-17 structural (BANT stage-gating):** the at-a-glance "N/4 captured" completeness pill shipped on lead detail (`5aff9a3`), but gating stage-advancement on BANT completeness has not been enforced — deliberately deferred for Lalit's co-design. No permission impact; agents can still move stages without full BANT.

Everything in §2 is **CORRECT** as of HEAD `4f7308e`.

---

## 4. UAT screenshot checklist (to attach during live testing)

The following live-login captures are required by the spec but cannot be
produced from source:

- Dashboard as AGENT vs ADMIN — confirm no "BY SALESPERSON" for agent; confirm KPI tiles show own numbers only, not team totals **(screenshot to be captured during live UAT)**
- `/pipeline` as AGENT — only own cards **(screenshot to be captured during live UAT)**
- `/team` as AGENT — redirect to `/dashboard` **(screenshot to be captured during live UAT)**
- `/leads?owner=<peerId>` as AGENT — own leads only, peer filter ignored **(screenshot to be captured during live UAT)**
- `/admin/audit`, `/admin/workflows`, `/admin/targets` as AGENT — redirect **(screenshot to be captured during live UAT)**
- `/vault` as AGENT — corrected privacy copy; `/admin/vault` as ADMIN **(screenshot to be captured during live UAT)**
- CSV export attempt as AGENT/MANAGER — blocked **(screenshot to be captured during live UAT)**
