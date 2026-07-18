# Call-Logging Completeness Audit (P0)

**Date:** 2026-07-18 · **Auditor:** Agent-CL4 · **Mode:** READ-ONLY (zero source edits, all DB queries read-only)

**Requirement under audit (Lalit):** *"Every outbound or connected call made from ANYWHERE in the CRM must create a Call Log entry in the centralized Call Logs module. There should never be module-specific call logging behavior."*

---

## Executive summary

| | |
|---|---|
| Ways a call can be initiated in the sales UI | **17 surfaces** |
| Surfaces that write a `CallLog` row on the dial itself | **0** |
| Surfaces that write *anything* on the dial | **1** (`LeadActionsClient.tsx:364`, and it writes an `Activity`, not a `CallLog`) |
| Paths that reliably produce a `CallLog` | **3** — the Lead "Log Conversation" modal, the Revival cold-call session, and the telephony sink |
| `CallLog` rows in prod | **4,530** — 100% `leadId`, **0** `buyerId`, **0** telephony-sourced |
| Buyer calls missing from `CallLog` | **2,776** (766 genuine agent-logged + 2,010 import-synthesized) |

**The single structural truth of this codebase:** `CallLog` is written by *outcome-logging* code, never by *dialing* code. Every "Call" button in the CRM is a presentational `tel:` link (`ActionButton.tsx:9-11` — *"VISUAL ONLY… behaviour stays entirely with the caller"*), and only two callers ever attach behaviour. A call therefore reaches the central Call Logs **only if the agent separately fills in the Log Conversation form**.

Buyer Data was the one module with a genuinely divergent *logging* path; that fix landed in the working tree today (`buyerLifecycle.ts:378-396`) but has **produced zero rows in production** and the historical backfill has not run.

---

## Matrix — every call entry point

Legend: **CL** = central `CallLog` · **Act** = `Activity` (lead timeline) · **BA** = `BuyerActivity` (buyer timeline)

### A. Leads · Master Data · Revival (all are `Lead` rows)

| # | Entry point (file:line) | Surface | Writes | Reaches Call Logs? | Verdict | Fix |
|---|---|---|---|---|---|---|
| 1 | `src/components/LeadActionsClient.tsx:364` | Lead detail — primary **Call** | `Act` CALL, outcome `"Initiated"` (via `/call-initiated`) | ❌ | **GAP-2** | Make the beacon write CL |
| 2 | `src/components/LeadActionsClient.tsx:281` → `/api/leads/[id]/log-call` | Lead detail — **Log Conversation** modal | **CL** + `Act` | ✅ | correct — reference implementation | — |
| 3 | `src/components/LeadActionsClient.tsx:401` | Lead detail — **Call alt** | *nothing* | ❌ | **GAP-1** | attach beacon |
| 4 | `src/components/ContactField.tsx:38` | Lead detail — phone field `tel:` link | *nothing* | ❌ | **GAP-1** | attach beacon |
| 5 | `src/components/LeadsListClient.tsx:1051` | Leads list — table row icon | *nothing* | ❌ | **GAP-1** | attach beacon |
| 6 | `src/components/LeadsListClient.tsx:1157` | Leads list — mobile card | *nothing* (only `stopPropagation`) | ❌ | **GAP-1** | attach beacon |
| 7 | `src/components/LeadsListClient.tsx:1333` | Leads list — round call FAB | *nothing* | ❌ | **GAP-1** | attach beacon |
| 8 | `src/components/LeadsListClient.tsx:1555` | Leads list — solid icon variant | *nothing* | ❌ | **GAP-1** | attach beacon |
| 9 | `src/components/ActionCardClient.tsx:249` | Action List / follow-up card | *nothing* | ❌ | **GAP-1** | attach beacon |
| 10 | `src/app/(app)/activities/page.tsx:406` (anchor ~`:425`) | Activities page row | *nothing* (server component, static `<a>`) | ❌ | **GAP-1** | needs a client island |
| 11 | `src/components/InboxClient.tsx:201` | Inbox — list | *nothing* | ❌ | **GAP-1** | attach beacon |
| 12 | `src/components/InboxClient.tsx:305` | Inbox — detail pane | *nothing* | ❌ | **GAP-1** | attach beacon |
| 13 | `src/components/CallsClient.tsx:193` | **Call Records page** (`/calls`) — per-lead Call button | *nothing* | ❌ | **GAP-1** (most ironic instance: a call placed from the call-reporting page is itself unlogged) | attach beacon |
| 14 | `src/components/LinkedContactsCard.tsx:119` | Linked contacts — alt contact | *nothing* | ❌ | **GAP-1** | attach beacon |
| 15 | `src/components/HiddenGemsBanner.tsx:123` | Revival — Hidden Gems banner | *nothing* | ❌ | **GAP-1** | attach beacon |
| 16 | `src/components/RevivalEngineListClient.tsx:349` | Revival list — desktop | *nothing* | ❌ | **GAP-1** | attach beacon |
| 17 | `src/components/RevivalEngineListClient.tsx:482` | Revival list — mobile | *nothing* | ❌ | **GAP-1** | attach beacon |
| 18 | `src/components/ColdCallSession.tsx:275` | Revival — "Tap to call" | *nothing on tap* | ❌ tap | acceptable — see #19 | attach beacon |
| 19 | `src/components/ColdCallSession.tsx:98` → `/log-call` | Revival — session outcome save | **CL** + `Act` | ✅ | **correct — the best pattern in the codebase** (dial and mandatory outcome capture are one flow) | — |

