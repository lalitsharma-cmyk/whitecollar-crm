# API Reference

> The important HTTP routes grouped by area, with method, auth/gating, and purpose.
> Routes live under `src/app/api/**` (Next.js App Router — the folder path *is* the
> URL). There are ~235 route files in total; this documents the significant ones by
> group. For scheduled `/api/cron/*` routes see [CRON_JOBS.md](./CRON_JOBS.md).

## Auth / gating legend

- **Session** — cookie `wcr_session` via `getCurrentUser()` / `requireUser()` /
  `requireRole(...)`. Roles read live; device-binding enforced per request.
- **Session + ownership** — session **and** record scope (agent = own, manager =
  team, admin = any) via `loadOwnedLead` / `canTouchBuyer` / `loadOwnedCandidate`.
  Out-of-scope returns 401/404.
- **CRON_SECRET bearer** — `Authorization: Bearer ${CRON_SECRET}`. Note: most cron
  routes **skip the check when `CRON_SECRET` is unset** (the exception is
  `db-backup`, which fails closed). Set `CRON_SECRET` in production.
- **Public (intake key)** — no session; validates an `X-WCR-Key` / `?key=` against
  the `IntakeKey` table.
- **Public** — no gating (health, warm) or its own HMAC/token (webhooks, signed
  feeds).

**Privilege tiers worth noting:** Super-Admin-only = lead delete/restore,
`admin/wipe-leads`, bulk delete, master-data soft-delete, import-history purge.
Lalit-only (`canControlConversations` / `canSendBroadcast`) = voice broadcast, lead
remark-control.

