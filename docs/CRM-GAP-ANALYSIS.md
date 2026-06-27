# White Collar Realty CRM — Feature Gap Analysis

_Read-only audit. Date: 2026-06-28. Scope: outbound calling + Dubai/India property-investment sales floor._

---

## Executive summary

The White Collar Realty CRM is **far more capable than its day-to-day usage suggests**. The codebase already contains production-grade infrastructure for nearly every "missing" feature a sales floor would ask for — Acefone click-to-call with automatic call-recording capture, the official Meta WhatsApp Business Cloud API, a true lightest-load round-robin distribution engine, a 15-minute first-call SLA breach detector, a full EOI → KYC → booking → commission funnel, duplicate-merge, CSV export, nightly backups, and an installable PWA. **The single biggest "gap" is not missing code — it is that several of these systems are switched OFF or unconfigured.** Click-to-call and call recording need Acefone credentials; WhatsApp falls back to manual `wa.me` links until Meta tokens are set; round-robin and SLA escalation are gated to `false` by deliberate settings. The genuinely absent capabilities — the ones that need real new build — are: **per-lead document storage** (KYC/passport/signed-agreement files have nowhere to live), **a scalable file-storage backend** (everything is capped at 5 MB in Postgres), **pipeline/revenue forecasting depth**, **2-way email**, and **a true power-dialer queue** beyond the cold-call session. This document prioritizes both: turn on what exists (fast, high-value), then build what's truly missing.

---

## Priority table