### B. Buyer Data

| # | Entry point (file:line) | Writes | Reaches Call Logs? | Verdict | Fix |
|---|---|---|---|---|---|
| 20 | `src/components/BuyerActionsClient.tsx:152` — **Call** | *nothing* | ❌ | **GAP-1** | attach beacon |
| 21 | `src/components/BuyerActionsClient.tsx:182` — **Call alt** | *nothing* | ❌ | **GAP-1** | attach beacon |
| 22 | `src/components/BuyerActionsClient.tsx:103` → `/api/buyer-data/[id]/activity:49` → `buyerLifecycle.ts:359` `logBuyerContactInTx` | `BA` **+ CL** (`buyerLifecycle.ts:384`) | ✅ *in code* / ❌ *in data* | **GAP-3** — fix landed today, **0 rows in prod**, backfill owed | deploy + backfill |

### C. Telephony (provider-driven)

| # | Entry point (file:line) | Writes | Reaches Call Logs? | Verdict |
|---|---|---|---|---|
| 23 | `src/app/api/telephony/click-to-call/route.ts:57` | no immediate write — CL arrives via webhook | ✅ deferred | correct by design |
| 24 | `src/app/api/acefone/click-to-call/route.ts:28` | no immediate write — CL arrives via webhook | ✅ deferred | correct by design |
| 25 | `src/lib/telephony/recordCall.ts:82` (generic sink) | **CL** + `Act` (lead) / `BA` (buyer); idempotent on `ivrCallId:57` | ✅ | correct — resolves Lead **or** Buyer via `linkResolver.ts` |
| 26 | `src/app/api/acefone/webhook/route.ts:130` (legacy) | **CL**, but resolves **Lead only** (`:67`) | ⚠️ partial | **GAP-5** — a buyer's number yields an unlinked CallLog |

### D. HR (separate pipeline)

| # | Entry point | Writes | Reaches Call Logs? | Verdict |
|---|---|---|---|---|
| 27 | 7 × `src/components/hr-dashboard/*.tsx` (CallNowQueue `:198`, ExpectedJoinings `:229`, NoNextActionQueue `:195`, NoShowRecovery `:200`, PendingConfirmations `:153`, RecentActivityFeed `:246`, TodaysInterviews `:196`) | *nothing* — zero `fetch(` in the whole directory | ❌ | **BY DESIGN** |
| 28 | `HRCandidateDetail.tsx:695`, `:634`; `HRCandidateTable.tsx:627`, `:964`; `HRFollowUpActions.tsx:82`; `HRInterviewRowActions.tsx:73`; `(hr)/hr/followups/page.tsx:91`; `(hr)/hr/candidates/[id]/timeline/page.tsx:132` | *nothing* | ❌ | **BY DESIGN** |
| 29 | `HRCandidateDetail.tsx:327` → `/api/hr/candidates/[id]/log/route.ts:68` | `HRActivity` + `HRCandidate.status` | ❌ | **BY DESIGN** — see exclusions |