## Intake (public, key-gated unless noted)

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/intake/lead` | POST | Public (intake key; rejects HR keys) | Universal one-endpoint lead intake; source from key; dedupe + auto-classify + auto-assign |
| `/api/intake/website` | POST | Public (key, source=WEBSITE) | Website contact-form lead intake |
| `/api/intake/whatsapp` | GET, POST | GET public (Meta verify); POST public (key optional) | Inbound WhatsApp → lead + message + rescore |
| `/api/intake/meta` | GET, POST | GET public (verify); POST public (HMAC via `META_APP_SECRET`) | Meta/Facebook + Instagram Lead Ads webhook |
| `/api/intake/email` | POST | Public (parses inbound email) | Inbound-email → lead (99acres/MagicBricks/Housing + generic) |
| `/api/intake/hr` | POST | Public (key with `hrScope=true`) | Website → HR candidate intake |
| `/api/intake/csv` | POST | **Session (ADMIN)** | CSV/XLSX lead import (`?preview=1` dry-run) |
| `/api/intake/google-sheet` | POST | **Session (ADMIN)** | Google-Sheet URL lead import |
| `/api/intake/history/[id]` | POST | **Session (ADMIN; purge = Super-Admin)** | Rollback/restore/purge an import batch (reversible) |

## Leads (`/api/leads/*`) — Session + ownership

The lead detail is served by a large family of routes. Highlights:

| Route | Method | Gating | Purpose |
|---|---|---|---|
| `/api/leads/[id]/update` | PATCH | Ownership; per-field (PII/source/team/owner → ADMIN/MANAGER) | Whitelisted inline edit + routing + BANT gate |
| `/api/leads/[id]/stage` | POST | Ownership; BANT hard-gate (422) | Change status + timeline + rescore |
| `/api/leads/[id]/log-call` | POST | Ownership | Log call + outcome, NEW→CONTACTED, rescore, XP |
| `/api/leads/[id]/meeting` | POST | Ownership (agent 7-day cap) | Log/reschedule meeting or site visit |
| `/api/leads/[id]/visit` | POST/PATCH/PUT | Ownership; PATCH/PUT require attendee = you | Site-visit lifecycle (GPS-mandatory start) |
| `/api/leads/[id]/note`, `/notes*` | POST/PATCH/DELETE | Ownership; edit = `canEditRemark` | Notes + timeline; bulk historical notes = ADMIN |
| `/api/leads/[id]/reject` | POST | Ownership | Reject → LOST, unassign (keep previous owner), Revival tag |
| `/api/leads/[id]/reactivate` | POST | ADMIN/MANAGER | Reactivate LOST/rejected → fresh lead |
| `/api/leads/[id]/assign` | POST | ADMIN/MANAGER (manager team-scoped) | Manual reassign |
| `/api/leads/[id]/delete`, `/restore` | POST | **Super-Admin** | Soft-delete / restore a lead |
| `/api/leads/[id]/escalation*` | POST | Ownership (replies ADMIN/MANAGER) | Voice escalation threads (audio ≤5MB) |
| `/api/leads/[id]/voice-message` | POST | **ADMIN** | Manager voice guidance (Channel ①) |
| `/api/leads/[id]/remark-control` | POST/PATCH/GET | POST/GET Lalit-only; PATCH ADMIN | Conversation moderation / raw-history edit (never destroys text) |
| `/api/leads/[id]/cma` | GET | Ownership | Smart CMA (JSON or branded PDF) |
| `/api/leads/bulk` | POST | Per-action (reassign/status/team = ADMIN/MANAGER; delete = Super-Admin) | Bulk lead operations |
| `/api/leads/bulk-wa`, `/bulk-email` | POST | Session / ADMIN-MANAGER | Bulk WhatsApp draft links / bulk email |
| `/api/leads/check-duplicate` | GET | Session (scoped) | Read-only dedup probe |

## Buyer data (`/api/buyer-data/*`) — Session + `canTouchBuyer`

| Route | Method | Gating | Purpose |
|---|---|---|---|
| `/api/buyer-data/import` | POST | **ADMIN** | Buyer import (init + chunked); passport/financial data |
| `/api/buyer-data/export` | GET, POST | **ADMIN** (watermarked) | Buyer CSV/XLSX export |
| `/api/buyer-data/assign` | POST | ADMIN/MANAGER | Assign pool buyers → agent (bulk) |
| `/api/buyer-data/distribute` | POST, GET | ADMIN/MANAGER | Rule-based distribution (preview/apply) |
| `/api/buyer-data/bulk` | POST | Per-action (transfer ADMIN/MANAGER; delete ADMIN) | Buyer list bulk actions |
| `/api/buyer-data/[id]/convert` | POST | Assigned agent or ADMIN | Convert buyer → real Lead |
| `/api/buyer-data/[id]/activity` | POST | Scoped | Log contact; auto-return-to-pool at 5 attempts |
| `/api/buyer-data/[id]/reject` / `/return-to-pool` / `/reactivate` | POST | Scoped (reactivate = ADMIN) | Buyer lifecycle transitions |

## Telephony

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/telephony/webhook` | POST, GET | Public (HMAC and/or `?token`) | Provider-agnostic call-event receiver; audit + idempotent record + retry queue |
| `/api/telephony/click-to-call` | POST | Session + ownership; 503 if unconfigured | Click-to-call for a lead or buyer |
| `/api/telephony/recording/[callId]` | GET | Session; own linked record or ADMIN/MANAGER | Stream recording (`?download=1`) |
| `/api/acefone/webhook`, `/click-to-call` | POST | Public (`?token`) / Session | Legacy Acefone provider |

See [TELEPHONY.md](./TELEPHONY.md).

## AI (`/api/ai/*`)

Two families coexist. The **AI Sales OS** set gates on the `ai.enabled` DB setting
(403 when off) — read-only except `apply`:

| Route | Method | Access | Writes? |
|---|---|---|---|
| `/api/ai/analyze` | GET | Session (scoped) | no |
| `/api/ai/matches` | GET | Session (scoped) | no |
| `/api/ai/memory` | GET | Session (scoped) | no |
| `/api/ai/data-quality` | GET | ADMIN | no (suggests) |
| `/api/ai/digest` | GET | ADMIN | no |
| `/api/ai/apply` | POST | ADMIN | **yes — reversible, whitelisted, audited** |
| `/api/ai/engine-status` | GET | ADMIN (ungated) | no |

The **live dashboard/trial** set uses an `aiEnabled()` short-circuit: `/api/ai/chat`,
`/api/ai/health`, `/api/ai/intelligence/[leadId]`, `/api/ai/morning-message`,
`/api/ai/motivate`, and the `/api/ai/trial/*` lifecycle (create/confirm/step/pause/
stop/clear/report — ADMIN/MANAGER). See [AI.md](./AI.md).

## Admin & Settings

Admin routes (`/api/admin/*`) are **ADMIN** unless noted. Key ones:

| Route | Method | Gating | Purpose |
|---|---|---|---|
| `/api/admin/users/invite` | POST | ADMIN | Create user with hashed temp password |
| `/api/admin/users/[id]/update` | PATCH | ADMIN | Change role/team (revokes sessions) |
| `/api/admin/users/[id]/password` | POST | ADMIN | Admin-set password (bumps epoch, revokes sessions) |
| `/api/admin/users/[id]/acefone` | PATCH | ADMIN | Map telephony extension |
| `/api/admin/devices` | POST | ADMIN | Approve/reject/block/remove devices |
| `/api/admin/identity/link` | POST | ADMIN | Link duplicate leads into one virtual customer (reversible) |
| `/api/admin/leads/merge` | POST | ADMIN | Merge duplicate leads into a master |
| `/api/admin/agent-leave` | POST | ADMIN | Mark agent on/off leave |
| `/api/admin/telephony` | GET, POST | ADMIN | Telephony console (status / sync / retry / replay) |
| `/api/admin/assistant/preview\|execute\|undo` | POST | ADMIN | NL bulk ops (rule-based): preview → execute → undo |
| `/api/admin/wipe-leads` | POST | **Super-Admin + Testing Mode ON + confirm phrase** | Destructive test-only wipe |
| `/api/master-data/bulk` | POST | ADMIN (soft_delete = Super-Admin) | Master Data bulk lead ops (reversible) |

Settings routes (`/api/settings/*`, all **ADMIN**) each flip one DB setting:
`ai` (kill-switch/trial/cap), `automation`, `bant-gate`, `buyer-distribute`,
`motivation-pilot`, `round-robin`, `speed-to-lead`, `testing-mode`, `travel-rate`.
See [ADMIN_SETTINGS.md](./ADMIN_SETTINGS.md).

## Reports / Export

| Route | Method | Gating | Purpose |
|---|---|---|---|
| `/api/reports/export` | GET, POST | **ADMIN** (watermarked) | Leads/Revival/Calls/Master CSV/XLSX (mirrors /leads filters) |
| `/api/reports/agent-performance/export` | GET | **ADMIN** | Agent-performance CSV/XLSX |
| `/api/reports/buyer-performance/export` | GET | **ADMIN** | Buyer-performance CSV/XLSX |
| `/api/reports/daily/pdf` | GET | ADMIN/MANAGER | Daily one-page PDF (manager cross-team blocked) |
| `/api/call-logs/export` | GET | Session (row-scoped) | Call-logs CSV (agent own / manager team / admin all) |

See [REPORTS.md](./REPORTS.md).

## HR (`/api/hr/*`)

Gated by HR RBAC (`hrApiAuth` + `hrPermissions`), candidate-ownership scoped. Notable:
candidate CRUD (`/api/hr/candidates*`), interview lifecycle, follow-ups, voice,
resume upload (≤5MB, sha256 dedup), `import` (`importData`), `export` (`exportData`),
`extract-resume` (AI vision, needs `ANTHROPIC_API_KEY` + AI live), and HR user admin
(`manageUsers`). `imports/[id]` DELETE is HR-**and**-ADMIN only.

## Notifications, self-service, utilities

| Route | Method | Auth | Purpose |
|---|---|---|---|
| `/api/notifications`, `/mark-all-read`, `/[id]/snooze` | GET/POST | Session | Bell items, mark read, snooze |
| `/api/push/subscribe`, `/push/test` | POST/DELETE | Session | Web Push subscription + test |
| `/api/login` | POST | **Public** (rate-limited; device gate inside) | Credential login → `wcr_session` + `wcr_did` cookies |
| `/api/logout` | POST, GET | Session | Revoke session + clear cookie |
| `/api/profile/password`, `/photo` | POST/PATCH | Session | Change own password / avatar |
| `/api/me/notif-prefs`, `/notif-settings` | GET/PATCH | Session | Per-user notification toggles / sound |
| `/api/agent-status`, `/attendance/mark` | GET/POST | Session (own) | Field-status + self check-in |
| `/api/calendar/events` | GET | Session (scoped) | Calendar events for a date range |
| `/api/calendar.ics` | GET | **Public (per-user HMAC token in URL)** | ICS feed for Google/Apple/Outlook |
| `/api/quick-search` | GET | Session (scoped) | Cmd/Ctrl+K global search |
| `/api/resources*` | GET/POST/PATCH | Session (create gated) | Gallery / Resource Library |
| `/api/resources/[id]/file` | GET | **Public (cuid = capability token)** | Stream marketing collateral without login |
| `/api/voice-broadcast*` | POST/GET | Lalit-only send; recipients hear | Dashboard voice broadcast |
| `/api/vault*` | POST/DELETE | Session (private, owner-only) | Agent private journal (no admin access) |
| `/api/health` | GET | **Public** | DB reachability + live commit SHA |
| `/api/smoke` | GET | `SMOKE_TOKEN` or Session | Post-deploy smoke test (~15 checks) |

> **Genuinely public/no-session endpoints** are few: `/api/health`,
> `/api/cron/warm`, `/api/intake/email`, and the token/signature-gated webhooks +
> signed feeds (`/api/telephony/webhook`, `/api/acefone/webhook`, `/api/intake/meta`,
> `/api/calendar.ics`, `/api/resources/[id]/file`). Intake POSTs are key-gated;
> `/api/login` is public but rate-limited.
