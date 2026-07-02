# AI Sales Operating System (WCR Sales Co-Pilot) — Technical Design v2 (Phase 1)

**Status:** DESIGN — awaiting Lalit's approval. Nothing implemented.
**Author:** Claude (quick-work session)
**Version:** v2 — 2026-07-01 (expands v1 "AI Follow-up Intelligence" into a full AI Sales OS per Lalit's directive)
**Scope target:** `C:\Users\Lenovo\whitecollar-crm` (production CRM — Next.js 16 + Prisma + Neon Postgres)

---

## 0. Vision (plain English)

We are not building an AI reminder system. We are building an **AI Sales Manager** inside the CRM that:

- Guides agents every day and tells them exactly what to do first.
- Reads every conversation (call, WhatsApp, note, voice, timeline, imported remarks) and understands **both timing** ("call after Diwali") **and business intent** ("waiting for annual bonus", "loan approval pending", "wife's decision").
- Prioritises work automatically with a live **Priority Score**.
- Detects opportunities (meeting, site visit, Golden Visa, mortgage, ROI review) and recommends the **next best action** with a ready-to-say opening line.
- Prevents missed follow-ups and surfaces **missed revenue** before it becomes a business problem.
- Learns WCR's own sales methodology from every approval/rejection/outcome.
- **Earns authority gradually** — AI starts as an advisor and only gains automatic-action power as it proves accuracy, always reversible, always audited, humans in control of high-impact decisions.

**Hard promise (your standing rules):** Built **additive + behind an Authority/Flag model, default OFF (Level 0/1)**. Phase 2 changes **zero** existing behaviour, touches **zero** existing leads, reads only **new** conversations. Backfill and any automatic action come only in later phases, each with backup, approval, and rollback.

---

## 1. Governance first — the AI Authority Model

This is the backbone. Instead of a simple ON/OFF switch, **every AI capability** has its own **authority level**, stored in config and adjustable **without deployment**. This is how AI "earns" power.

| Level | Name | What AI may do |
|---|---|---|
| **0** | Observe | Read only. No recommendations shown. (Silent shadow mode — used to validate detection accuracy before anyone sees output.) |
| **1** | Recommend | Creates recommendations + notifications. **No automatic action.** |
| **2** | Assisted | AI **prepares** an action (pre-fills reactivation/assignment/task); a human clicks approve. |
| **3** | Semi-Autonomous | AI performs **low-risk** actions automatically (e.g. create task, set priority, snooze); humans review exceptions. |
| **4** | Autonomous | AI manages routine follow-ups/reactivations automatically under strict conditions; humans supervise only high-risk cases. |

**Per-capability** (each independently set): Follow-up Detection · Business-Intent Detection · Reactivation · Assignment · Priority Scoring · Opportunity/Next-Best-Action · Daily Planner · Agent Coaching · Learning · Missed-Revenue.

**Adaptive Autonomy (Phase 5):** authority can auto-promote/demote based on **measured accuracy**. Example policy: if a capability sustains ≥98% accuracy + low false-positive rate + high acceptance for 3 months → eligible to rise one level; if accuracy drops below threshold → **automatic fallback** to Level ≤2 (approval mode). Every promotion/demotion is logged. Promotion is never automatic past a configured **ceiling** you set per capability (e.g. Reactivation ceiling = Level 2 until you personally raise it).

**Auto-reactivation conditions (Level ≥3, ALL must be true):** client explicitly requested future contact · follow-up date unambiguous · confidence ≥ threshold · lead closed **only** for the future-follow-up reason · no compliance restriction · no conflicting recent activity · no human already acted · not already reactivated · approval window expired. Every automatic action writes Activity + Audit log, records **why AI acted**, and is fully reversible.

---

## 2. Architecture — the engine stack

```
 New / historical conversation entry
        │
        ▼
 LAYER 1  RULE ENGINE (instant, 0 tokens)      → dates: 10min/1hr/tomorrow/next week/20 days/1 month/6 months/DD-MM-YYYY/festivals
        │ not confident?
        ▼
 LAYER 2  AI UNDERSTANDING (only if enabled)   → fuzzy timing + BUSINESS INTENT (bonus, loan, visa, family decision, possession…)
        │
        ▼
 SIGNAL + RECOMMENDATION store (DB)            → structured, confidence-scored, source-linked
        │
        ├──► PRIORITY ENGINE      → live 0–100 score per lead
        ├──► OPPORTUNITY ENGINE   → next best action (meeting / site visit / mortgage / golden visa…)
        ├──► COACHING ENGINE      → context recap + ready-to-say opening line
        ├──► DAILY PLANNER        → per-agent "today's plan" on login
        ├──► MANAGER ANALYTICS    → discipline, acceptance, conversion insights
        └──► MISSED-REVENUE       → leakage estimate (missed follow-ups → lost meetings/visits → ₹ potential)
        │
        ▼
 LAYER 3  LEARNING ENGINE  → every decision + outcome → tunes confidence, patterns, timing, priority weights, authority level
```

Layer 1 is deterministic and free (source of truth for common phrases). Layer 2 uses the existing `src/lib/ai.ts` provider abstraction (Gemini/Anthropic), gated by `ai.enabled` + monthly cost cap; while the provider is being finalised the system runs Layer-1-only and Layer 2 is wired ready-to-switch-on. Layer 3 v1 = decision/outcome capture + aggregate-driven tuning (honest scope: not an unsupervised self-training model on day one; that is the long-term phase built on this dataset).

---

## 3. The Agent Workspace (`/ai-actions`) — the agent's main screen

Not a reminder page — the agent's **intelligent work queue**, worked top-to-bottom, role-scoped (`leadScopeWhere`). Colour-coded sections:

- 🔴 **Immediate Actions** — 10-min / 1-hour / today callbacks
- 🟠 **Fresh Leads** — today's newly assigned (see §4)
- 🟡 **Follow-ups Due**
- 🔵 **Reactivation Candidates**
- 🟢 **Meeting Opportunities**
- 🟣 **Site Visit Opportunities**
- ⭐ **High Priority Clients** (by Priority Score)
- 💰 **High Revenue Potential**
- ⚠️ **Missed Opportunities**

Each card: client · lead status · agent · original sentence · detected intent · reason · confidence · source (call/WA/note/voice) · due date/time · **Priority Score** · suggested next action · coaching opener. One-click: **Call · WhatsApp · Email · Share Brochure · Book Virtual Meeting · Book Site Visit · Snooze · Complete · Reactivate · Assign · Ignore(reason)** + feedback chips (👍 Good / 👎 Wrong / Not relevant / Already handled). All buttons call existing proven endpoints — no new lead-mutation logic invented.

---

## 4. Fresh Leads must never get lost (high priority)

A separate, always-on protection (independent of AI provider):
- Today's newly-assigned leads pinned to the top of `/ai-actions` **and** the Leads list.
- **NEW badge** + distinct background colour + "First Call Pending" / "Not Contacted Yet" state.
- A lead stays highlighted **until the first meaningful interaction is logged** (a connected call / meeting / substantive note — not just an auto-log). Derived from existing Activity/CallLog data; no schema needed beyond a computed flag, optionally cached in `aiFirstTouchAt` on Lead.
- Backed by the existing `slaFirstCallBy` clock and unassigned-reminder escalations, but now **visible on-screen**, because notifications disappear and the screen does not.

---

## 5. Detection — timing **and** business intent

### 5.1 Timing (Layer 1 rules) — `ruleEngine.ts`
`N min/hour/day/week/month/year` (+ Hinglish: din/hafta/mahina/saal/kal/parso), tomorrow/next week/next month, `on DD/MM/YYYY`, `DD Mon`, bare month ("in July" → month precision), festival map (Diwali/Holi/Eid/Ramadan/Dussehra/Christmas/New Year…, per-year `festivalDates.ts`, MEDIUM confidence), soft-defer ("not now/call later" no date → LOW review nudge, never auto-acts).

### 5.2 Business intent (Layer 2 AI) — new taxonomy → structured `AiSignal`
Detects and classifies: budget increase/decrease · family/spouse decision pending · loan/mortgage approval pending · visa process · job relocation · salary increment · bonus expected · business cash-flow · retirement · school admission · rental-income objective · self-use objective · waiting for possession · waiting for project launch. Each becomes an `AiSignal` with confidence, source sentence, and an **inferred review/trigger date** where possible ("after annual bonus" → estimated month), feeding the recommendation + priority + opportunity engines.

---

## 6. Priority Score engine (live 0–100 per lead)

A transparent weighted score, recomputed on new activity + nightly (reuse `rescore-all` cron). Inputs (weights tunable, learning-adjusted): fresh-lead recency · budget band · buying-intent signals · follow-up overdue · website activity · WhatsApp engagement · #conversations · AI confidence · modelled conversion probability. Stored additively on Lead (`aiPriorityScore Int?`, `aiPriorityUpdatedAt`, `aiPriorityBreakdown` JSON). Agents' queues sort by it; "High Priority Clients" / "High Revenue Potential" buckets read it. Fully explainable (breakdown shown on hover) — no black box.

---

## 7. Opportunity & Next-Best-Action engine

From signals + stage + market, recommends the next business step: Book Virtual Meeting · Book Site Visit · Share Brochure · Discuss Golden Visa · Mortgage Consultation · Investment/ROI Review · Secondary-Market Opportunity · Rental-Strategy Discussion. Surfaced as the card's suggested action + as **AI Action Plans** (structured tasks: Call/WhatsApp/Email/Brochure/Meeting/Visit/Mortgage/Proposal) the agent can execute or schedule directly.

---

## 8. Agent Coaching engine

Never "call this client." Instead a context recap + opener, e.g.:
> **Last discussion:** 2BR Dubai Marina · Budget AED 2M · waiting for annual bonus · last spoke 6 months ago.
> **Suggested opening:** "Hi Mr. Sharma, when we last spoke you wanted to reconnect once your annual bonus was credited — I thought this would be a good time to check in."
> **Ask:** budget still valid? · ready for a virtual meeting/site visit? **Next best action:** Book Virtual Meeting.

Built from the lead's signals + timeline via the existing extraction/summary infrastructure. Guidance is advisory text — zero data mutation.

---

## 9. AI Daily Planner

On agent login, auto-generates today's plan (cached in `AiDailyPlan` per user/day):
> **Today's Plan** — 18 Fresh Leads · 7 Follow-ups Due · 4 High-Priority Clients · 2 Site-Visit Opportunities · 3 Reactivation Candidates.

Tells the agent exactly what needs attention first (ordered by Priority Score). Managers get a team roll-up.

---

## 10. AI Manager Dashboard

Manager/Admin insights (read-only analytics from feedback + activity): agents ignoring AI recommendations · average response time · follow-up discipline · first-call completion rate · missed follow-ups · AI-recommendation acceptance rate · meetings booked · site visits booked · conversion improvement over time.

---

## 11. AI Missed-Revenue Detector (new module)

Quantifies leakage from missed follow-ups so management sees it early:
> Missed Follow-ups: 126 · Est. Lost Meetings: 18 · Est. Lost Site Visits: 7 · **Est. Potential Revenue: ₹1.8 Cr**

Computed from overdue/missed recommendations × configurable conversion rates × average deal value (per market/project). Daily snapshot cron writes `AiRevenueSnapshot` for trend charts. All assumptions are configurable and shown, so the number is defensible, not magic.

---

## 12. Learning engine (beyond feedback)

Captures + aggregates: which recommendations are accepted/ignored · which reminders generate meetings · which phrases convert best · which follow-up timings produce the highest success · which objection-handling works · which projects convert better. Feeds: confidence tuning, phrase→trigger mappings, priority weights, and **authority auto-promote/demote** (§1). Goal: the CRM gradually learns WCR's own methodology. (v1 = data + aggregate tuning; autonomous ML is the later phase built on this labelled dataset.)

---

## 13. Database design (all strictly additive)

**Principle:** new tables + new **nullable** columns + new enum values only. No existing column altered/renamed/dropped. Existing CRM runs byte-for-byte identically at Authority Level 0/flags-off. Clean paired down-migration for full rollback.

### New tables
- **`AiRecommendation`** — core actionable item (leadId?/buyerId?, kind, status lifecycle, dueAt, duePrecision, confidence, band, triggerSentence, reason, suggestedAction, guidanceScript, source, sourceRef, assignedAgentId snapshot, leadStatusSnapshot, wasCallLaterClose, approvalWindowEndsAt, reminderWritten, resolved*, dedupeKey unique, metadata JSON). Indexes: (status,dueAt), (assignedAgentId,status), (kind,status,dueAt), (leadId).
- **`AiSignal`** — detected business-intent/engagement signals (leadId, type enum [BUDGET_UP, BUDGET_DOWN, FAMILY_DECISION, LOAN_PENDING, VISA, RELOCATION, INCREMENT, BONUS, CASHFLOW, RETIREMENT, SCHOOL_ADMISSION, RENTAL_OBJECTIVE, SELFUSE_OBJECTIVE, WAIT_POSSESSION, WAIT_LAUNCH, …], confidence, source, sourceSentence, inferredDate?, createdAt). Feeds priority/opportunity/coaching.
- **`AiRecommendationFeedback`** — learning loop (recommendationId, userId, verdict [GOOD/WRONG/NOT_RELEVANT/ALREADY_HANDLED], actionTaken, note).
- **`AiCapabilityPolicy`** — governance (capability key, authorityLevel 0–4, ceilingLevel, minConfidence, autoAdaptEnabled, updatedById, updatedAt). One row per capability; the adaptive-autonomy + audit backbone.
- **`AiCapabilityMetric`** — daily accuracy/acceptance snapshot per capability (for auto-promote/demote + manager dashboard).
- **`AiDailyPlan`** — cached per-agent per-day plan.
- **`AiRevenueSnapshot`** — daily missed-revenue figures for trend.
- **`AiBackfillCheckpoint`** — resumable batched Phase-4 backfill (cursor, totals, status, lastError).

### New columns on `Lead` (all nullable, additive)
`aiPriorityScore Int?` · `aiPriorityUpdatedAt DateTime?` · `aiPriorityBreakdown String?` (JSON) · `aiFirstTouchAt DateTime?` (Fresh-Lead highlight). Back-relations `aiRecommendations`, `aiSignals` (schema-only, no columns on other tables). `BuyerRecord` gets the same back-relation for later reuse.

### New enums + 2 `NotifKind` values (AI_FOLLOWUP_DUE, AI_REACTIVATION) — enum add is non-blocking.

**Performance:** recommendation/signal rows are bounded by *conversations containing intent* (a fraction of all remarks), not one-per-remark. Priority recompute reuses the nightly `rescore-all` cron. All writes decoupled from the request path (fire-and-forget/cron) → **zero added latency** on agent actions. Migration DDL is sub-second; no data-moving `ALTER COLUMN` on big tables.

**Rollback:** flags/authority to 0 = instant stop, no data mutated. Paired down-migration drops new tables/columns/enums, restoring exact prior schema. Auto-actions (Level ≥3 only) each reversible via existing Reactivate/Reject flow + full audit.

---

## 14. Detection hooks (unchanged from v1)
Fire-and-forget `scanConversation({leadId, source, text, sourceRef})` added to the 6 existing write paths (log-call, note, whatsapp/log, meeting, voice-message, escalation) + the Phase-4 import/backfill path. Non-blocking, exactly like the existing `notifyHotLead(...).catch()` pattern.

---

## 15. Crons (new, flag-gated)
- `/api/cron/ai-followup-due` (5-min, window-dedupe) — notify agent + Lalit (`isSuperAdmin`) when `dueAt` arrives; flip status; message "This client asked to reconnect after 6 months. Time is complete now. Please call."
- `/api/cron/ai-reactivation-window` (hourly) — open T-24h approval windows; perform Level-≥3 policy-gated auto-reactivation.
- `/api/cron/ai-priority-planner` (nightly, piggyback rescore-all) — recompute Priority Score, build Daily Plans, write Missed-Revenue + Capability metrics.

---

## 16. Feature flags & authority (all default OFF / Level 0–1)
`Setting` table + typed accessors. Master `aiSalesOs.enabled=false`; per-capability authority rows in `AiCapabilityPolicy` (default Level 1 Recommend, Reactivation ceiling Level 2); thresholds `ai.*.confidence.autoMin` (0.90), `ai.reactivation.approvalWindowHours` (24), `ai.dailyLimit` (200). Each module independently on/off without deploy.

---

## 17. Deploy-gate additions (read-only regression invariants)
`ai-no-mutate-when-observe` (Level 0/1 → no lead mutated) · `ai-reactivation-eligibility` (no auto-reactivation unless all §1 conditions) · `ai-confidence-bounds` · `ai-rec-dedupe` · `ai-authority-ceiling` (no capability above its ceiling) · `ai-priority-bounds` (0–100). tsc + regression green before `npm run push`.

---

## 18. Phased rollout (aligned to your Auto-Reactivation policy)

- **Phase 1 — Design & approval (this doc).** ⬅ here. No code.
- **Phase 2 — Build behind flags, Authority Level 0/1.** All engines + workspace + priority + coaching + planner + manager dashboard + missed-revenue + reactivation logic **fully implemented but disabled** (detection/validation only). **Zero existing behaviour/leads/history changed.** New remarks only. tsc + regression green. Schema hand-applied to Neon + logged in MIGRATION-LEDGER before code deploy.
- **Phase 3 — Internal testing (Admin only).** Recommendations enabled; AI detects follow-ups, reactivation candidates, priority, assignment, guidance. **All reactivations require human approval.** Every approve/reject recorded → learning. Test all §21 scenarios across rejected/closed/archived/buyer/cold/normal.
- **Phase 4 — Controlled automation + historical backfill (separate approval).** Backup → count → verify → migration report. Backfill batched/checkpointed, never locks CRM, progress visible; due-today/future → reminders, past → "Overdue AI Follow-up". Selected low-risk capabilities may move to Level 3 under the strict all-conditions gate.
- **Phase 5 — Adaptive autonomy.** Authority auto-promotes/demotes on measured accuracy (≥98% 3-month sustained → eligible; drop → auto-fallback to approval), within your per-capability ceilings. Staged enablement Admin → Lalit → Managers → Agents.

---

## 19. What is safe vs. what needs your explicit sign-off later
**Safe now (Phase 2, no approval-per-item):** all detection, recommendations, priority, coaching, planner, dashboards, missed-revenue — because none mutate leads (Level 0/1). **Needs your explicit later sign-off:** raising any capability to Level ≥2/3, running the historical backfill, and enabling Layer-2 AI (provider + cost). These are gated separately and never auto-enabled.

---

## 20. Honest scope notes
- "Learns/earns autonomy" v1 = decision+outcome capture + aggregate tuning + accuracy-gated authority; a true unsupervised self-training model is the long-term phase built on this dataset.
- Missed-revenue ₹ figures are **modelled estimates** from configurable conversion rates + avg deal value, always shown with assumptions.
- Layer-2/business-intent quality depends on the AI provider being live; Layer-1 + Fresh-Lead + Priority(rule-based parts) work without it.

---

## 21. Test matrix (Phase 3 acceptance)
| Input | Expected |
|---|---|
| "Call me after 10 minutes" | reminder now+10m, HIGH, RULE |
| "Connect after one month" | now+1mo, HIGH, RULE |
| "Call me after 6 months" | now+6mo, HIGH, RULE |
| "Call in July" | next July, MONTH precision, MEDIUM |
| "Not interested now, call after Diwali" | festival date, MEDIUM; if closed for this reason → reactivation candidate (approval) |
| "I am travelling, call next week" | now+7d, HIGH, RULE |
| "Waiting for annual bonus" | AiSignal BONUS + inferred date, coaching opener, MEDIUM |
| "Wife's decision pending / loan approval pending" | AiSignal FAMILY_DECISION / LOAN_PENDING, priority + next-best-action |
| "after my daughter's wedding" | Layer-2 EVENT estimate, MEDIUM, approval |
| Fresh lead assigned today | pinned top, NEW badge, First-Call-Pending until first meaningful interaction |
| Rejected lead w/ call-later reason | reactivation candidate; auto only at Level ≥3 with all conditions |
| Closed lead, no future instruction | **no** recommendation, **no** reactivation |
| Vague/name-only remark | LOW at most; never auto-acts |

---

## 22. Open questions for Lalit (before Phase 2)
1. Confirm **Reactivation ceiling = Level 2** (human approves every reactivation) until you personally raise it after Phase-4 accuracy is proven? (Recommended.)
2. Proceed **Layer-1 + non-AI capabilities first**, switch Layer-2 (business-intent) on once the Gemini/Anthropic key is finalised? (Recommended — nothing blocked.)
3. Missed-Revenue: provide default **conversion rates + avg deal value** per market (Dubai AED / India INR) so the ₹ estimate is realistic.
4. Festival list + which market each applies to.

---

*End of Phase 1 design v2. Awaiting approval to proceed to Phase 2 (build behind flags at Authority Level 0/1 — no data touched).*