### E. Automation / bulk (no human dial)

| Path | Writes | Verdict |
|---|---|---|
| `src/app/api/cron/telephony-sync` `:18` → `syncEngine.ts:21` → `recordCall.ts` | **CL** + timeline + lead attempt | correct |
| `src/app/api/cron/telephony-retry` `:18` → `retryQueue.ts:57` → `recordCall.ts` | **CL** + timeline + lead attempt | correct |
| `src/app/api/buyer-data/import/route.ts:397`, `:459` | `BA` `type:"CALL"` (from `buyerRemarkTimeline.ts:47-63`), **no CL**, no attempt | **GAP-4** |
| `src/app/api/intake/csv/route.ts:463` (`callLogsCreated = 0`, rationale `:1094-1103`) | deliberately **no** CL | **correct — this is the policy the buyer importer should match** |
| `src/app/api/buyer-data/[id]/convert/route.ts:207`,`:215` | copies `BA` CALL → `Act` CALL with outcome `"Logged"`, **no CL**; `:223` re-points genuine buyer CLs | **GAP-7** |
| `leads/bulk:217`, `master-data/bulk:163`, `buyer-data/bulk`, `cold-data/bulk-assign`, `buyer-data/distribute`, `admin/assistant/execute` → `adminAssistant/engine.ts:117-127` | NOTE / STATUS_CHANGE / assignment only | correct — cannot fabricate a call |
| `src/lib/workflowEngine.ts:141-232` (7 action types; `SET_FIELD` allowlist `:227` excludes `attemptCount`) | WHATSAPP / EMAIL / TASK / notify / tag | correct — cannot fabricate a call |
| `cron/revival-sweep`, `re-engage`, `evening-reminder`, `followup-rollover`, +12 others | read CallLog as signal; write no calls | correct |

---

## GAPS — ranked by impact

### GAP-1 · Every "Call" button in the CRM is a dead `tel:` link (15 surfaces, all 4 sales modules)
**Where:** rows 3–18, 20–21 of the matrix — `LeadsListClient.tsx:1051/1157/1333/1555`, `ActionCardClient.tsx:249`, `InboxClient.tsx:201/305`, `CallsClient.tsx:193` (the `/calls` Call Records page), `RevivalEngineListClient.tsx:349/482`, `HiddenGemsBanner.tsx:123`, `LinkedContactsCard.tsx:119`, `ContactField.tsx:38`, `BuyerActionsClient.tsx:152/182`, `LeadActionsClient.tsx:401`, `activities/page.tsx:406`, `ColdCallSession.tsx:275`.

This is the largest surface-area breach of the P0 and the truest instance of "module-specific behavior": of 17 dial affordances, exactly **one** (`LeadActionsClient.tsx:364`) reports anything to the server, and even that one bypasses `CallLog`. An agent who works from the Leads list, the Action List, the Inbox, the Revival list or the Buyer detail can dial all day and generate zero central call records. `ActionButton`/`ActionIconButton` are confirmed side-effect-free (`ActionButton.tsx:9-11`, `ActionIconButton.tsx:14`), so nothing is being logged implicitly.

**Fix:** introduce one shared client helper — `useDialBeacon(target)` returning an `onClick` that `fetch`es a single canonical endpoint with `keepalive:true` — and attach it to the `onClick` of all 15 sites (they already accept `onClick`; `ActionButton.tsx:61` and `ActionIconButton` forward it to the `<a>`). Two sites need structural work first: `activities/page.tsx:406` is a server component and needs a client island, and `ContactField.tsx:38` must not swallow its existing copy/edit handlers. Route the beacon into the same endpoint chosen for GAP-2 so there is exactly one dial-recording path. **Caveat to state plainly to Lalit:** a `tel:` tap proves a *dial was initiated*, not that a call connected, and on desktop it may do nothing at all — so these rows must be visually distinct in the Call Logs module (see GAP-2) or they will inflate connected-call counts.

