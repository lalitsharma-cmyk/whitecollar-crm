# Admin & Settings

> The admin control surfaces and every settings toggle that changes the CRM's
> behaviour. Most "settings" are database values an admin flips in the UI — not code
> or env vars.

## Admin pages (`/admin/*`)

All admin pages require the **ADMIN** role (a few actions require **Super-Admin**).
The main consoles:

| Page | Route | What it's for |
|---|---|---|
| Team & Roles | `/admin/users` (Team) / `/team` | Create/edit users, set role & team, map telephony extensions, weekly-offs |
| AI Console | `/admin/ai-console` | AI status, engine, kill-switch surface |
| AI Trial | `/admin/ai-trial` | Bounded AI trial controls |
| Admin Assistant | `/admin/assistant` | Natural-language bulk operations (rule-based, no LLM), preview → approve → undo |
| AS Phone (Telephony) | `/admin/telephony` | Cloud-calling console — see [TELEPHONY.md](./TELEPHONY.md) |
| Devices | `/admin/devices` | Trusted-device approval / revocation |
| Customer Identity | `/admin/identity` | Link duplicate enquiries into one virtual customer (reversible) |
| Imports | `/admin/imports` | Import history / batches |
| Projects | `/admin/projects` | Project Master (auto-classification catalogue) |
| Cron Health | `/admin/cron-health` | Did each scheduled job run today, and succeed? |
| Health | `/admin/health` | System health |
| Audit | `/admin/audit` | Audit log |
| Data Quality | `/admin/quality` | Data-quality findings |
| Duplicates / Dedup | `/admin/duplicates`, `/admin/dedup` | Duplicate review |
| Rejected Leads | `/admin/rejected-leads` | Rejected-lead workflow |
| Field Status | `/admin/field-status` | Agent field-activity tracking |
| Targets | `/admin/targets` | Sales targets |
| Templates | `/admin/templates` | Message templates |
| Workflows | `/admin/workflows` | Drip-campaign workflows |
| Site Visits | `/admin/site-visits` | Site-visit monitoring |
| Attendance / Team Mood / Revival Logs / Awaiting Team / Vault | `/admin/*` | Ancillary admin views |

## Team & Roles

### Roles

