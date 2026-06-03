# White Collar Realty CRM — Role Permission Matrix
**Audit target:** commit `64e779c`
**Audit date:** 2026-06-04
**Roles:** ADMIN, MANAGER, AGENT
**Note:** "Team" refers to market team (Dubai or India), never client geography.

---

## Role definitions

| Role | Description |
|---|---|
| ADMIN | Full system access, all admin tools, all team data, all settings toggles |
| MANAGER | Team-scoped access, reports, call logs for own team, action list (all leads in scope) |
| AGENT | Own leads only, no reports, no admin tools, no call-logs page |

---

## Page access matrix

| Page | ADMIN | MANAGER | AGENT |
|---|---|---|---|
| `/dashboard` | Full (all teams) | Team-scoped | Own stats only |
| `/leads` | All leads | All leads (scoped by leadScopeWhere) | Own leads only |
| `/leads/[id]` | Any lead | Scoped | Own lead only |
| `/leads/new` | Yes | Yes | No |
| `/pipeline` | All | Scoped | Own |
| `/action-list` | All | Scoped | Own |
| `/activities` | All | Scoped | Own |
| `/cold-calls` | All (admin view) | All (admin view) | Own assigned only |
| `/call-logs` | All + filters | Own team | Redirect to /dashboard |
| `/properties` | All | All | All |
| `/properties/new` | Yes | Yes | No |
| `/reports` | Yes | Yes | No (redirect) |
| `/reports/leaderboard` | Yes | Yes | Redirect to /dashboard |
| `/reports/activity` | Yes | Team-scoped | No |
| `/reports/*` | Yes | Yes | No |
| `/settings` | Full (admin blocks visible) | Partial (admin blocks hidden) | Personal sections only |
| `/admin/users` | Yes | No | No |
| `/admin/*` | Yes | No (except awaiting-team) | No |
| `/admin/awaiting-team` | Yes | Yes | No |
| `/profile` | Yes | Yes | Yes |
| `/notifications` | Yes | Yes | Yes |
| `/vault` | Yes | Yes | Yes |
| `/help` | Yes | Yes | Yes |
| `/team` | Yes | Yes | Yes |
| `/intake` | Yes | No | No |
| `/ai` | Yes | Yes | Yes (if AI enabled) |

---

## Settings access matrix

| Setting | ADMIN | MANAGER | AGENT |
|---|---|---|---|
| Admin tools grid (Users, Templates, Workflows, etc.) | Visible | Hidden | Hidden |
| Testing mode toggle | Yes | No | No |
| Round-robin toggle | Yes | No | No |
| Speed-to-lead toggle | Yes | No | No |
| BANT gate toggle | Yes | No | No |
| Travel rate editor | Edit | View | View |
| Daily motivation toggle | Yes | No | No |
| Festival theme panel | Yes | No | No |
| AI Features toggle | Yes | No | No |
| Calendar ICS URL | Own | Own | Own |
| Push notification settings | Own | Own | Own |
| Notification preferences | Own | Own | Own |
| Onboarding tour reset | Own | Own | Own |

---

## API guard patterns

| Guard | Implementation | Used on |
|---|---|---|
| Any authenticated user | `requireUser()` | Most pages and APIs |
| ADMIN only | `requireRole("ADMIN")` | `/admin/*` routes, invite/toggle-active APIs |
| ADMIN or MANAGER | `requireRole("ADMIN", "MANAGER")` | Activity feed, reports |
| AGENT redirect | Manual `if (me.role === "AGENT") redirect(...)` | Leaderboard, Call Logs |
| Lead ownership scope | `leadScopeWhere(me)` / `canTouchLead(me, lead)` | Lead detail, pipeline |
| Manager team scope | `normalizeTeam(me.team)` | Call logs, leaderboard, manager-scoped queries |

---

## Nav visibility (MobileShell)

| Nav item | ADMIN | MANAGER | AGENT |
|---|---|---|---|
| Dashboard | Yes | Yes | Yes |
| Leads | Yes | Yes | Yes |
| Revival Engine | Yes | Yes | Yes |
| Action List | Yes | Yes | Yes |
| Properties | Yes | Yes | Yes |
| Vault | Yes | Yes | Yes |
| Reports | Yes | Yes | Hidden (agentHidden) |
| Call Logs | Yes | Yes | Hidden (agentHidden) |
| Team & Roles | Yes | Yes | No |
| Awaiting Team | Yes | Yes | No |
| Lead Intake | Yes | No | No |
| Profile / Settings / Help | Yes | Yes | Yes |
