# White Collar Realty CRM — Build Summary (Start → Current)

> **Audience.** A new developer or manager who needs to understand the whole
> CRM from scratch: what was asked for, what shipped, what's half-done,
> what's deliberately deferred, and what must happen before go-live.
>
> **How this was reconstructed.** From the git commit history (Waves 1–20,
> then Rounds 8–11) and the round-by-round design docs under `docs/`. The
> live app is login-gated, so screenshots could not be captured; where the
> spec expects one, it reads **(screenshot to be captured during live UAT)**.
> See `docs/CURRENT_CRM_FUNCTIONALITY_INVENTORY.md` for the page-by-page
> source audit that this summary sits on top of.
>
> **Generated:** 2026-06-02 · reflects post-Round-11 source state.

---

## 1. The original request

Replace the brokerage's Google-Sheets sales pipeline with a purpose-built,
mobile-friendly CRM for **White Collar Realty** — a Dubai-property brokerage
selling primarily to **Indian investors**. Live at
**crm.whitecollarrealty.com**.

Core context that shaped everything:
- **Non-technical owner — Lalit** — is the product owner and escalation point.
  The CRM has to mirror the way he already runs the floor (e.g. his manual
  daily report sheet) rather than impose new process.
- **Two teams:** "Dubai" (Mehak, Dinesh) and "India" (Yasir, Tanuj), under
  **roles ADMIN / MANAGER / AGENT**.
- **Office hours:** 10:00–19:00 IST, Mon–Sat.
- **Dual currency:** deals span AED and INR; the two are **never summed**.
- The product had to capture **deep client context** ("who is the client",
  fund-readiness, investment timeline, profession, mood) — not shallow
  keyword tags — because that nuance is what wins Dubai investment deals.

What this implied in build terms: a lead pipeline, click-to-call + call
logging, WhatsApp outreach, deep lead intake, role-scoped visibility,
manager/admin reporting that mirrors the sheets, gamification to drive floor
behaviour, and automation to enforce speed-to-lead — all usable on a phone.

---

## 2. Pages designed

(See `docs/CURRENT_CRM_FUNCTIONALITY_INVENTORY.md` §3.1 for the full per-page
detail. Summary of the surface that was designed and exists in source:)

- **Working surfaces:** `/dashboard`, `/leads`, `/leads/new`, `/leads/[id]`,
  `/pipeline`, `/activities` (Action Board), `/action-list`, `/intake`,
  `/cold-calls` + `/cold-calls/session` (Revival Engine), `/calls`,
  `/properties` + `/properties/new` + `/properties/[id]`.
- **Personal:** `/profile`, `/notifications`, `/settings`, `/vault`, `/help`,
  `/ai` (assistant).
- **Reports:** `/reports` hub + `daily`, `sla`, `sources`, `ytd`,
  `team-comparison`, `commission`, `travel`, `cooling`.
- **Team:** `/team`, `/team/[id]`.
- **Admin:** `/admin/integrations`, `/admin/workflows` (+ `/[id]/runs`),
  `/admin/templates`, `/admin/attendance`, `/admin/audit`, `/admin/targets`,
  `/admin/duplicates`, `/admin/quality`, `/admin/team-mood`, `/admin/vault`,
  `/admin/site-visits`, `/admin/health` (+ `/admin/cron-health`),
  `/admin/rejected-leads`, `/admin/awaiting-team`.
- **Public/auth:** `/login`.
- **Leaderboards:** `/leaderboards`.

---

## 3. Workflows requested

- **Lead intake → assignment → work → close**, with mandatory team tagging
  (Dubai/India) and round-robin distribution.
- **Speed-to-lead:** auto-touch new leads fast (WhatsApp + email), including
  an **after-hours (10pm–10am) auto-WhatsApp welcome**.
- **Click-to-call with automatic call logging + recording** (Acefone), so the
  dashboard's "calls today" is real and every call lands on the lead timeline.