### GAP-2 · The one dial that *is* recorded lands in `Activity`, not `CallLog` — 1,413 rows invisible to Call Logs
**Where:** `src/components/LeadActionsClient.tsx:99` → `src/app/api/leads/[id]/call-initiated/route.ts:13-26`. It creates `Activity{type:CALL, outcome:"Initiated"}` and updates `lastTouchedAt`; it never touches `prisma.callLog`.

**1,413 such rows exist (1,408 in the last 30 days)** — the feature is live and heavily used, and every one of those dials is absent from the centralized Call Logs module.

**Fix:** have `call-initiated` also create a `CallLog` row (`leadId`, `userId`, `direction:OUTBOUND`, `phoneNumber`, `startedAt`) inside one transaction with the `Activity`. **This needs a decision from Lalit before it can be built:** `CallOutcome` (`schema.prisma:1211-1220`) has no value meaning "dialed, no result yet", and the column is `NOT NULL`. Either (a) add a `CallOutcome.INITIATED` enum member — an additive migration, but a migration, so it falls under the production-safety rule and needs approval; or (b) reuse `NOT_PICKED`, which is factually wrong and would corrupt the attempt/ghosting engine that keys on it (`callAttempts.ts:116-119`); or (c) make `outcome` nullable. **(a) is the correct option** — and every read surface must then exclude `INITIATED` from connected-call and talk-time metrics, exactly as `CONNECTED_OUTCOMES` (`callOutcome.ts:13`) already gates. Do **not** ship (b).

### GAP-3 · Buyer calls: 2,776 missing rows; the code fix is in the tree but has produced **0** rows in prod
**Where:** `src/lib/buyerLifecycle.ts:378-396` (the fix), called from `/api/buyer-data/[id]/activity/route.ts:49`.

The single-source rule landed today and looks correct: `CALL_LOGGED_TYPES` (`:95-99`) covers `CALL` + both phone attempt types and rightly excludes `ATTEMPT_WA_NO_RESPONSE`; `CALL_OUTCOME_BY_ACTIVITY_TYPE` (`:107-111`) maps them to `CONNECTED`/`NOT_PICKED`; the write shares the caller's `tx` so it is atomic with the activity and the counter.

**But production still reads `callLog.buyerId` count = 0, and the 5 most recent buyer CallLogs = none.** So either the fix is not yet deployed or no buyer call has been logged since it was. Meanwhile the deficit stands at **2,776** rows and accrues at **766 genuine agent-logged buyer calls per 30 days**.

**Fix:** deploy, then run `scripts/backfill-buyer-calllogs.ts` (`:498` uses `createMany({skipDuplicates:true})`). **Critical constraint on that backfill:** only **766** of the 2,776 rows are genuine agent-logged calls — the other **2,010** are import-synthesized rows tagged `"(imported)"` (see GAP-4). Backfilling all 2,776 would manufacture 2,010 calls that never happened and would contradict the explicit lead-side policy at `intake/csv/route.ts:1094-1103`. The backfill must filter on `userId IS NOT NULL` (or exclude the `(imported)` tag) and the excluded count must be reported. Also verify the `⚠️ NEVER COUNT BUYER CALLS FROM BuyerActivity AGAIN` warning at `buyerLifecycle.ts:85-89` has actually been honoured in every read surface, or buyer calls will double-count the moment the backfill lands.

### GAP-4 · The buyer importer still fabricates `CALL` rows — the live path, not just history
**Where:** `src/app/api/buyer-data/import/route.ts:397`, `:459`, fed by `src/lib/buyerRemarkTimeline.ts:47-63` which maps parsed remark events (`CALL_CONNECTED`, `CALL_NOT_PICKED`, `SITE_VISIT`, `MEETING`, …) to `BuyerActivity type:"CALL"`.

**2,010 such rows exist.** The lead-side importer refuses to do this on principle (`intake/csv/route.ts:1094-1103`: manufactured remark-derived calls are "fake calls"). The buyer importer has no such guard, so every future buyer import re-opens the divergence — and now, post-GAP-3, risks pushing fabricated calls into `CallLog` if the timeline plan is ever routed through `logBuyerContactInTx`.

