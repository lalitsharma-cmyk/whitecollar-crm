# CRM Overview

> What the White Collar Realty CRM is, its modules, its roles, and the handful of
> core concepts that everything else builds on. Start here.

The CRM (`crm.whitecollarrealty.com`) runs the Dubai-property calling teams
(operating from India and Dubai). It is a Next.js 16 + Prisma + Neon Postgres app.
This document describes the **system as built**.

## The modules

| Module | Where | What it is |
|---|---|---|
| **Leads** | `/leads` | The live sales pipeline — real, workable leads owned by agents |
| **Buyer Data (Dubai)** | `/buyer-data` | A staging bank of Dubai property buyers (passport/financial data) worked through a pool → agent pipeline |
| **India Buyer** | `/india-buyer-data` | The same buyer pipeline for the India market (INR) |
| **Revival / Cold** | `/cold-calls` | Cold and lapsed leads being re-engaged; reuses the Leads UI |
| **Master Data** | `/master-data` | The untriaged repository where bulk imports land before being moved to Leads/Revival |
| **Reports** | `/reports` | Performance, pipeline, and compliance reports — see [REPORTS.md](./REPORTS.md) |
| **Customer Identity** | `/admin/identity` | Admin tool to link duplicate enquiries into one virtual customer |
| **Admin** | `/admin/*` | Team & roles, settings, telephony, devices, workflows, audit — see [ADMIN_SETTINGS.md](./ADMIN_SETTINGS.md) |
| **HR Recruitment** | `/hr` | A separate applicant-tracking workspace (not part of Sales) |

Leads, Revival/Cold, and Buyer share the **same lead-detail UI** by design (the
Unified Lead Detail framework). Buyer and Cold/Revival are **staging banks** — they
use the identical lead UI but hide the lead-only workflow until a record is
**converted** into a real lead.

## Roles & permissions

Three roles (`Role` enum), read live on every request:

- **Admin** — full access; imports, exports, all teams, all admin tools.
- **Manager** — team-scoped; sees and acts only on their own team's data.
- **Agent** — sees only their own records; **cannot** create leads, export, or
  import (all gated). Agents work the leads/buyers assigned to them.

Two extra user flags (not roles): **`isSuperAdmin`** (Lalit — exempt from device
lockout; required for the most destructive actions) and **`hrOnly`** (works only in
the HR workspace, excluded from Sales). HR has its own 3-tier RBAC. Full detail:
[ADMIN_SETTINGS.md](./ADMIN_SETTINGS.md).

## Market segregation (Team ≠ Market)

A permanent rule: **Team** and **Market** are different things and never conflated.

- **Team** = *who works the record* — `forwardedTeam` (`India` | `Dubai`).
- **Market** = *the property market* — `market` (`India` | `UAE`).

Market resolves through the single source of truth `src/lib/market.ts`: explicit
market first, else derived from team, else from currency (INR → India, AED → UAE).
India agents see India data, Dubai agents see UAE data; admins see all. Every
market-scoped feature (Sale Off, India Buyer, Revival split, reports) uses this
resolver — there is no forked per-market logic.

Currency follows the market and is **never converted or mixed**: Dubai = AED, India
= INR. Reports always show the two side by side, never summed.

## Core concepts

### Lead lifecycle

Every lead has an **origin** (Master Data / Revival / active lead) and a **status**.
Internally the pipeline runs `NEW → CONTACTED → QUALIFIED → SITE_VISIT → NEGOTIATION
→ EOI → BOOKING_DONE → WON` (or `LOST`), with a richer set of India/Dubai text
statuses layered on top (`src/lib/lead-statuses.ts`). Those statuses roll up into
**three buckets** — the single source of truth for "is this still workable?":

- **Workable** — anything not terminal (fail-safe default; a new/mis-typed status is
  workable, never silently lost).
- **Closed** — the deal is done: **booked / sold / leased only**. Meetings and site
  visits **never** close a lead.
- **Lost** — rejected / dead (non-actionable).

Rejecting a lead **unassigns** it (preserving the previous owner), tags it for
Revival, and never deletes its conversation, voice, timeline, or BANT. The default
Leads view shows Today + Overdue follow-ups; a nightly rollover moves still-open
overdue follow-ups to the next day (see [CRON_JOBS.md](./CRON_JOBS.md)).

### Buyer pipeline

Buyer records (Dubai and India) move through a pool-based pipeline
(`poolStatus`): **`ADMIN_POOL` → `ASSIGNED` → `CONVERTED` or `REJECTED`**. A buyer
with no owner sits in the Admin Pool; an admin (or the daily auto-distribution job,
when enabled) assigns pool buyers to agents. After **5 contact attempts** with no
progress a buyer **auto-returns** to the pool. Converting a buyer creates a real
Lead. Buyers hold passport + financial data, so the whole module is **ADMIN-gated**
for imports/exports.

### Conversation as source of truth

Any conversation, call, or voice note that signals a real business event
automatically creates the matching record and updates the counters. Low-confidence
signals go to a "Needs Review" queue rather than acting blindly. A key guardrail:
**meetings never close a lead** — only a booking/sale/lease does. Remarks and
conversation history are treated as immutable: `rawRemarks` is never overwritten by
a deploy or an import merge (imports append).

### Actor vs Owner (timeline attribution)

Timelines show **who actually performed** an action (the *Actor*), never the record's
current *Owner*. Both are stored. So if Lalit logs a call on an agent's lead, the
timeline credits Lalit — it never falsely attributes activity to the owner. Calls
with an unrecognised agent extension render "Unknown Agent" rather than guessing.

### Customer identity (one client = one profile)

The same person can appear across many enquiries. The Customer Identity Center
(`/admin/identity`, admin-only) lets an admin **link** duplicate enquiries (same
phone/email) into **one virtual customer**. The underlying records **stay separate**;
linking is a virtual overlay and is **reversible**. New records dup-check against the
whole CRM. Soft-deleted (recycled) records are excluded from duplicate detection.

## How the pieces connect

- **Intake** — website forms, Meta/WhatsApp ads, inbound email, and CSV/Sheet imports
  all flow in through `/api/intake/*`, are auto-classified (team/source/type/project/
  city) and, in real time, auto-assigned by rule (Dubai → Lalit · Tue-IST India →
  Yasir · else Tanuj). See [API.md](./API.md) and [IMPORT_TEMPLATES.md](./IMPORT_TEMPLATES.md).
- **Telephony** — cloud calls (AS Phone) auto-link by phone to the right Lead/Revival/
  Buyer and drop the recording into that timeline. See [TELEPHONY.md](./TELEPHONY.md).
- **Automation** — follow-up reminders, escalations, digests, and drip workflows run
  on schedules. Notifications always fire; automated *actions* default OFF per toggle.
  See [ADMIN_SETTINGS.md](./ADMIN_SETTINGS.md) and [CRON_JOBS.md](./CRON_JOBS.md).
- **AI** — an optional, human-approval-gated Sales OS layer, currently built but OFF.
  See [AI.md](./AI.md).

## Safety posture

The CRM is **live with real client data**; data safety outranks features. Every
data-risky change requires a backup + risk disclosure + owner approval first, and
records are soft-deleted (recycle bin), not destroyed. See
[RECOVERY_AND_BACKUP.md](./RECOVERY_AND_BACKUP.md) and [DEPLOYMENT.md](./DEPLOYMENT.md).
