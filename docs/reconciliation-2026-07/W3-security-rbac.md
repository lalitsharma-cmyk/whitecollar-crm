# W3 — Role-Based Access + Security / Data-Leak Audit

**Auditor:** Audit-3 (Workstreams 4 + 5)
**Date:** 2026-07-17
**Scope:** Static code audit of the authz layer for the WCR CRM (`C:\Users\Lenovo\whitecollar-crm`). Read-only. No live HTTP attacks — routes reasoned about from source. 249 API routes + page guards + scope libraries reviewed.

## TL;DR

The CRM's authorization discipline is **strong and consistent**. There is a single, well-designed chokepoint per domain (`leadScopeWhere`, `buyerScope`, `hrPermissions`, `exportPerms`, `canViewPresence`), the "404-not-403" pattern is used everywhere, `[id]` routes load-and-scope before acting, and nested `[childId]` routes verify parent ownership. Session/device/epoch handling is state-of-the-art for this codebase's needs.

- **Critical: 0**
- **High: 1** — an Authorized Admin (e.g. Sameer, `leadOpsOnly`) can reset the **Super-Admin's** password and take over the owner account. The Super-Admin trust boundary that `exportPerms`/`wipe`/`force-logout` carefully enforce is **not** enforced on the password/deactivate/role routes.
- **Medium: 2** — same root cause: deactivate + role-change routes can target the Super-Admin (owner lockout / role tampering / accomplice promotion).
- **Low: 4**, **Informational: 4**.

No anonymous/unauthenticated PII exposure was found. All named data-leak anchors (health redaction, presence 403, export/import super-admin-only, force-logout epoch) are **confirmed correctly enforced**.

---

## Auth model (as-built)

| Mechanism | File | Behaviour |
|---|---|---|
| `getCurrentUser()` | `src/lib/auth.ts:18` | Reads user **live** every request (role changes apply next request). Rejects inactive accounts, revoked/expired sessions, password-epoch-stale cookies, and non-approved devices (super-admin exempt from **device** checks only). |
| `requireUser()` | `src/lib/auth.ts:84` | Redirects to `/login` if unauthenticated. |
| `requireRole(...roles)` | `src/lib/auth.ts:90` | Checks `u.role` enum only (ADMIN/MANAGER/AGENT). Redirects to `/dashboard` if not in list. Does **not** consider `isSuperAdmin`/`leadOpsOnly`/`hrOnly`. |
| `leadScopeWhere` / `canTouchLead` / `loadOwnedLead` | `src/lib/leadScope.ts` | ADMIN=all, MANAGER=team-scoped (strict, by `forwardedTeam`), AGENT=own `ownerId`. 404 for out-of-scope. |
| `buyerScopeWhere` / `canTouchBuyer` | `src/lib/buyerScope.ts` | Market-pinned (Dubai/India). ADMIN=all, MANAGER=org subtree, AGENT=own+ASSIGNED. Non-market users get an impossible filter. |
| `canExportData` / `canImportData` | `src/lib/exportPerms.ts` | `isSuperAdmin === true` **only**. |
| `hrRoleOf` + `permissionsFor` + `hrScopeWhere` | `src/lib/hrPermissions.ts` | ADMIN/SENIOR_HR=all candidates, JUNIOR_HR=own only. Non-HR → sees nothing. |
| `canViewPresence` | `src/lib/presence.ts:153` | `role==="ADMIN" && !hrOnly`. |
| Session token | `src/lib/session.ts` | HMAC-SHA256 signed cookie, constant-time verify, 30-day TTL, optional `sid` → DB-backed `UserSession`. |

**No global `middleware.ts` exists** — every route self-guards. This was verified: page layer (`(app)/layout.tsx` requires login; all 32 `/admin` pages carry an explicit role/redirect guard) and API layer are independently gated.

**Flag semantics (important):** `leadOpsOnly` (Sameer) is a **UI + voice-broadcast** flag, **not** a data-scope reduction. A `leadOpsOnly` ADMIN has full ADMIN data powers (master-data bulk, lead bulk reassign/status, user management, routing rules, presence, operations-revert) and is blocked only from: voice broadcast, escalation-recipient routing, some nav items, and super-admin-only actions (export/import/wipe). This is by design (he is the data admin) but means "lead-ops" does not narrow his blast radius — see findings.

---

## (A) RBAC Matrix