**Fix:** adopt the lead-side policy — keep import-derived rows as `NOTE` (or a distinct `IMPORTED_CALL` type) so they render in the conversation timeline but never enter the call-count universe. Whichever way Lalit rules, the two importers must agree; today they are opposite.

### GAP-5 · The legacy Acefone webhook cannot link a buyer — latent
**Where:** `src/app/api/acefone/webhook/route.ts:67` resolves only `prisma.lead.findFirst(...)`; there is no `BuyerRecord` lookup, and its `callLog.create` (`:130`) sets `leadId` only. A call to a buyer's number produces a `CallLog` with both `leadId` and `buyerId` null — an orphan visible in no record's timeline. The generic sink does this correctly via `resolveCallLink` (`recordCall.ts:40`, `linkResolver.ts:33`).

**Latent, not active:** `CallLog` rows with a non-null `ivrProvider` = **0**, so neither telephony path has ever fired in production. It will bite the day credentials are pasted in.

**Fix:** delete the bespoke implementation and have the Acefone webhook normalize its payload into a `NormalizedCallEvent` and call `recordCallEvent()` like every other provider. That also collapses the two parallel `CallLog` writers (`recordCall.ts:82` and `acefone/webhook:130`) into one, removing the drift risk. Both are individually idempotent (`:57` and `:114` dedupe on `ivrCallId`), so this is a safe consolidation.

### GAP-6 · Buyer telephony calls never advance `attemptCount` — latent
**Where:** `src/lib/telephony/recordCall.ts:127-135`. The lead branch calls `recordLeadCallAttempt` (`:123`); the buyer branch writes `prisma.buyerActivity.create` directly and bypasses `logBuyerContactInTx`, the only code that increments `BuyerRecord.attemptCount` (`buyerLifecycle.ts:402-406`) and `attemptsInStint` (`:410-413`). A provider-sourced buyer call therefore never moves the 5-attempt auto-return rule (`:153`, `:416`). Latent for the same reason as GAP-5.

**Fix:** route the buyer branch through `logBuyerContactInTx` — but guard against double-writing the `CallLog`, since `recordCall` has already created one. Cleanest shape: split the counter/auto-return half of `logBuyerContactInTx` into its own exported helper and call that from `recordCall.ts:131`.

### GAP-7 · Conversion launders synthesized calls into lead `Activity` CALL rows — 53 rows
**Where:** `src/app/api/buyer-data/[id]/convert/route.ts:207` maps `BuyerActivity type==="CALL"` → `ActivityType.CALL` and stamps `outcome: CALL_OUTCOME_LOGGED` (`:215`). Import-fabricated `"(imported)"` rows graduate into lead CALL activities with a non-null outcome and still no `CallLog`. **53 `Activity` rows carry outcome `"Logged"`.** Small, and it resolves itself once GAP-4 is fixed at source; listed for completeness.

---

## BY-DESIGN EXCLUSIONS

### 1. HR candidate calls — must stay OUT of the sales Call Logs ✅ (recommendation: keep as-is)
HR is isolated at all four layers: **UI** (all 15 HR call affordances are bare `tel:`; `grep fetch(` across `src/components/hr-dashboard/` returns zero matches), **API** (every HR route writes `HRActivity`; zero references to `prisma.callLog`, `prisma.activity`, or the sales `ActivityType` anywhere under `src/app/api/hr`), **shared components** (`ActionIconButton` carries no side effect; `ActionCardClient` is imported only by `(app)/action-list/page.tsx:14`), and **schema** (`CallLog` at `schema.prisma:1222-1266` has only `leadId:1224` and `buyerId:1232` — there is no `candidateId`, so an HR call is *structurally unrepresentable*).

**This is correct and should not change.** The Call Logs module feeds sales KPIs — agent performance, connect rates, talk time, the ghosting/revival attempt engines, buyer auto-return. Injecting recruiter calls to job applicants would corrupt every one of those metrics and put candidate PII into a sales-scoped surface that HR-only users (Nisha) are deliberately walled off from. HR has its own equivalent ledger in `HRActivity` (`schema.prisma:2343-2356`); if HR call reporting is wanted, build it there. Lalit's P0 should be read as scoped to the **sales** pipeline. *(Note: `HRActivity` currently holds 184 rows, all of type `NOTE_ADDED` — no HR call events are being recorded at all today, which is an HR-side reporting gap but explicitly out of scope here.)*