| # | Gap | Priority | Effort | Type |
|---|-----|----------|--------|------|
| 1 | Telephony live (click-to-call + call recording not configured) | **P0** | S | Activate + provider cost |
| 2 | WhatsApp Business API not live (manual wa.me links today) | **P0** | S–M | Activate + Meta approval |
| 3 | Per-lead document storage (KYC / passport / signed booking forms) | **P0** | M | New build + infra |
| 4 | Lead distribution & SLA enforcement switched off | **P0** | S | Activate + tune |
| 5 | File-storage backend ceiling (5 MB Postgres bytea, no blob) | **P0** | M | New infra + cost |
| 6 | Sales forecasting & target-vs-actual depth | **P1** | M | New build (fits arch) |
| 7 | 2-way email (replies don't return to CRM; no 1:1 send) | **P1** | M–L | New build + Gmail blocked |
| 8 | Power-dialer / structured calling queue (warm + follow-up) | **P1** | M | New build (fits arch) |
| 9 | Capacity-aware & skill-based routing; stale-lead reassign | **P1** | M | New build (fits arch) |
| 10 | Bulk WhatsApp/SMS campaigns are link-lists, not real sends | **P1** | S–M | Activate + provider cost |
| 11 | Commission → agent incentive/payout statements | **P2** | M | New build (fits arch) |
| 12 | Excel (xlsx) export + scheduled report delivery | **P2** | S | New build (fits arch) |
| 13 | Offline calling list (no offline mutation/queue) | **P2** | L | New build + infra |
| 14 | Native mobile app vs current PWA | **P2** | L | New infra (likely skip) |
| 15 | Backup hardening (single JSON to GitHub artifacts, no restore tool) | **P2** | S–M | Harden existing |

Effort: **S** = days, **M** = 1–2 weeks, **L** = multi-week.

---

## P0 — High value, fills a real daily pain

### 1. Telephony is built but not switched on — agents still dial manually

**Plain English:** The CRM already has a "Call via Acefone (auto-record)" button that rings the agent's phone, then dials the client, and pulls the call recording back into the lead timeline automatically. But because Acefone credentials aren't set in production, that button is hidden and agents are dialing from `tel:` links and typing call notes by hand. On a 30+ calls-a-day floor, that's the difference between an audited, recorded, auto-logged call and a manual entry an agent may skip or fudge.

- **What's missing:** Configuration, not code. `ACEFONE_API_KEY`, `ACEFONE_DID_NUMBER`, `ACEFONE_WEBHOOK_TOKEN` are unset, so `acefoneEnabled()` returns false and the button is hidden. No agent has an `acefoneAgentId` mapped on `/team`. The Acefone dashboard webhook (which delivers call status + `recordingUrl`) isn't pointed at the CRM. There is **no softphone/in-browser dialer** — calling always rings the agent's physical phone (acceptable, but worth stating).
- **Why it matters here:** This is a phone-first outbound floor. Automatic call logging + recording is the backbone of QA, dispute resolution, training, and honest activity metrics. Without it, "calls logged" depends on agent discipline, and there is no recording to review a deal that went sideways. Recordings also feed future AI call-summary/coaching.
- **Effort:** **S** — get credentials, set 3 env vars, map agent IDs on `/team`, paste the webhook URL into Acefone. The hard part is procurement/onboarding with Acefone, not engineering.
- **Architecture fit:** Perfect — fully built. `src/lib/acefone.ts` makes real REST calls to `https://api.acefone.in/v1/click_to_call`; `src/app/api/acefone/click-to-call/route.ts` triggers it; `src/app/api/acefone/webhook/route.ts` receives status + recording and upserts `CallLog.recordingUrl`; `src/components/CallHistoryCard.tsx` already renders an `<audio>` player. Inbound-call → lead auto-create exists behind `ACEFONE_AUTO_CREATE_INBOUND=true`.
- **Data-safety / migration:** None. Additive, env-gated, no schema change. Inbound auto-create should stay OFF until dedup behavior on unknown numbers is confirmed against the production dataset.

### 2. WhatsApp is manual wa.me links — the official Business API is coded but dark

**Plain English:** Today, when an agent sends a WhatsApp, the CRM opens a pre-filled `wa.me` link and the agent taps "send" in their own WhatsApp. The CRM has full code for the official Meta WhatsApp Business Cloud API (programmatic sending + a webhook that captures the client's replies into the timeline), but it's disabled because the Meta tokens aren't set. So outbound WhatsApp isn't truly sent or tracked by the system, and **inbound replies don't appear in the CRM at all** unless the webhook is live.

- **What's missing:** `WA_BUSINESS_TOKEN` + `WA_BUSINESS_PHONE_NUMBER_ID` are unset, so `src/lib/whatsappOutbound.ts` runs in stub mode and the app falls back to `waDraftLink()` in `src/lib/wa.ts`. `WHATSAPP_VERIFY_TOKEN` isn't configured, so the inbound webhook (`src/app/api/intake/whatsapp/route.ts`, which already handles Meta + Twilio shapes and writes `WhatsAppMessage` INBOUND rows) is inert. Templates (`src/lib/templates.ts`) are free-text and not registered as Meta-approved templates, which the Cloud API requires for business-initiated messages outside the 24-hour window.
- **Why it matters here:** WhatsApp is the primary channel for Dubai/India property buyers. Manual links mean no delivery/read tracking, no two-way conversation history in the lead record, and no ability to run real broadcast campaigns. Inbound capture alone is a major win — agents currently lose the client's WhatsApp replies into their personal phones.
- **Effort:** **S–M** — set env vars and wire the webhook (S); getting message templates approved by Meta and provisioning the Business number/WABA is the longer pole (M, and it's an external/compliance task).
- **Architecture fit:** Excellent — send path, inbound webhook, and `WhatsAppMessage` model with `direction`/`providerMsgId` all exist. Per-agent `companyWhatsAppNumber` is already on the `User` model.
- **Data-safety / migration:** None schema-wise. Compliance matters: business-initiated WhatsApp must use approved templates and respect opt-in — operational risk, not data risk.

### 3. No per-lead document storage — KYC, passports, and signed booking forms have nowhere to live

**Plain English:** When a deal reaches booking, the agent collects the client's passport, KYC documents, a signed booking form, and payment proof. The CRM tracks the **status** of each of these ("DOCS_RECEIVED", "SIGNED", "VERIFIED") but cannot **hold the actual files**. The documents live in email/WhatsApp on someone's phone. For a property-investment business — where KYC and signed agreements are legal/compliance artifacts — this is a real hole.

- **What's missing:** The `Lead` model has zero document/file fields. The EOI/booking funnel (`eoiStage`, `kycStatus`, `bookingFormStatus`, `paymentProofStatus` — fully usable via `src/components/EOIPanel.tsx`) is **status-only**. The Gallery/`Resource` system is for company-wide outbound collateral (brochures), not inbound per-lead documents, and shares are tracked but files cap at 5 MB. There is no "Documents" tab on the lead detail.
- **Why it matters here:** Compliance and auditability for high-value transactions; agent handovers (a reassigned lead loses its document trail); developer submissions often require the buyer's KYC pack. This is the most-felt _absent_ capability once a deal is real.
- **Effort:** **M** — new `LeadDocument` model (type, file ref, uploadedBy, eoiStage link), an upload/list UI on the lead detail (and inside `EOIPanel`), role-gating (sensitive PII). Blocked on / best done with gap #5 (real blob storage) because passports/agreements routinely exceed 5 MB and shouldn't sit in Postgres.
- **Architecture fit:** Fits the model conventions, but needs the storage backend (#5) first to be done properly.
- **Data-safety / migration:** **High sensitivity.** Passports/KYC are PII — must be access-controlled (ADMIN + owning agent only, mirroring the `passport` handling on `BuyerRecord`), excluded from exports, and retained per policy. Additive table; no change to existing data. Follow the production-safety rule: additive, behind a flag, backup-first.

### 4. Lead distribution and SLA enforcement are switched off

**Plain English:** The CRM has a real auto-distribution engine that hands each new lead to the available agent with the lightest load (respecting who's present and who's on their weekly off), plus a 15-minute "you haven't called your new lead yet" alarm that escalates to the manager. Both are currently **turned off by settings**. Today, website leads all funnel to one fixed person per team (Mehak for Dubai, Tanuj for India), and the speed-to-lead SLA doesn't fire. For an outbound floor, fast and fair lead distribution is the whole game.

- **What's missing:** `roundRobin.enabled` defaults to `"false"` and `automation.autoAssignment` is off, so `pickRoundRobinAgent()` (`src/lib/assignment.ts`) and the time-windowed `chooseOwnerForNewLead()` (`src/lib/assignmentWindow.ts`) don't drive real intake — website leads hard-route to two userIds (`src/lib/leadIngest.ts`). `slaBreach.enabled` defaults to `"false"` (paused 2026-06-22), so `runReconciler()` (`src/lib/reconciler.ts`) detects the 15-min breach but doesn't notify. SLA detection also only runs on page-load (reconciler), not on a guaranteed timer.
- **Why it matters here:** Single-person routing creates a bottleneck and uneven workloads; no SLA means new leads can sit uncalled past the golden first-15-minutes window. These are the two highest-leverage levers for conversion on a calling floor.
- **Effort:** **S** to flip the toggles; **S–M** to tune (decide office-hours behavior, confirm present-agent coverage, validate escalation recipients). Lalit's earlier pause was deliberate — re-enabling is a business decision plus a short validation pass, not new code.
- **Architecture fit:** Fully built and respects attendance + weekly-off today.
- **Data-safety / migration:** Low. Changes who leads get assigned to going forward — verify on a small window first; no historical data touched. Note the open "Overdue boundary" reconciliation decision in memory before flipping SLA.

### 5. File-storage ceiling — 5 MB, in Postgres, no blob backend

**Plain English:** Every file the CRM stores — gallery brochures, voice notes, HR resumes — is squeezed into the Postgres database itself and capped at 5 MB. There's no proper file store (no S3, no Vercel Blob). That's fine for small assets but blocks anything heavier: a full brochure deck, a multi-page signed agreement scan, a longer call/voice recording, or the per-lead document vault (#3).

- **What's missing:** A blob/object-storage backend. The schema comments explicitly note "NO blob backend (@vercel/blob/S3/Cloudinary)"; `Resource.fileData`, `LeadVoiceMessage.audioData`, and HR resumes are `Bytes` in Postgres with a 5 MB API cap.
- **Why it matters here:** It's the structural blocker under document management (#3), richer collateral, and call-recording archival. Large `bytea` rows also bloat the DB and slow backups/queries.
- **Effort:** **M** — provision Vercel Blob (`BLOB_READ_WRITE_TOKEN` + `@vercel/blob`), add an upload helper, migrate new uploads to blob (leave existing small rows in place or backfill lazily).
- **Architecture fit:** Anticipated by the codebase (comments name Vercel Blob as the intended path).
- **Data-safety / migration:** Medium. New writes can go to blob with no migration; an optional backfill of existing `bytea` is data-touching — do it backup-first, additive, verify both before/after. Pure infra/billing decision otherwise.

---

## P1 — Valuable

### 6. Forecasting depth — one static weighted number, no target-vs-actual

**Plain English:** The only forward-looking number is a single weighted-pipeline revenue figure on the reports home (each lead's budget × a fixed weight for its status). There's no proper sales forecast (expected close dates, this-month vs next-month projection, win-rate trend) and no team revenue **target vs actual** view. A sales manager planning a quarter is flying with a snapshot, not a forecast.

- **What's missing:** Pipeline-velocity / close-date forecasting; commit/best-case/worst-case; team & per-agent **revenue target vs actual** (only personal daily call/connect targets and a `Target` model with `REVENUE_AED/INR` metrics exist — the model is there, the reporting view isn't). All other reports under `src/app/(app)/reports/*` are historical/activity.
- **Why it matters here:** Lalit runs revenue targets across two markets; he needs "are we on pace, and what's likely to close" — the manager's core question.
- **Effort:** **M** — add expected-close + forecast computation and a target-vs-actual report; the `Target` model and weighted-forecast logic (`src/app/(app)/reports/page.tsx`) are starting points.
- **Architecture fit:** Good — extends existing reporting and the `Target` model. Keep AED/INR strictly separate (currency rule).
- **Data-safety / migration:** Low; read-only reporting. May want an `expectedCloseDate` field on `Lead` (additive).

### 7. Email is outbound-only and system-flavored — replies don't come back, no 1:1 send

**Plain English:** The CRM can send bulk email campaigns and weekly digests (via Resend), but an agent can't send a one-off email to a single lead from the lead screen, and when a client replies, that reply never appears in the CRM. Email is a real channel for NRI/HNI buyers, especially for sending payment plans and agreements.

- **What's missing:** A 1:1 "email this lead" action on lead detail; inbound reply capture into the timeline (true 2-way). `src/lib/email.ts` (Resend) is outbound transactional only; `src/app/api/leads/bulk-email/route.ts` is bulk-only. The `intake/email` webhook creates _new leads_ from portal emails — it does not thread replies. **Gmail OAuth is blocked** (confirmed: zero Gmail/OAuth code in `src/`), so Google-based 2-way is off the table for now.
- **Why it matters here:** Email is where formal documents and confirmations travel; losing replies means the lead record is incomplete and follow-ups get missed.
- **Effort:** **M–L** — 1:1 send is M (reuse Resend + templates + log an `Activity.EMAIL`). Inbound reply threading is L (needs a reply-to scheme + inbound-parse webhook, e.g. Resend/Postmark inbound; Gmail path blocked).
- **Architecture fit:** 1:1 send fits cleanly; reply-threading is new plumbing.
- **Data-safety / migration:** Low; additive logging.

### 8. No power-dialer / structured calling queue for warm + follow-up work

**Plain English:** There's a good cold-call "session" mode that auto-advances to the next lead after each outcome. But the daily warm/follow-up work (today's callbacks, overdue follow-ups) is worked by clicking into each lead one at a time. A floor doing volume benefits from a single "work my queue" screen that surfaces the next lead, shows context, captures the outcome, and advances — without bouncing back to a list.

- **What's missing:** A unified queue/auto-advance experience for warm follow-ups (the `action-list`, `revisit-queue`, and `leads/inbox` pages are list/triage views, not auto-advancing dialers). Only `src/app/(app)/cold-calls/session` auto-advances (`src/components/ColdCallSession.tsx`).
- **Why it matters here:** Reduces per-call overhead and "what do I do next" friction; keeps agents in flow on a high-volume day. Pairs naturally with live telephony (#1).
- **Effort:** **M** — generalize the cold-call session pattern to a queue driven by the existing follow-up/overdue logic.
- **Architecture fit:** Strong — the auto-advance component and queue queries already exist; this is recomposition.
- **Data-safety / migration:** None; UI over existing data.

### 9. Distribution ignores capacity caps and specialization; no stale-lead reassignment

**Plain English:** Even with round-robin on, the engine balances by "fewest open leads" but has no hard cap (an agent can be buried), no skill/market specialization routing (the `specializations` field exists but isn't used), and never re-distributes a lead that an owner is sitting on / ignoring. Leads can rot with an absent or overloaded agent.

- **What's missing:** Per-agent capacity ceilings; specialization-aware routing (`User.specializations` is dormant); auto-reassign of ghosted/stale owned leads and of leads owned by agents who are absent/on-leave. Today only _unowned_ leads get a 5-min auto-assign; owned leads never move.
- **Why it matters here:** Protects against lead rot and unfair load; routes Dubai-investor vs India-end-user leads to the right closer.
- **Effort:** **M** — add caps + a stale-reassign sweep (a cron slot is available in `.github/workflows/cron.yml`) + optional specialization rules.
- **Architecture fit:** Good — extends `assignment.ts`/`assignmentWindow.ts`; the field and cron infrastructure exist.
- **Data-safety / migration:** Medium — reassignment changes ownership; preserve assignment history (the `Assignment` model already does), guard against thrashing, validate on a window. Respect the rejected-lead/ownership-history rules.

### 10. "Bulk WhatsApp" and SMS campaigns aren't real sends

**Plain English:** Bulk WhatsApp produces a list of `wa.me` links the agent clicks one-by-one — it's not a broadcast. There is no SMS channel at all. For re-engaging a cold list or announcing a new launch, there's no true campaign send.

- **What's missing:** Programmatic broadcast (depends on #2 Meta API being live); SMS provider integration (none exists). `src/app/api/leads/bulk-wa/route.ts` returns links and logs `PLANNED` activities.
- **Why it matters here:** Campaign re-engagement of large cold/revival lists is a standard real-estate motion; manual link-clicking doesn't scale past a handful.
- **Effort:** **S–M** once #2 is live (real bulk send through the Cloud API with approved templates + rate-limiting/opt-out). SMS is a separate provider (M).
- **Architecture fit:** Builds on the WhatsApp send path; SMS is net-new.
- **Data-safety / migration:** Compliance-heavy (opt-out, template approval, rate limits). Low data risk.

---

## P2 — Nice to have

### 11. Commission is tracked but there's no agent incentive/payout statement

**Plain English:** The commission report shows commission booked/received/outstanding per agent and per deal — good. But there's no agent-facing incentive calculation or payout statement (what each agent has _earned_ vs the company commission). Payouts are processed outside the CRM.

- **What's missing:** Incentive-rule modeling (per-agent %/slab) and a per-agent earnings statement. `src/app/(app)/reports/commission/page.tsx` tracks company commission only.
- **Why it matters here:** Motivation/transparency on a target-driven floor; reduces manual payout math.
- **Effort:** **M.** **Architecture fit:** Good (extends commission reporting). **Data-safety:** Low; additive.

### 12. Export is CSV-only and manual; no Excel or scheduled delivery

**Plain English:** Admins can export leads/master-data to CSV (audited, watermarked — nicely done). But there's no native Excel (.xlsx) export and no scheduled/emailed report delivery; managers re-run exports by hand.

- **What's missing:** xlsx export; scheduled report emails. `src/app/api/reports/export/route.ts` is CSV + manual.
- **Why it matters here:** Convenience for a non-technical manager who lives in Excel/Sheets.
- **Effort:** **S.** **Architecture fit:** Good. **Data-safety:** Low (export already role-gated/audited; keep PII rules).

### 13. No offline calling capability

**Plain English:** The app is a cloud app; if the internet drops, agents can read cached pages but cannot log calls or update leads offline and sync later. Field agents (site visits, expos) hit this.

- **What's missing:** Offline mutation queue + sync. The PWA service worker (`public/sw.js`) is network-first read-cache only — no write queue.
- **Why it matters here:** Field/expo work and patchy mobile data; lower frequency than office calling.
- **Effort:** **L** (offline-first sync is genuinely hard). **Architecture fit:** Needs new infra. **Data-safety:** Medium (conflict resolution on sync). Likely defer.

### 14. PWA vs native mobile app

**Plain English:** Agents use an installable PWA (works well, push notifications, mobile card layouts). There's no native iOS/Android app. A native app would unlock more reliable background push (esp. iOS), native dialer integration, and app-store presence.

- **What's missing:** Native app (no React Native/Capacitor/Expo in `package.json`).
- **Why it matters here:** Mostly iOS push reliability + native call integration; the PWA already covers most needs.
- **Effort:** **L.** **Architecture fit:** New infra. **Recommendation:** likely **skip** — invest in the PWA + live telephony instead unless iOS push becomes a blocker.

### 15. Backup hardening — single nightly JSON to GitHub artifacts, no restore tool

**Plain English:** There's a real nightly backup, but it's one JSON snapshot stored as a GitHub Actions artifact (90-day retention) with sensitive fields stripped, and there's no automated restore. Given this is live production data, backup/restore deserves more robustness.

- **What's missing:** Off-platform durable storage, point-in-time/restore tooling, restore drills. `src/app/api/cron/db-backup/route.ts` writes one JSON; recovery is manual.
- **Why it matters here:** Production data safety is the standing #1 rule; a backup you can't quickly restore is half a backup. (Neon also offers its own PITR — worth confirming the tier.)
- **Effort:** **S–M.** **Architecture fit:** Hardens existing. **Data-safety:** This _is_ a data-safety improvement; verify Neon PITR coverage, add durable off-platform copies, document a tested restore path.

---

## Notes & cross-cutting observations

- **The recurring theme is "built, not turned on."** Telephony (#1), WhatsApp API (#2), round-robin + SLA (#4), and bulk send (#10) are all code-complete behind env vars or settings flags. The fastest, highest-ROI work is a focused "activation + validation" pass, not new features. Each flip should follow the production-safety rule (backup-first, validate on a small window, disclose risk).
- **The real build gaps cluster around documents and storage** (#3 + #5) and **forward-looking analytics** (#6). These are where new engineering is genuinely warranted.
- **Cron budget is tight** (Vercel Hobby: 2 cron jobs; the rest live in `.github/workflows/cron.yml`). New scheduled work (stale-reassign #9, scheduled exports #12) must go through the GitHub Actions cron file, not `vercel.json`.
- **Currency + market segregation rules** must be honored in any new reporting/forecasting/payout work: AED and INR never mix; India/Dubai scoping is server-enforced.
- **Anything touching documents/PII** (#3) inherits the strictest access controls already used for `BuyerRecord.passport` and must be excluded from exports.