Legend: ✅ allowed · ⛔ denied (redirect/403/404) · ⚠️ GAP (allowed but shouldn't be, see findings) · n/a not applicable

### Roles
- **SA** = Super Admin (Lalit): role ADMIN, `isSuperAdmin=true`
- **AA** = Authorized Admin: role ADMIN, `isSuperAdmin=false`, `leadOpsOnly=false`
- **SM** = Sameer: role ADMIN, `leadOpsOnly=true`, `isSuperAdmin=false`
- **MG** = Manager: role MANAGER (team-scoped)
- **AG** = Agent: role AGENT (owner-scoped)
- **HR** = HR-only (Nisha SENIOR_HR = MANAGER+hrOnly; JUNIOR_HR = AGENT+hrOnly)
- **OUT** = logged-out / expired session

| Capability | SA | AA | SM | MG | AG | HR | OUT |
|---|---|---|---|---|---|---|---|
| Log into CRM `(app)` shell | ✅ | ✅ | ✅ | ✅ | ✅ | ➡️ `/hr` | ⛔ |
| See ALL leads (both teams) | ✅ | ✅ | ✅ | ⛔ team-only | ⛔ own-only | ⛔ | ⛔ |
| See another agent's leads | ✅ | ✅ | ✅ | team subtree | ⛔ | ⛔ | ⛔ |
| Global search (`/api/quick-search`) | all | all | all | team/subtree | own | ⛔ (non-lead) | ⛔ |
| Dubai/India Buyer Data | ✅ | ✅ | ✅ | own-team subtree | own+ASSIGNED (own team) | ⛔ | ⛔ |
| Single-lead edit / log call / note | ✅ | ✅ | ✅ | team | own | ⛔ | ⛔ |
| Single-lead assign (`[id]/assign`) | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ | ⛔ |
| Bulk reassign / delete / status / followup | ✅ | ✅ | ✅ | ⛔ (403) | ⛔ (403) | ⛔ | ⛔ |
| Bulk tag / reject (own-scoped) | ✅ | ✅ | ✅ | team | own | ⛔ | ⛔ |
| Master Data bulk actions | ✅ | ✅ | ✅ | ⛔ (403) | ⛔ (403) | ⛔ | ⛔ |
| Soft-delete / wipe leads | ✅ | ⛔ super-only | ⛔ | ⛔ | ⛔ | ⛔ | ⛔ |
| **Export / Import** (leads/buyers/reports/calls) | ✅ | ⛔ (403) | ⛔ (403) | ⛔ | ⛔ | HR-scoped only | ⛔ |
| Operations revert (`/admin/operations`) | ✅ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ |
| Reports (agent-perf, leaderboard) | all | all | all | own team | self only | ⛔ | ⛔ |
| Reports (commission/sources/ytd/team-comp) | ✅ | ✅ | ✅ | ✅ | ⛔ | ⛔ | ⛔ |
| Presence overview + history | ✅ | ✅ | ✅ | ⛔ (403) | ⛔ (403) | ⛔ (403) | ⛔ (401) |
| Routing rules CRUD | ✅ | ✅ | ✅ | ⛔ (403) | ⛔ | ⛔ (403) | ⛔ |
| Voice broadcast (send) | ✅ | ✅ | ⛔ (leadOps) | ⛔ | ⛔ | ⛔ | ⛔ |
| Invite user / change role / team | ✅ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ |
| Reset **another** user's password | ✅ | ✅ | ✅ | ⛔ | ⛔ | ⛔ | ⛔ |
| Reset the **Super-Admin's** password | ✅ | ⚠️ **F1** | ⚠️ **F1** | ⛔ | ⛔ | ⛔ | ⛔ |
| Deactivate the **Super-Admin** | ✅ | ⚠️ **F2** | ⚠️ **F2** | ⛔ | ⛔ | ⛔ | ⛔ |
| Demote Super-Admin role / promote accomplice→ADMIN | ✅ | ⚠️ **F3** | ⚠️ **F3** | ⛔ | ⛔ | ⛔ | ⛔ |
| Force-logout the Super-Admin | ✅ | ⛔ (403) ✅good | ⛔ (403) ✅good | ⛔ | ⛔ | ⛔ | ⛔ |
| HR candidates (view all) | ✅ | ✅ | ✅ (role ADMIN) | ⛔ unless hrOnly | ⛔ | SENIOR=all / JUNIOR=own | ⛔ |
| HR reports / import / export | ✅ | ✅ | ✅ | ⛔ | ⛔ | SENIOR ✅ / JUNIOR ⛔ | ⛔ |
| `/api/health` lead count | ✅ | ✅ | ✅ | ✅ | ✅ (any logged-in) | ✅ | ⛔ redacted |

Note: `set_team` bulk (`leads/bulk`) allows MG but forbids moving leads out of the manager's own team (`route.ts:519`). Buyer market seam is enforced both ways in `canTouchBuyer` (no Dubai↔India passport/financial crossover).

---

## (B) Findings

### F1 — HIGH · Authorized/lead-ops Admin can reset the Super-Admin's password (account takeover)
- **Route:** `src/app/api/admin/users/[id]/password/route.ts:13-33`
- **Who can reach it:** any role-ADMIN caller (Sameer `leadOpsOnly`, any future Authorized Admin, or an `hrTeam` ADMIN). `requireRole("ADMIN")` is the only gate.
- **What happens:** the route sets an arbitrary new `passwordHash` for **any** `targetId` — including Lalit's super-admin account — then revokes his sessions and bumps his epoch. There is **no** `target.isSuperAdmin && !me.isSuperAdmin` guard and **no** `hrOnly` exclusion.
- **Repro (described):** Sameer (authenticated ADMIN) issues `POST /api/admin/users/<lalit-user-id>/password` with `{ "newPassword": "attacker-set-value" }`. Response `{ ok: true }`. Sameer now knows Lalit's password, logs in as the Super-Admin, and inherits `isSuperAdmin` powers: export/import all lead+buyer+call data, wipe leads, force-logout anyone, revert operations.
- **Why it matters:** `isSuperAdmin` is never settable via any API (verified — read-only, DB/script-only), and the entire `exportPerms`/`wipe-leads`/`force-logout` architecture exists to keep exactly these powers away from Sameer. This route defeats that boundary by letting a lower-privileged admin *become* the owner. The **sibling** `sessions` route already implements the correct guard (`route.ts:171` → 403 when a non-super-admin targets a super-admin); password does not.
- **Expected:** a non-super-admin ADMIN cannot reset a super-admin's password (403), mirroring the sessions route. Ideally also exclude `hrOnly` callers.
- **Fix:** load `target.isSuperAdmin`; `if (target.isSuperAdmin && !me.isSuperAdmin) return 403`. Add `if (me.hrOnly) return 403`. (Same three-line guard the sessions route uses.)

### F2 — MEDIUM · Authorized/lead-ops Admin can deactivate the Super-Admin (owner lockout / DoS)
- **Route:** `src/app/api/admin/users/[id]/toggle-active/route.ts:12-37`
- **Guard present:** caller cannot deactivate **themselves** (`id === me.id`). **Missing:** super-admin-target and `hrOnly` guards.
- **Repro:** Sameer `PATCH /api/admin/users/<lalit-id>/toggle-active` → `active=false`, all Lalit's sessions revoked. On Lalit's next request `getCurrentUser` returns null (`auth.ts:24`) and login is refused for an inactive account (`auth.ts:102`). The owner is locked out until a DB/script fix.
- **Expected vs actual:** the owner account should not be disableable by a subordinate admin; actual = it is.
- **Fix:** `if (target.isSuperAdmin && !me.isSuperAdmin) return 403;` (+ optional `hrOnly` exclusion).

### F3 — MEDIUM · Admin can demote the Super-Admin's role / promote an accomplice to ADMIN
- **Route:** `src/app/api/admin/users/[id]/update/route.ts:14,43`
- **What happens:** any ADMIN can PATCH any user's `role`. Two abuses: (a) demote Lalit to AGENT — his `isSuperAdmin` stays true but `requireRole("ADMIN")` now redirects him out of every admin page/API, crippling owner access; (b) promote a colluding AGENT to ADMIN, who then executes **F1** for a full takeover chain.
- **Note:** `isSuperAdmin` itself is **not** settable here (only `role`/`team`), so this cannot self-mint a super-admin directly — it is an enabler, not a direct escalation.
- **Fix:** block role changes where `target.isSuperAdmin && !me.isSuperAdmin`. Consider requiring super-admin to create/most other ADMINs, or at least auditing + alerting on ADMIN promotions.

> F1–F3 share one root cause and one fix pattern: **the user-management mutation routes (`password`, `toggle-active`, `update`, and by extension `manager`/`whatsapp-number`/`acefone`) do not replicate the Super-Admin-target guard that the `sessions` route already proves is the intended standard.** Recommend a shared `assertCanManageUser(me, target)` helper applied across the `admin/users/[id]/*` family.

### F4 — LOW · WhatsApp side-panel gives Managers unscoped (cross-team) lead names + phones
- **Route:** `src/app/api/wa/recent-leads/route.ts:11-12`
- **Detail:** `scope = me.role === "AGENT" ? { ownerId: me.id } : {}` — a MANAGER (and admin) gets `{}` = **all** leads, not their team. Returns 25 most-recently-touched leads' name + phone. Inconsistent with `leadScopeWhere` (managers are team-scoped everywhere else). A Dubai manager sees India leads' PII here.
- **Fix:** use `await leadScopeWhere(me)` instead of the hand-rolled scope.

### F5 — LOW · Manager can edit any user's profile fields (no report-scoping)
- **Route:** `src/app/api/admin/users/[id]/profile/route.ts:20` (`requireRole("ADMIN","MANAGER")`)
- **Detail:** a MANAGER can PATCH `specializations` + `dailyCallTarget` for **any** user id, including other teams' agents/managers/admins — not restricted to their own reports. Low-sensitivity fields, audited, but violates the team-scoping model.
- **Fix:** for MANAGER, verify `target.managerId === me.id` (or same team) before write.

### F6 — LOW · `/api/calendar.ics` token never expires or rotates
- **Route:** `src/app/api/calendar.ics/route.ts:28-50`
- **Detail:** auth is a static `userId.HMAC(userId, NEXTAUTH_SECRET)`. It is a permanent bearer token — no expiry, no per-user rotation, no revocation. If a subscription URL leaks (calendar apps store it in plaintext, sync to third parties), it grants indefinite read of that user's follow-ups + lead names/phones/todos. Documented as "treat like a secret."
- **Fix:** include a rotating component (e.g. `sessionEpoch` or a dedicated `calendarTokenVersion`) in the HMAC input so a reset invalidates old feed URLs.

### F7 — LOW · `/api/health` returns raw DB error string to anonymous callers on failure
- **Route:** `src/app/api/health/route.ts:38` — catch returns `error: String(e)`.
- **Detail:** the happy path is correctly redacted (anon gets `{ok,commit,ts}`; count only to logged-in — **confirmed good**). But on a DB error the 500 body includes the raw exception, which can disclose driver/host/connection detail to an unauthenticated caller during an outage.
- **Fix:** return a generic `error: "db_unreachable"` for anon; keep detail server-side/logs only.

### F8 — INFORMATIONAL · Login rate-limit is in-memory (per-instance)
- **Files:** `src/app/api/login/route.ts:49`, `src/lib/rateLimit.ts` (`Map`, 5 hits / 5 min per IP+email).
- **Detail:** on Vercel serverless each instance holds its own `Map`, so the effective global limit is higher than 5 and resets on cold starts. Mitigated by bcrypt cost + device-approval gate. Consider a durable store (Postgres/Upstash) if credential-stuffing becomes a concern.

### F9 — INFORMATIONAL · `/api/resources/[id]/file` is public by unguessable cuid (capability model)
- **Route:** `src/app/api/resources/[id]/file/route.ts` — no session; possession of the cuid link = authorization. **By design** for shareable marketing collateral, documented, and every access is audit-logged with IP. Only a risk if sensitive material is ever stored as a FILE resource (the code comment warns against this). No action needed beyond honouring that rule.

### F10 — INFORMATIONAL · Intake webhooks use `Access-Control-Allow-Origin: *`
- **Routes:** `intake/lead`, `intake/website`, etc. CORS is wide-open, but auth is the `IntakeKey` (validated + active-checked + HR-scope-checked), not origin. Correct for a public webhook. Noted for completeness.

### F11 — INFORMATIONAL · Sameer (`leadOpsOnly`) retains full ADMIN data + user-management powers
- Not a code defect, but a governance note: "lead-ops" does not reduce Sameer's data scope. He can run master-data/lead bulk ops, manage users (including F1–F3), routing rules, and view presence. If the intent is a *narrower* data-admin role, `leadOpsOnly` would need to gate more than broadcast/nav.

---

## POSITIVE ASSURANCES (verified correct in code)

1. **Health redaction** (`health/route.ts:31-36`) — anonymous callers get only `{ok,commit,ts}`; the total lead count is returned **only** to a logged-in user. Matches the P3/G1 fix (15d659a). ✅
2. **Presence APIs** (`admin/presence/route.ts:26`, `admin/presence/history/route.ts:21`) — `canViewPresence` = `ADMIN && !hrOnly`; explicit **403** for managers/agents/HR, **401** for signed-out (never an empty 200). Every access audit-logged. Matches this session's presence build. ✅
3. **Export / Import super-admin-only** — all six export routes (`reports/*`, `call-logs/export`, `buyer-data/export`) and the import routes (`intake/csv`, `buyer-data/import`) funnel through `canExportData`/`canImportData` = `isSuperAdmin`. A regular ADMIN (Sameer) is 403. Matches `regression export-import-owner-only`. ✅
4. **Force-logout + password epoch** (`admin/users/[id]/sessions/route.ts`) — DELETE-all revokes sessions **and** stamps `passwordChangedAt` (kills legacy no-sid cookies) + bumps `sessionEpoch`; per-request `getCurrentUser` re-validates the session row, epoch, and device. Super-admin is protected from non-super force-logout (`:171`). Self/admin password change revokes all sessions (`profile/password`, `admin/.../password`). Matches 1adb007/5ea2b12. ✅
5. **Legacy-cookie / device epoch** (`auth.ts:65-80`) — no-sid legacy cookies die once a password epoch is set or under enforcement; super-admin exempt from **device** binding only (documented lockout backstop, Informational by design). ✅
6. **IDOR protection** — every single-record route loads the record and scope-checks before acting:
   - Leads: `loadOwnedLead` / `canTouchLead` (404, never 403) across all `/api/leads/[id]/*` incl. `reject`, `promote`, `delete` (super-admin), `update`.
   - Nested child ids verified against parent: `leads/[id]/calls/[callId]` checks `call.leadId === id` (`:37`); same pattern for activities/notes/escalation/voice.
   - Buyers: `canTouchBuyer` on `[id]/update`, `[id]/history`, etc. (market + ownership).
   - Generic: `saved-filters/[id]` (owner-or-admin), `notifications/[id]/snooze` (WHERE userId), `vault/[id]` (WHERE userId, admin no special access), `resources/[id]` (`canManageResource`). ✅
7. **Global search** (`quick-search/route.ts`) — leads via `leadScopeWhere`, buyers via `buyerSearchScope`, projects via `projectWhereForUser`; capped `take:`. No cross-agent, cross-market, or pool leak to an agent. ✅
8. **Reports scoping** — `agent-performance/[agentId]` redirects an AGENT viewing anyone but themselves (`:111`) and a MANAGER viewing outside their team (`:122`); `leaderboard` blocks AGENT entirely (`:28`); export routes are super-admin-only. ✅
9. **Bulk actions** — reassign/delete/set_status/set_followup/set_fields/recalc_currency all re-gate to `role==="ADMIN"` (delete → `isSuperAdmin`) **inside** their branch and intersect ids with `leadScopeWhere`; agent-safe actions (tag/reject) are scoped to owned leads. Matches `bulk-actions-admin-only`. ✅
10. **HR RBAC** — `hrApiAuth` returns 404 for non-HR; `requireHrPermission` gates import/export/manageUsers/bulk; `loadOwnedCandidate` + `hrActiveScopeWhere` scope JUNIOR_HR to owned candidates; HR-only admins excluded from CRM session controls. ✅
11. **Routing rules** (`admin/routing-rules/shared.ts:20`) — `requireRoutingAdmin` = `ADMIN && !hrOnly`, 403 otherwise. ✅
12. **`isSuperAdmin` is read-only** — grep confirms no API assigns it; the flag can only be set via DB/script, so no route can self-mint owner privileges. ✅
13. **Login** — bcrypt compare, generic "Invalid credentials" (no user enumeration), rate-limited, device-gated, audited; password routes revoke all sessions on change. ✅

---

## Recommended priority
1. **F1 (High)** — add the Super-Admin-target guard to `admin/users/[id]/password` immediately; it is a three-line change and closes an owner-account-takeover path.
2. **F2 + F3 (Medium)** — same guard on `toggle-active` and `update` (and the rest of the `admin/users/[id]/*` family) via a shared `assertCanManageUser(me, target)` helper.
3. **F4, F5 (Low)** — swap hand-rolled scopes for `leadScopeWhere` / add report-scoping.
4. **F6, F7 (Low)** — rotate the ICS token on password/epoch change; redact anon health errors.

No Critical issues. The only High is an insider privilege-escalation (requires an already-authenticated ADMIN), not an anonymous exposure.