### 2. `ATTEMPT_WA_NO_RESPONSE` excluded from buyer `CallLog` ✅
`buyerLifecycle.ts:91-99` deliberately excludes it: a WhatsApp non-response is a messaging event, not a phone call. It still increments `attemptCount`. Correct.

### 3. Click-to-call routes write no immediate `CallLog` ✅
`telephony/click-to-call:57` and `acefone/click-to-call:28` return as soon as the provider accepts the dial; the `CallLog` is created by the webhook with the real outcome, duration and recording. Writing a speculative row here would duplicate. Correct.

### 4. Lead CSV import creates no `CallLog` ✅
`intake/csv/route.ts:463`, rationale at `:1094-1103`. Correct — and it is the standard GAP-4 should be held to.

### 5. Bulk actions, the Admin Assistant and the workflow engine cannot mark a call ✅
Verified action allowlists: `workflowEngine.ts:227` (`SET_FIELD` excludes `attemptCount`), `adminAssistant/engine.ts:117-127`, `buyer-data/bulk` `EDITABLE:31-41`. No automation can fabricate a call or an attempt. Correct.

---

## Attempt-counter map

| Counter | Incremented at | Fed by | CallLog-driven? |
|---|---|---|---|
| `Lead.attemptCount` / `connectedCount` | `src/lib/callAttempts.ts:119-201` via `recordLeadCallAttempt` | **3 callers, each paired with a `CallLog` write in the same request**: `log-call/route.ts:101` (after `callLog.create:48`), `recordCall.ts:123` (after `:82`), `acefone/webhook:169` (after `:130`) | ✅ **Yes — effectively CallLog-driven.** Every increment accompanies a CallLog row. Not literally derived *from* the table (it is an incremental counter, and `assignLeadTo` resets it so counts are owner-specific by design), but there is no path that moves it without a CallLog. |
| `Lead.ghostingAt` (👻) | `callAttempts.ts:197-200` | same three callers | ✅ same |
| `Lead.revivalCycle` / revival auto-return | `callAttempts.ts:132-142` | same three callers | ✅ same |
| `BuyerRecord.attemptCount` | `buyerLifecycle.ts:402-406` | **1 caller:** `/api/buyer-data/[id]/activity:49` (human only) | ⚠️ **Now yes, as of today's fix** — the same `logBuyerContactInTx` writes the CallLog at `:384`. **But** the telephony branch (`recordCall.ts:131`) bypasses it entirely → **GAP-6**. And imports (`import/route.ts:397/459`) create CALL-typed rows without touching it → so `attemptCount` and the buyer timeline already disagree for imported records. |
| `BuyerAssignment.attemptsInStint` | `buyerLifecycle.ts:410-413` | same single caller | same as above |
| `HRCandidate` status transitions | `api/hr/candidates/[id]/log/route.ts:28-61` | HR only | n/a — by-design excluded |

**Answer to Lalit's ask ("attempt counts driven from central CallLogs"):** the **lead** side already satisfies this in practice — no increment happens without a CallLog. The **buyer** side satisfies it for human-logged calls only as of today, and not for telephony or imports. The precedent for a true CallLog-derived rebuild already exists: `scripts/backfill-call-attempts.ts:133,423` seeds `attemptCount`/`connectedCount` from CallLog history (lead-only).

One nuance worth stating: `Lead.attemptCount` (sum **2,007**) will never equal unsuccessful outbound CallLogs (**3,230**), because the counter is deliberately **owner-scoped** and reset on reassignment (`callAttempts.ts:29-31`). That is a feature, not drift — but it means "attempts" and "call count" are different questions and any unified report must say which it is showing.

---

## Data check (read-only probes, 2026-07-18)

### Central `CallLog`
| Metric | Value |
|---|---|
| Total rows | **4,530** |
| With `leadId` | **4,530** (100%) |
| With `buyerId` | **0** |
| Unlinked (both null) | 0 |
| Telephony-sourced (`ivrProvider` not null) | **0** — no provider call has ever been recorded |
| Manual | 4,530 |
| Created in last 30 days | 4,230 |