Three roles (`Role` enum: `ADMIN`, `MANAGER`, `AGENT`), read **live** on every
request (a role change takes effect on the user's next request):

- **ADMIN** — full access; can import, export, see all teams, run admin tools.
- **MANAGER** — team-scoped; sees and manages only their own team's data.
- **AGENT** — sees only their own leads/records; **cannot** create leads, export, or
  import (gated).

Two extra flags on a user (not roles):
- **`isSuperAdmin`** — a super-admin (a flag on an ADMIN): exempt from device
  lockout (safety hatch), and required for the most destructive actions (e.g.
  `soft_delete` purges, wipe tools). Lalit is the super-admin.
- **`hrOnly`** — the user works only in the HR workspace (`/hr`) and is excluded from
  sales entirely (e.g. Nisha). HR has its own 3-tier RBAC (Admin/Senior/Junior HR).

### Market vs Team (important distinction)

**Team ≠ Market.** They are separate fields and must never be conflated:

- **Team** = *who works the record* — `Lead.forwardedTeam` (`India` | `Dubai`).
- **Market** = *the property market* — `Lead.market` (`India` | `UAE`).

Market resolves through the single source of truth `src/lib/market.ts`
(`resolveMarket`): explicit `market` first, else derived from team, else from
currency (INR → India, AED → UAE). Every market-scoped feature (Sale Off, India
Buyer, Revival split, reports) uses this — no forked per-market logic. India agents
see India data, Dubai agents see UAE data; admin sees all (server-enforced via
`propertyScope.ts`).

### Agent → telephony extension mapping

Each agent's calling extension goes in Team & Roles (the field labelled "Acefone
agent id" — it is the generic telephony extension, stored as `User.acefoneAgentId`).
Calls are attributed to the user whose extension matches; unmatched extensions render
"Unknown Agent". See [TELEPHONY.md](./TELEPHONY.md).

## Device security

Trusted-device binding (see memory `project-device-security.md`):

- Sessions are DB-backed; each request re-verifies the session row + its device, so
  revocation / force-logout / device-block / password-reset take effect immediately.
- A device must be **APPROVED** by an admin (in `/admin/devices`). A copied session
  cookie used on another browser is hard-denied (the device cookie won't match).
- Super-admin (Lalit) is exempt from device checks only (can never be locked out).
- **Enforcement** is controlled by the env var **`DEVICE_SECURITY_ENFORCE`**. Phase A
  is monitor-only; flip it to `true` after devices are registered to enforce binding.

## Settings keys (database toggles)

These live in the `Setting` table (all stored as text) and are flipped from
**Settings** in the UI — **not** env vars. Defaults are in
[`src/lib/settings.ts`](../src/lib/settings.ts). Design rule: **notifications always
fire; automation actions all default OFF** — an admin must opt in per feature.

### Automation controls (all default OFF)

| Key | Default | Effect |
|---|---|---|
| `roundRobin.enabled` | `false` | Auto-assign orphan leads via the 5-min reconciler |
| `automation.autoAssignment` | `false` | Assign orphan leads to an owner automatically |
| `automation.whatsapp` | `false` | Automated outbound WhatsApp (welcome / speed-to-lead / workflow) |
| `automation.email` | `false` | Automated outbound email |
| `automation.autoEscalation` | `false` | Automatic escalation *actions* (not the alerts) |
| `automation.scheduledActions` | `false` | Workflow-engine scheduled/drip actions |
| `websiteAutoAssignEnabled` | `true` | Master ON/OFF for **all** real-time auto-assignment (website + Meta + email + quick-add). *Who* a lead goes to is decided by the rule in `teamAutoAssign.ts` (Dubai→Lalit · Tue-IST India→Yasir · else Tanuj), not a static map |
| `buyerAutoDistribute.enabled` (+ `.team`) | `false` | Daily round-robin of the ADMIN_POOL buyer bank to the active team |

### Notification / escalation toggles (independent of automation)

| Key | Default | Effect |
|---|---|---|
| `slaBreach.enabled` | `false` | 15-min "no call yet" call-SLA breach alert (paused) |
| `freshUntouched.enabled` | `false` | Fresh-lead untouched escalation (15-min nudge → 45-min manager escalation). Visual layer ships first; flip on after verifying on real data |

### AI

| Key | Default | Effect |
|---|---|---|
| `ai.enabled` | `false` | **Master kill-switch** for all cost-incurring AI. Off → every AI call returns null, callers fall back to rules |
| `ai.trialMode.enabled` | `false` | Allow a bounded, confirmed trial to call the provider while `ai.enabled` is still off |
| `ai.monthlyCostCapUsd` | `50` | Hard monthly AI spend cap (USD). `0` = no cap. Above it, AI short-circuits to the mock |
| `ai.extraction.autoApply` | `false` | Auto-write AI-extracted fields at confidence ≥ 0.90 (budget/status never auto-applied) |

### BANT stage-gate

| Key | Default | Effect |
|---|---|---|
| `bantGate.mode` | `soft` | `off` = no check · `soft` = warn but allow · `hard` = block advancing to Qualified+ until all four BANT captured |

### Pilots & misc

| Key | Default | Effect |
|---|---|---|
| `motivationPilot.enabled` (+ `.team`) | `false` / `""` | One-team voice/motivation pilot; renders only when enabled **and** the viewer's team matches (`ALL`/`both` = everyone) |
| `unifiedDetail.returningClient.enabled` | `false` | The cross-module "Returning Client" card on the lead detail |
| `speedToLead.enabled` | `true` | Auto WhatsApp + email on every new lead (admin kill-switch) |
| `travel.perKmInr` | `10` | ₹/km rate for travel reimbursement (used by the Travel report) |
| `testingMode.enabled` | `false` | **Legacy** — now only the safety guard for the destructive `/api/admin/wipe-leads` dev tool (refuses unless ON). No longer gates notifications or automation |
| `agentsOnLeave` | — | Set of agent ids currently on leave; they receive **no** new auto-assignment (routed to teammate → manager → parked). IST auto-expire. (Agent leave-cover; admin UI is a TODO — set via script for now) |

> **Env vars vs settings keys:** connection strings, secrets, and enforcement flags
> (`DATABASE_URL`, `NEXTAUTH_SECRET`, `CRON_SECRET`, `DEVICE_SECURITY_ENFORCE`, AI
> provider keys, AS Phone creds) are **env vars** set in Vercel. Everything in the
> tables above is a **database setting** flipped in the UI. See
> [DEPLOYMENT.md](./DEPLOYMENT.md).
