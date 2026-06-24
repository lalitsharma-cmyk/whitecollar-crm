# White Collar Realty CRM — Full Functionality Inventory
**Audit target:** commit `64e779c`
**Audit date:** 2026-06-04
**Live URL:** https://crm.whitecollarrealty.com

---

## Page Inventory

### Core workspace pages

| Route | Description | Roles | Status |
|---|---|---|---|
| `/dashboard` | KPI cards, activity feed, per-salesperson table, pipeline overview | ALL | LIVE |
| `/leads` | Lead list with filters, bulk actions, export | ALL (scoped) | LIVE |
| `/leads/[id]` | Lead detail: timeline, call log, activities, BANT, stage mover | ALL (scoped) | LIVE |
| `/leads/new` | Manual lead creation form | ADMIN, MANAGER | LIVE |
| `/leads/inbox` | Uncontacted leads queue | ALL | LIVE |
| `/leads/overdue` | Leads with overdue follow-up dates | ALL | LIVE |
| `/leads/archived` | Archived/lost leads | ALL | LIVE |
| `/leads/kanban` | Kanban view of active leads | ALL | LIVE |
| `/pipeline` | Full-page kanban with drag-to-stage, mobile bottom-sheet mover | ALL (scoped) | LIVE |
| `/action-list` | Priority action cards — IN NEGOTIATION/EOI, Needs Attention, Overdue | ALL (scoped) | LIVE |
| `/activities` | Action board — overdue, hot, slipping, site visits, scheduled today | ALL (scoped) | LIVE |
| `/cold-calls` | Revival Engine — cold data list, hidden gems, daily mission, leaderboard | ALL (scoped) | LIVE |
| `/cold-calls/session` | Timed cold-call session mode | ALL | LIVE |
| `/call-logs` | Call log table with filters, pagination, CSV export | ADMIN, MANAGER | LIVE (BUG-015 fix) |
| `/properties` | Property portfolio list | ALL | LIVE |
| `/properties/new` | Add new property | ADMIN, MANAGER | LIVE |
| `/properties/[id]` | Property detail | ALL | LIVE |

### Reports

| Route | Description | Roles | Status |
|---|---|---|---|
| `/reports` | Reports hub + best-time-to-call heatmap | ADMIN, MANAGER | LIVE |
| `/reports/activity` | Activity feed (calls + lead updates) with date picker | ADMIN, MANAGER | LIVE |
| `/reports/leaderboard` | Agent leaderboard, 90-day window | ADMIN, MANAGER | LIVE (BUG-005, BUG-008 fix) |
| `/reports/daily` | Daily targets vs. achieved | ADMIN, MANAGER | LIVE |
| `/reports/sources` | Lead source breakdown | ADMIN, MANAGER | LIVE |
| `/reports/sla` | Speed-to-lead SLA compliance | ADMIN, MANAGER | LIVE |
| `/reports/cooling` | Cooling leads analysis | ADMIN, MANAGER | LIVE |
| `/reports/commission` | Commission calculator | ADMIN, MANAGER | LIVE |
| `/reports/team-comparison` | Dubai vs. India team comparison | ADMIN, MANAGER | LIVE |
| `/reports/travel` | India team travel reimbursement | ADMIN, MANAGER | LIVE |
| `/reports/ytd` | Year-to-date summary | ADMIN, MANAGER | LIVE |

### Admin tools

| Route | Description | Roles | Status |
|---|---|---|---|
| `/admin/users` | User management — invite, edit, deactivate/reactivate | ADMIN | LIVE (BUG-003, BUG-009 fix) |
| `/admin/templates` | WhatsApp/email template management | ADMIN | LIVE |
| `/admin/workflows` | Automation rules (engine built, no rules configured yet) | ADMIN | LIVE (unconfigured) |
| `/admin/imports` | CSV/Excel import history | ADMIN | LIVE |
| `/admin/audit` | Admin action audit log | ADMIN | LIVE |
| `/admin/health` | System health: server, cron, DB | ADMIN | LIVE |
| `/admin/integrations` | Webhooks and third-party config | ADMIN | LIVE |
| `/admin/dedup` | Duplicate lead review and merge | ADMIN | LIVE |
| `/admin/attendance` | Team attendance calendar and records | ADMIN | LIVE |
| `/admin/team-mood` | Daily mood survey results | ADMIN | LIVE |
| `/admin/quality` | Call quality scoring | ADMIN | LIVE |
| `/admin/targets` | Daily call targets per agent | ADMIN | LIVE |
| `/admin/site-visits` | All site visit logs | ADMIN | LIVE |
| `/admin/vault` | Team shared notes vault | ADMIN | LIVE |
| `/admin/ai-trial` | Bounded AI cost trial runner | ADMIN | LIVE |
| `/admin/awaiting-team` | Leads without team assignment | ADMIN, MANAGER | LIVE |
| `/admin/rejected-leads` | Rejected lead review | ADMIN | LIVE |
| `/admin/cron-health` | Cron job status | ADMIN | LIVE |

### Personal / misc pages

| Route | Description | Roles | Status |
|---|---|---|---|
| `/settings` | Personal settings, admin toggles, push notifications | ALL | LIVE (BUG-016, BUG-018 fix) |
| `/profile` | Profile photo, password change | ALL | LIVE |
| `/notifications` | In-app notification center | ALL | LIVE |
| `/team` | Team directory | ALL | LIVE |
| `/team/[id]` | Individual team member profile | ALL | LIVE |
| `/vault` | Personal vault notes | ALL | LIVE |
| `/help` | Help and onboarding docs | ALL | LIVE |
| `/intake` | Lead intake — CSV, WhatsApp, Google Sheet, website | ADMIN | LIVE |
| `/ai` | AI intelligence panel | ALL | LIVE (AI enabled flag) |
| `/leaderboards` | Quick leaderboard widget | ALL | LIVE |
| `/calls` | Call session tracker | ALL | LIVE |
| `/customers` | Won deals / customer list | ALL | LIVE |

---

## API Inventory (key endpoints)

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/attendance/mark` | POST | Auto-mark attendance on page load |
| `/api/admin/users/invite` | POST | Create new user account (ADMIN) |
| `/api/admin/users/[id]/update` | PATCH | Update user role/team (ADMIN) |
| `/api/admin/users/[id]/toggle-active` | PATCH | Deactivate/reactivate user (ADMIN) |
| `/api/call-logs/export` | GET | CSV export of call logs (role-scoped) |
| `/api/leads/[id]/stage` | POST | Move lead to a new pipeline stage |
| `/api/reports/export` | GET | Lead/Master-Data/Calls CSV export — ADMIN-only, watermarked + audited (sole export path; orphan `/api/leads/export` removed 2026-06-25) |
| `/api/intake/csv` | POST | CSV/Excel lead import |
| `/api/settings/*` | POST/PATCH | Toggle admin settings |
| `/api/push/subscribe` | POST | Register browser push subscription |
| `/api/acefone/click-to-call` | POST | Trigger Acefone call |
| `/api/ai/intelligence` | POST | AI lead intelligence |
| `/api/cron/*` | GET | Scheduled cron jobs |
| `/api/health` | GET | Build health check (commit hash) |

---

## Team / Market definition

The "team" field on a lead (`forwardedTeam`) and on a user (`team`) refers to the **market team** — Dubai or India. This is never tied to client geography (a client in India buying Dubai property is still on the Dubai market team's pipeline).