### Buyer Data — the missing-rows quantification
| Metric | Value |
|---|---|
| `BuyerActivity` call-loggable (`CALL` 2,232 + `ATTEMPT_NOT_PICKED` 492 + `ATTEMPT_NO_ANSWER` 52) | **2,776** |
| — of which import-synthesized (`userId` null / tagged `"(imported)"`) | **2,010** |
| — of which genuine agent-logged | **766** |
| Matching `CallLog` rows today | **0** |
| **Deficit** | **2,776 total → 766 legitimately backfillable** |
| Accrual rate (agent-logged, last 30d) | **766 / 30 days** |
| `ATTEMPT_WA_NO_RESPONSE` (correctly excluded) | 1 |

### Leads — `Activity` CALL vs `CallLog`
| Metric | Value |
|---|---|
| `Activity` type=CALL, total | **6,290** |
| — outcome `"Initiated"` (dial taps, **no CallLog by construction**) | **1,413** (1,408 in last 30d) |
| — outcome `"Logged"` (buyer→lead conversion carry-over) | 53 |
| — outcome null | 18 |
| — **real outcome-bearing CALL activities** | **4,806** |
| Real CALL activities with **no** `CallLog` on the same lead within ±5 min | **57** (1.2%) |
| `CallLog` rows with no matching CALL activity within ±5 min | **0** |
| Leads with a CALL activity but zero CallLogs | 23 (20 of them `Initiated`-only) |
| Real CALL activities on leads with no CallLog at all | 10 |

**Reading:** the lead side is in good shape — **98.8% of genuine call activities pair to a CallLog**, and *every* CallLog has a paired activity (0 orphans). The residual 57 are consistent with historical imports and pre-date the current write paths; they are worth a one-time reconciliation but are not a live leak. The real lead-side hole is the **1,413 `Initiated` taps** (GAP-2), which are by construction absent from `CallLog`.

### Attempt counters
| Metric | Value |
|---|---|
| `Lead.attemptCount` sum (live leads) | 2,007 across 778 leads |
| `Lead.connectedCount` sum | 692 |
| Unsuccessful outbound CallLogs | 3,230 |
| `BuyerRecord.attemptCount` sum | 497 across 368 buyers |

### HR
`HRActivity` = 184 rows, **all** `NOTE_ADDED`. Zero HR rows in `CallLog` — as intended.

---

## Recommended order of work

1. **Deploy + backfill GAP-3** (buyer CallLog) — filtered to the 766 genuine rows; confirm no read surface double-counts.
2. **Decide the `CallOutcome.INITIATED` question** (GAP-2) — this is a schema decision for Lalit and it blocks both GAP-2 and GAP-1.
3. **Ship the shared dial beacon to all 15 surfaces** (GAP-1) once (2) is settled.
4. **Align the buyer importer with the lead importer** (GAP-4).
5. **Fold the Acefone webhook into `recordCallEvent`** (GAP-5 + GAP-6) — before telephony goes live, while both are still zero-row.
6. GAP-7 resolves itself with (4).

## Non-gap observations
- **`CallLog` contains non-calls.** The Log Conversation modal's WhatsApp channel (`LeadActionsClient.tsx:275-289`) posts to `/log-call`, producing `CallLog` rows whose notes begin `💬 WA out —` / `💬 WA in —`. This is intentional (Lalit asked for WhatsApp exchanges to be recorded "in call"), and read-side classifiers compensate (`callOutcome.ts:17-29` `effectiveOutcome` / `isWaNote`). Flagged only so nobody reports raw `CallLog` counts as "calls made" without applying those filters.
- `src/app/api/leads/[id]/advanced-activity/route.ts:72` (expo / home visit / site visit) writes meeting activities, not calls — correctly out of scope.
- `src/app/api/whatsapp/log/route.ts:36,55` writes `Activity` + `WhatsAppMessage`, no `CallLog` — correct.

---

*Audit method: static trace of all 250 API routes and all `tel:` / `action="call"` affordances under `src/`, plus read-only Prisma probes against production. No source file was modified; no write query was issued.*