- **WhatsApp outreach** from lead detail and in bulk from the list.
- **EOI / booking funnel** — an 8-step booking workflow on the lead.
- **Cold-data revival** — systematically rework old data ("Revival Engine").
- **Zoho-style IF/THEN automation** the admin can configure (e.g. "after BANT
  qualified, send a WhatsApp template").
- **Daily report mirroring Lalit's sheet** (7 metrics, target vs achieved),
  exportable to PDF.
- **Manager/admin oversight:** team comparison (Dubai vs India), quality
  scoring, attendance, live site-visit location tracking, audit trail.
- **Gamification:** XP, levels, streaks, badges, leaderboards.
- **Wellbeing:** private agent vault + anonymous team-mood insight.

---

## 4. What was built (shipped and working in source)

Built across **Waves 1–20** (commit `9c30cde` rolls up Rounds 2–7) and then
**Rounds 8–11**:

- **Full lead lifecycle** — deep intake (`/leads/new`), detail workspace with
  ~20 cards (`/leads/[id]`), list + pipeline (scoped), reassignment, structured
  rejection reasons, duplicate merge.
- **Round-robin assignment** that respects attendance (only PRESENT/LATE
  agents receive leads) and a mandatory-team policy (`/admin/awaiting-team`).
- **Call intelligence** — manual call logging, connect-rate-by-hour heatmap,
  per-call quality scoring (`/calls`).
- **Reporting suite** — daily (with PDF), SLA/meetings, source funnel, YTD,
  team comparison, commission/earnings, travel reimbursement, cooling-leads.
  Currency always split AED/INR.
- **Automation** — Zoho-style workflow builder with run history and a
  performance widget (`/admin/workflows`); EOI 8-step booking funnel.
- **Templates** — WhatsApp + email library with usage stats (`/admin/templates`).
- **Gamification** — XP/levels/streaks/badges (`@/lib/gamification`),
  `/leaderboards`, personal `/profile`.
- **Wellbeing** — private `/vault`; anonymous `/admin/team-mood` (never reads
  vault content).
- **Quality Score** — `/admin/quality` implements `docs/SPEC-quality-score.md`
  (Activity 30% + Funnel 35% + Behavioural 25% + Wellbeing 10%), with a
  reduced, report-scoped manager view. **This spec is now BUILT, not a proposal.**
- **Attendance** auto-marked on login (PRESENT before 10:30 IST, LATE after).
- **Live site-visit GPS tracking** (`/admin/site-visits`) — built specifically
  because Lalit asked to see an agent's live location during a site visit.
- **Admin observability** — integrations status, system health, cron health,
  append-only audit log.
- **Role-scoped security** — `requireRole` + a recursive-CTE lead-scope model
  (`src/lib/leadScope.ts`). **Round 11** specifically closed a batch of
  agent↔agent permission leaks (commit `4dd8ba1`): `/leads` filters gated,
  `LOST` hidden from agents, `/pipeline` and `/properties` lead-matching
  scoped, `canTouchLead()` on lead detail.
- **Mobile** — `MobileShell.tsx` nav, mobile-tab lead detail, quick-add FAB,
  iOS zoom/scroll hardening.
- **AI assistant** (`/ai`) backed by Anthropic with a rule-based fallback.
- **Email send** via Resend (real, not stub).
- **Web push** infrastructure (VAPID) with a test button in `/settings`.

---

## 5. What was partially built (works with caveats)

- **WhatsApp programmatic send — STUB.** Free `wa.me` draft links work today
  (they open WhatsApp on the user's own device). Real, automated sending
  (speed-to-lead WA, after-hours auto-WA, workflow `SEND_WA`) only **logs
  intent** until the Meta WhatsApp Business Cloud API keys + approved
  templates are live. See `docs/WHATSAPP_BUSINESS_SETUP.md`.
- **Acefone click-to-call — env-gated.** All the UI, webhook handler, and
  per-agent `acefoneAgentId` mapping exist, but "📞 Call via Acefone" and
  auto-call-logging are inactive until Acefone env keys are set. See
  `docs/ACEFONE_SETUP.md`.
- **AI assistant — degraded without a key.** `/ai` and AI lead-scoring need
  `ANTHROPIC_API_KEY`; otherwise the rule-based fallback runs. (The Gemini
  path was attempted and abandoned.)
- **Dashboard agent KPI tiles — Round 12 OPEN, NOT FIXED.** An AGENT's KPI
  count tiles on `/dashboard` still use team-wide scope instead of
  `ownerId: me.id`. Tracked as Round 12; close before agent rollout.
- **`/calls` recent-calls list — (inferred) unscoped.** The latest-50 list is
  not role-scoped (the heatmap above it is). Minor competitive-data leak.
- **`/team` "+ Invite User"** — button present, **(inferred)** not wired.
- **Data export** — per-lead/filtered CSV export and daily-report PDF exist;
  a general leads export is not confirmed (verify during UAT).
- **Stale copy** — `/settings` still says pipeline ends "Won/Lost" and
  references `.env` (should be Vercel env); `/ai` has a hardcoded
  "Automations active" string (P2-4). Cosmetic.

---

## 6. What is pending (requested but not built)

- **Real WhatsApp sending** — blocked on the Meta Cloud API onboarding above.
- **WhatsApp OTP / 2FA** — explicitly "not built; ~4h once WA tokens are live"
  (per `docs/WHATSAPP_BUSINESS_SETUP.md`).
- **A unified HR module** — adjacent pieces exist (attendance, weekly-off,
  travel reimbursement, team-mood) but there is no consolidated HR surface.
- **Round 12 fix** — agent dashboard KPI scoping.
- **Open SPECs not yet built** — `docs/SPEC-smart-cma-and-voice.md` (smart CMA
  + voice features) remains a proposal.
- **General data export / formal backup UX** — to confirm and, if wanted,
  build.

---

## 7. External-integration dependencies (need keys to go live)

All three core integrations are **gated by environment variables in Vercel**.
The CRM runs without them, but the related features stay stubbed/degraded.

| Integration | Env vars | What unlocks | Setup doc |
|---|---|---|---|
| **Acefone** (click-to-call + auto call-logging + recording) | `ACEFONE_API_KEY`, `ACEFONE_DID_NUMBER`, `ACEFONE_WEBHOOK_TOKEN`, opt. `ACEFONE_BASE_URL` + per-agent `acefoneAgentId` on `/team` | Real dialing, auto CallLog, recordings on timeline, accurate "calls today" | `docs/ACEFONE_SETUP.md` |
| **WhatsApp** (Meta Cloud API) | `WA_BUSINESS_TOKEN`, `WA_BUSINESS_PHONE_NUMBER_ID` + approved templates (`afterhours_welcome`, `first_query_welcome`, `site_visit_reminder`) | Real automated WA: speed-to-lead, after-hours welcome, workflow sends | `docs/WHATSAPP_BUSINESS_SETUP.md` |
| **Anthropic AI** | `ANTHROPIC_API_KEY` | Full `/ai` assistant + AI lead scoring (vs rule-based fallback) | (in-app `/ai` hint) |

Supporting (also env-gated): **Resend** email (already live where configured),
**Web Push** (VAPID keys), session secret `NEXTAUTH_SECRET`, and
**cron** scheduling. Note the **Vercel Hobby** constraint (`AGENTS.md`): max 2
daily-or-less crons in `vercel.json`; sub-daily crons run from
`.github/workflows/cron.yml` against `/api/cron/*` with `CRON_SECRET` —
violating the cron limit makes Vercel silently drop the deployment.

---

## 8. What to do next (recommended order)

1. **Close Round 12** — scope the agent dashboard KPI tiles to `ownerId:
   me.id`. Small, high-trust fix; agents shouldn't see team-wide numbers.
2. **Tighten `/calls`** — apply role scope to the recent-calls list (inferred
   leak), matching the heatmap's scoping.
3. **Reconcile the vault privacy story** — `/vault` says "private" but
   `/admin/vault` shows full content by design (Lalit's call). Either soften
   the `/vault` copy or add a visible "admins can review" notice. Flagged in
   `docs/QA-AUDIT-FINDINGS.md`.
4. **Stand up the integrations for UAT** — follow the Acefone and WhatsApp
   setup docs; add `ANTHROPIC_API_KEY`. Then re-check `/admin/integrations`.
5. **Fix stale copy** — `/settings` (Won/Lost + `.env`→Vercel) and `/ai`
   ("Automations active", P2-4).
6. **Run live UAT** — capture the screenshots this audit could not, confirm
   all **(inferred)** items (the `/team` invite button, `/cold-calls/session`,
   `/properties/[id]`, cron-health and workflow-runs sub-pages, file-upload
   storage, export/backup story).
7. **Decide the "+ Invite User" flow** — wire it or hide it.

---

## 9. What NOT to build yet

- **Smart CMA + voice features** (`docs/SPEC-smart-cma-and-voice.md`) — leave
  as a spec until the core call/WhatsApp integrations are proven in production.
- **A full HR module** — the existing attendance/weekly-off/travel/team-mood
  pieces cover the immediate need; don't build a heavyweight HR suite
  speculatively.
- **WhatsApp 2FA/OTP** — deferred until the WhatsApp Cloud API is live and
  stable (it's a quick add afterwards).
- **New scheduled jobs casually** — respect the Vercel Hobby cron ceiling;
  route sub-daily work through the GitHub Actions cron file.
- **Anything that widens lead visibility** before the Round 12 / `/calls`
  scope fixes land — don't pour more data through a known-leaky surface.

---

## 10. Future roadmap (directional, post-stabilisation)

- **Phase A — Go-live hardening:** Round 12 + `/calls` scope fixes, vault copy
  reconciliation, stale-copy cleanup, integrations switched on, full UAT pass.
- **Phase B — Make the integrations sing:** real WhatsApp automation end-to-end
  (templates approved, delivery/read receipts on timeline), Acefone recordings
  + inbound routing verified, AI scoring tuned on real data.
- **Phase C — Intelligence layer:** revisit `SPEC-smart-cma-and-voice.md`
  (smart CMA, voice notes/transcription), deepen AI assistant actions, and
  push the "remark depth" analysis Lalit wants (full client situations, not
  keyword matches).
- **Phase D — Scale & ops:** formal export/backup UX if needed, WhatsApp 2FA,
  and a consolidated HR view if the floor outgrows the current attendance/
  travel/mood pieces. Watch the Vercel plan ceiling — sustained sub-daily
  automation or heavier compute may warrant leaving the Hobby plan.

---

*Cross-references: `docs/CURRENT_CRM_FUNCTIONALITY_INVENTORY.md` (page-by-page
source audit), `docs/ACEFONE_SETUP.md`, `docs/WHATSAPP_BUSINESS_SETUP.md`,
`docs/SPEC-quality-score.md` (now built), `docs/SPEC-smart-cma-and-voice.md`
(proposed), `docs/QA-AUDIT-FINDINGS.md`, `AGENTS.md` (Vercel Hobby limits).*
