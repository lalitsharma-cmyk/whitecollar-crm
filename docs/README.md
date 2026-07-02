# White Collar Realty CRM — Documentation

Documentation for the WCR CRM (`crm.whitecollarrealty.com`) — a Next.js 16 + Prisma
+ Neon Postgres app that runs the Dubai-property calling teams (India + Dubai).
Written for the owner (Lalit) and any future engineer, and kept accurate to the code.

**New here? Read [CRM_OVERVIEW.md](./CRM_OVERVIEW.md) first.**

## Core docs

| Doc | What it covers |
|---|---|
| [CRM_OVERVIEW.md](./CRM_OVERVIEW.md) | Modules, roles/permissions, market segregation, and the core concepts (lead lifecycle, buyer pipeline, conversation-as-source-of-truth, actor-vs-owner, customer identity) |
| [AI.md](./AI.md) | The AI Sales OS — what it does, the Read-Only-First pipeline, mock vs key, how to turn it on, the approval/safety envelope |
| [IMPORT_TEMPLATES.md](./IMPORT_TEMPLATES.md) | The import wizard, dedup modes, safe mode / dry-run, and the exact downloadable templates and headers per module |
| [REPORTS.md](./REPORTS.md) | Every report route — what it shows, its filters, and who can see it — plus the export routes |
| [API.md](./API.md) | The important API routes grouped (intake, leads, buyer-data, telephony, ai, reports/export, admin, cron), with method + auth/gating + purpose |
| [ADMIN_SETTINGS.md](./ADMIN_SETTINGS.md) | Team & Roles, agent extension mapping, AI console, AS Phone console, device security, and every settings key (`ai.enabled`, `agentsOnLeave`, automation toggles, …) |
| [DEPLOYMENT.md](./DEPLOYMENT.md) | Vercel Hobby constraints, the build (no auto-migrate), deploying via `npm run push` / deploy hook, health check, and the service-worker cache bump |
| [RECOVERY_AND_BACKUP.md](./RECOVERY_AND_BACKUP.md) | Neon Postgres, the daily + pre-deploy backups, the recycle-bin (soft-delete) model, what's reversible vs not, and recovery steps |
| [CRON_JOBS.md](./CRON_JOBS.md) | The heartbeat dispatcher (`/api/cron/warm`), the job arrays, the "GitHub Actions is dead" situation, each cron's purpose + cadence, and `CRON_SECRET` |
| [TELEPHONY.md](./TELEPHONY.md) | Operator guide for AS Phone — how calls flow to timelines and the admin console (links to the paste-and-go setup) |

## Deeper / reference docs (pre-existing)

- [AI_SALES_OS_ARCHITECTURE.md](./AI_SALES_OS_ARCHITECTURE.md) — full AI architecture, the 7-layer Brain, milestones, and env/config reference.
- [AI_FOLLOWUP_INTELLIGENCE_DESIGN.md](./AI_FOLLOWUP_INTELLIGENCE_DESIGN.md) — the follow-up intelligence design.
- [AS_PHONE_SETUP.md](./AS_PHONE_SETUP.md) — telephony paste-and-go: the five credentials and the webhook URL.
- [ACEFONE_SETUP.md](./ACEFONE_SETUP.md) — the legacy Acefone telephony provider.
- [WHATSAPP_BUSINESS_SETUP.md](./WHATSAPP_BUSINESS_SETUP.md) — WhatsApp Business Cloud API setup (outbound WA).
- [BACKUP_SETUP.md](./BACKUP_SETUP.md) — one-time setup for the daily Google-Drive database backup.
- [DEPLOY_SAFETY.md](./DEPLOY_SAFETY.md) — the deploy safety playbook (risk classes, rollback paths).
- [ACTOR_VS_OWNER_TIMELINE.md](./ACTOR_VS_OWNER_TIMELINE.md) — the actor-vs-owner timeline rule in depth.

## Training material

- [ADMIN_CRM_TRAINING_GUIDE.md](./ADMIN_CRM_TRAINING_GUIDE.md) / [MANAGER_CRM_TRAINING_GUIDE.md](./MANAGER_CRM_TRAINING_GUIDE.md) / [AGENT_CRM_TRAINING_GUIDE.md](./AGENT_CRM_TRAINING_GUIDE.md) — role-specific how-to guides.
- [CRM_ROLE_PERMISSION_MATRIX.md](./CRM_ROLE_PERMISSION_MATRIX.md) — detailed role/permission matrix.

## Quick facts

- **Production URL:** https://crm.whitecollarrealty.com
- **Stack:** Next.js 16 · React 19 · Prisma · PostgreSQL (Neon, Singapore) · Vercel Hobby
- **Deploy:** `npm run push` (git push + deploy hook), gated by tsc + regression + backup
- **Health check:** `GET /api/health` → returns the live commit SHA + lead count
- **Two schedulers:** 2 Vercel crons + the `/api/cron/warm` heartbeat (GitHub Actions currently down — see [CRON_JOBS.md](./CRON_JOBS.md))

## Paid integrations — what's free vs what needs setup

Already free + active (no setup): email via Resend, Web Push notifications, PWA
install/offline, and all dashboards/reports/attendance/mood/templates/smart-lists/
workflows/inventory-matching/behavioural-rescoring/Smart-CMA-PDF/audit. Optional
paid add-ons: **telephony** ([AS_PHONE_SETUP.md](./AS_PHONE_SETUP.md) /
[ACEFONE_SETUP.md](./ACEFONE_SETUP.md)) and **WhatsApp Business Cloud API**
([WHATSAPP_BUSINESS_SETUP.md](./WHATSAPP_BUSINESS_SETUP.md)) — each is credential-only
(paste keys into Vercel; no code change).

> These docs describe the **system as built**. Where behaviour is governed by a
> standing requirement, that requirement is reflected. If code and an older note ever
> disagree, the code is authoritative (a few such stale-note findings are called out
> inline).
