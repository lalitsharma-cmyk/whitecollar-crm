# Workstream 1 — Three-Month Task Reconciliation · Master Backlog

**Audit-1 · Read-only · Generated 2026-07-17**
Prod: crm.whitecollarrealty.com · Repo HEAD `630df9e` (docs-only) · **Live prod code = `5ea2b12`** (deploy chain `09baee0`→`41b9503`/`9b7ff54`→`15d659a`→`1adb007`→`5ea2b12`).
Commit window scanned: **2026-05-23 → 2026-07-17 (857 commits, ~8 weeks)**. Regression suite: **153/153 green** at HEAD.

## Method & triangulation
Every row is triangulated across: the DEPLOY_LOG deployed-commit ledger (≈210 deploys), `CRM-AUDIT-RECOVERY-2026-07-14.md` (prior full recovery audit @ `f8dc049`), `FINAL-REPORT-2026-07-17.md` (last overnight batch), `PRODUCT_QA_DIVERGENCES_2026-07-03.md`, `CRM-GAP-ANALYSIS.md`, `DEV_TRACKER.md`, `RELEASES.md`, `MIGRATION-LEDGER.md`, `OVERNIGHT_TASKS.md`, the 857-commit git log, 83 prisma migrations, `src/lib/settings.ts` feature flags, unmerged branches, and the ~134-file memory index.

## Status vocabulary (controlled — Lalit's list)
`NOT STARTED · PARTIALLY DEVELOPED · DEVELOPED · TESTING PENDING · TEST FAILED · FIX IN PROGRESS · DEPLOYMENT PENDING · DEPLOYED BUT NOT VERIFIED · VERIFIED IN PRODUCTION · BLOCKED · WAITING FOR BUSINESS DECISION · WAITING FOR CREDENTIALS · INTENTIONALLY PAUSED · CANCELLED · DUPLICATE / SUPERSEDED`

**The single `Status` value is the furthest-stage rollup** (it encodes development + deployment + testing + production-verification in one label). Two hard rules applied:
1. **Nothing is marked `VERIFIED IN PRODUCTION`.** That label requires a live-UI click-through per role, which no doc records this cycle (the Jul-14 audit explicitly states UI click-through per role/module was NOT done; the Jul-17 batch owes browser UAT on 3 new admin UIs). Shipped-and-healthy work therefore tops out at **DEPLOYED BUT NOT VERIFIED**, even where a closing audit proved the *data layer* on live prod (noted in Next-action where it applies).
2. Paused items (Task Manager, all AI, GitHub-Actions crons) → **INTENTIONALLY PAUSED**; approval-gated items → **WAITING FOR BUSINESS DECISION**; credential-gated → **WAITING FOR CREDENTIALS**.

Columns: Exist = works on existing/historical data · Future = works on future data (Y/N/unk) · Dec = Lalit decision required.

---

## SUMMARY COUNTS

**Total distinct items inventoried: ~190** (183 rows in the module tables below + 7 paused-only items detailed in the Intentionally-Paused section that are not otherwise rowized). Work window 2026-05-23 → 2026-07-17 (857 commits / ~210 production deploys, consolidated into these task rows).

**Per-status tally (module-table rows):**

| Status | Count | Read |
|---|---:|---|
| DEPLOYED BUT NOT VERIFIED | **125** | Shipped + gate-green; no live-UI click-through this cycle (data layer proven on prod for several) |
| WAITING FOR BUSINESS DECISION | **19** | Needs a Lalit call/flag-flip before it can proceed |
| NOT STARTED | **18** | Designed or requested, no code |
| PARTIALLY DEVELOPED | **9** | Code exists, not finished/committed/deployed (incl. this session's call-attempt/ghosting build) |
| DEPLOYMENT PENDING | **5** | Built + gate-green, awaiting a deploy/upload (mostly Other-Sites) |
| WAITING FOR CREDENTIALS | **5** | Code complete, dark until env/keys supplied (Acefone, Meta/WA, VAPID/CRON_SECRET, site keys) |
| INTENTIONALLY PAUSED | **2** in tables | Follow-up-rollover cron + nightly-backup cron (under the cron hold) |
| DEVELOPED · TESTING PENDING · TEST FAILED · FIX IN PROGRESS · BLOCKED · CANCELLED · VERIFIED IN PRODUCTION · DUPLICATE/SUPERSEDED | **0** in tables | See notes below |

**Notes on the zero-count labels:**
- **VERIFIED IN PRODUCTION = 0 by rule.** No live-UI click-through per role was recorded this cycle, so no item qualifies (the Jul-14 audit and Jul-17 batch both leave UI UAT owed).
- **INTENTIONALLY PAUSED (full picture):** beyond the 2 cron rows, the paused *cluster* = **Task Manager** + the **AI suite** (AI-pause, AI Sales OS v2, AI Follow-up Intelligence, AI engine/architecture) + **all 13 GitHub-Actions crons** + **Dev Sandbox** + **Motivation pilot** — detailed in the dedicated section (≈9 paused items total).
- **DUPLICATE / SUPERSEDED** work (early "Wave 1–20" scaffolding, reverted AI Sales Director, dead components) is captured in the Superseded/Removed narrative rather than as rows.
- **FIX IN PROGRESS / TEST FAILED** — none open; the current in-progress build (call-attempt/ghosting cycle) is classed PARTIALLY DEVELOPED.

**The real open work = the ~56 non-`DEPLOYED` rows** (18 NOT STARTED + 19 WAITING-DECISION + 9 PARTIAL + 5 DEPLOY-PENDING + 5 CREDENTIALS) plus the paused cluster. Top-15 shortlist is in the Decisions + the parent's return summary.

**Instability signals (churn) from the 857-commit scan** — highest-churn/most-re-fixed areas (health risk, not new tasks): AI subsystem (now frozen; 1 explicit revert), import date/fidelity P0s, Service-Worker cache (~10+ forced bumps), rejected-lead workflow (8+ passes), lead-count reconciliation, dashboard section thrash, timeline date-tearing, buyer-detail "match Lead" passes, device-security enforcement rollout, iOS/login hotfix cluster.

---

## LEADS

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Leads status architecture (Workable/Closed/Lost buckets) | 3-bucket view, My/Team selector, default Today+Overdue | Jun11 | 77ce3b2,d56e447 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | Live-UI click-through | P2 |
| Default filter Today+Overdue + 6 follow-up chips + tier sort | Today's important leads first, Lalit 5-tier | Jun21-Jul06 | d98e747,bca7a70,a273c7d | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | Verify sort order live | P2 |
| Excel-style column filters + AND-stacking | Per-column filters that stack | Jun05-24 | c0ce43d,0b6316f | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | Live verify | P3 |
| Fresh-Lead priority visibility (badges/counts/tier-0/4 filters) | Surface fresh leads; active pipeline only | RC1-Jul03 | freshLeads.ts,a9b2f56 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | Visual layer live; escalation flag OFF (see Settings) | P2 |
| Manual lead creation: mandatory team-filtered Assign-To | Assign at creation, team-scoped | Jun21 | 49a068c | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| New Lead form (/leads/new RSC) + market categories + editable Created Date | India never shows UAE options; backfill walk-ins | Jun23-28 | 60dc8bf,5035432,a73191c | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | Dubai INR→AED conversion deferred | P2 |
| Agents reject own leads + Reject appears once | Owner-reject button, single control | Jun19 | ded7728,1b7dd67 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Lead auto-classification + Project Master (/admin/projects) | Website leads → Team/Source/Type/Project/City | Jun18 | d4cfc9b | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | New leads only | P2 |
| Lead auto-assignment RULE (Dubai→Lalit, Tue-IST India→Yasir else Tanuj) | Real-time only, not bulk/buyer-convert | Jun30 | 2deed82 | DEPLOYED BUT NOT VERIFIED | N/A | Y | leave-cover | M | N | Verify routing live | P2 |
| Property Type (Residential/Commercial) field + backfill | Auto-fill + Master Data column | Jun19 | c8d9d2c | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P3 |
| Location auto-enrichment City→Country + State + manual-lock | Curated + Nominatim, re-enrich on change | Jun19 | 5573088,c60989f | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P3 |
| Team-aware budget display + uniform format (India ₹Cr / Dubai AED) | Never convert/mix; canonical formatter everywhere | Jun20-21 | f19f903,21fed86,ab5876d | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Interested Properties independent store + Rename Project→Property Enquired | Separate from Properties-Discussed; same picker | Jun21 | 8e3c0b5,21fed86 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P3 |
| Bulk actions Admin-only (10 actions) + UI/permission alignment | Managers/agents no bulk; revertable status | Jul10-17 | bf0bf62,5ea2b12 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | Verify bulk gating live | P2 |
| Lost/Rejected auto-unassign + clear follow-up + Previous Owner | Terminal rule across manual/bulk/import/API | Jul10 | b6c051e,b6f5386 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | Live-data proven (audit §9); UI verify | P1 |
| Rejected-lead full workflow (reactivate-before-reassign, 🟥, no data loss) | Reject unassigns, preserves history | Jun27-Jul08 | 95ed21c,3f4552e | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | 8+ iterative passes; data clean | P1 |
| React #418 hydration fix on /leads | Kill clock-gated relative-time mismatch | Jul02 | 0385314 | DEPLOYED BUT NOT VERIFIED | N/A | Y | — | L | N | — | P3 |
| **Owner call-attempt cycle / ghosting / revival-cycle** | Per-owner attemptCount, ghostingAt, return-to-pool, reports | **Jul17 (this session)** | working tree + migr 20260717060000 | **PARTIALLY DEVELOPED** | unk | unk | migration applied | M | N | **Finish, commit, gate, deploy; run backfill-call-attempts** | P1 |
| Notes "pin" | Pin a note to top | — | audit D7 | NOT STARTED | N | N | Note.pinned schema | L | N | Add schema col + wire PATCH | P3 |
| BANT stage-gating | Gate stage advance on BANT completeness | — | audit D10 | NOT STARTED | N | N | co-design | L | Y | N/4 pill shipped; gating needs design | P3 |

## MASTER DATA

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Master Data V3/V3.1 Excel-style admin console | Saved Views, sticky filters, column visibility/freeze, quick preview | Jun18 | 2433e58,02816f3 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Compact column layout (Created·Time·Name frozen…) | One-screen fit; Message hidden; Created admin-editable | Jun28 | 4959cfc | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P3 |
| Inline edit every business field + portal-float dropdowns | Edit-in-place; z-index correct | Jun24 | a3d6fde,f6f0dfd | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P3 |
| Assign = reactivate (asks Status + Follow-up) | Defaults Not-Contacted + now+15min; clears rejection first | Jul10 | 7c41d02 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | Live-data proven (audit §11) | P2 |
| Unassigned = ready-to-assign only + clickable counters | Exclude rejected/lost/closed/archived | Jun28 | f20c385 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Canonical source labels M1–M6 + Website/Event families | WCR_EVENT/WEBSITE/Landing; Awaiting-Classification workable-only | Jun28-Jul06 | 9ffabf6 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Master Data export = exact on-screen filtered view (M5) | POST id-set → CSV == view | Jun28 | d0475f1 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P3 |
| Master Data never an activity-attribution surface | Calls fold to "Leads", never "Master Data" | Jul08 | bca2d13 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |

## DUBAI BUYER

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Buyer Data module + lifecycle (pool→assign→convert/reject, auto-return@5, import wizard) | Admin staging bank; buyerScopeWhere | Jun23-24 | 22bd866,13b1ab9 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | — | P1 |
| Buyer classification (First-Time/Investor/Whale) + badges/filter | Repeat-buyer intelligence | Jun27 | e41b878,518ceaa | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P3 |
| Buyer real Status + follow-up date (migration+backfill) + list cols | Editable; guarded parser; Pool relabel | Jun30 | 9b27727,98a0f85,691915c | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Buyer B1–B3 tabs (Active default, Rejected, clickable cards) | Terminal excluded from default | Jun28 | b3a003e | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Buyer field-level Change History (BuyerFieldHistory) | Admin/mgr read-only audit of inline edits | Jul01 | 0982a67 | DEPLOYED BUT NOT VERIFIED | Y | Y | migr 20260701130000 | L | N | Only migration ws-unify still ships | P3 |
| Buyer nationality phone-prefix backfill + future inference | Req 6 | Jul10 | b23319a | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P3 |
| Buyer→Lead convert: zero data loss (timeline copy + CallLog relink) | Convert carries all history | Jul03 | A8 (QA-div) | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | — | P1 |
| Buyer→Lead convert dedup guard (leadDedupOR 409) | Convert cannot mint a duplicate | Jul16 | 1adb007 | DEPLOYED BUT NOT VERIFIED | N/A | Y | — | L | N | Last intake path to get the rule | P2 |
| Buyer data-bank rule (hide Lead-only workflow until Convert) | Visually identical, actions hidden | Jul01 | fd727d3 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | — | P1 |
| Buyer terminal rule incomplete (no clear f/u, no previousOwnerId) | Reject should clear follow-up + stash prev owner | — | audit G3 | WAITING FOR BUSINESS DECISION | N | N | BuyerRecord schema | M | Y | Confirm stale follow-up acceptable or schema-add | P2 |
| Buyer detail Gallery/Brochure share | Buyers retain "Share Resources from Gallery" | — | audit G4 | WAITING FOR BUSINESS DECISION | N | N | — | L | Y | Confirm intent | P3 |
| Buyer chunk import unrevertable without {init} | batchId:null → no importBatchId → no revert | — | audit P2 | NOT STARTED | N | N | — | M | N | Force init-first or synth batchId | P2 |
| Buyer import source hard-coded | Source not preserved verbatim on buyer import | — | audit D5 | NOT STARTED | N | N | — | L | N | Preserve source like leads | P3 |

## INDIA BUYER

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| India Buyer Data VIEW module (INR/Cr, sidebar, export, market-aware detail) | Both-markets parity; Dubai byte-preserved | Jul03 | 6ff2678,4034eb0 | DEPLOYED BUT NOT VERIFIED | Y | Y | buyerScope | M | N | No India data yet | P2 |
| India Buyer IMPORT (BuyerImportClient market prop + dedup/create param) | Passport/financial path | Jul03 | OVERNIGHT_TASKS #1 | PARTIALLY DEVELOPED | N | N | blob/PII care | M | N | Deferred intentionally (sensitive path, no data yet); finish when needed | P2 |
| India Buyer Performance report | /reports/buyer-performance is Dubai-only | — | QA-div C4 | NOT STARTED | N | N | — | L | Y | ~1 pass build — awaiting go-ahead | P2 |
| AI buyer distribution generalize to India | buyerDistribution.ts hardcoded Dubai | — | QA-div C5 | WAITING FOR BUSINESS DECISION | N | N | — | L | Y | Generalize like buyerScope (AI-adjacent name; logic is rule-based) | P2 |

## REVIVAL / COLD-CALLS

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Revival = Leads list parity (filters/saved-views/bulk/search/columns) | Reuse Leads blocks; keep Hidden Gems/Leaderboard | Jun24-26 | da49dae,cc74561 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | — | P2 |
| Revival full Normal-Lead detail parity (work queue w/o converting) | Same detail as Leads | Jul06 | bdbdfdb | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | — | P2 |
| Revival = calling-only (remove meetings/site-visits/expos/home-visits, server-403) | Outreach only; convert-to-Lead unlocks them | Jul16 | e4f115d | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | History preserved; UI verify | P1 |
| Revival pagination (50/page like Leads) | Same pagination bar | Jul16 | b15c7d2 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Revival India/Dubai market split (tabs) | Both-markets | Jul02 | 77be7de | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Revival import lands in REVIVAL origin + re-engage existing | Fix "import not showing" limbo | Jun25-28 | c094163,b7f1941 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | 3-layer fix | P2 |
| Revival rejected tag + kept in Master Data + team preserve + filter | "Revival Engine Rejected" excluded from active | Jul02 | d469ea1 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Revival promote flips leadOrigin=ACTIVE_LEAD + phone unmask + editable Client card | Promoted lead visible in metrics | Jul01-03 | A9,87a3598,65067ec | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | — | P2 |
| Revival detail missing Voice Guidance (Channel-①, NOT AI) | FULL Lead parity | — | audit G1 | PARTIALLY DEVELOPED | N | N | shared voice cmpt | M | N | Import LeadVoiceGuidance/Pin into Revival detail | P2 |
| Revival detail missing Escalation thread | Two-way LeadEscalationThread | — | audit G2 | PARTIALLY DEVELOPED | N | N | — | M | N | Add thread (button exists, thread doesn't) | P2 |
| Revival/Cold "Hybrid Layout" field cards | Lead field-card layout w/o Lead-only actions | — | audit D2, DEV_TRACKER C1 | NOT STARTED | N | N | reuse Lead cards | M | Y | Build P1 field cards (single-col today) | P2 |
| Revival promote reversible + keep record after convert (rule 5) | OperationLog + dedicated revert | — | audit G5, FINAL-REPORT E | WAITING FOR BUSINESS DECISION | N | N | identity | L | Y | Decide keep-record-after-convert | P3 |

## REPORTS

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Lead Source Intake report + CRM-wide drill-down | Daily/wk/mo/yr × Team × Module × Source, based on original lead date; clickable | Jul16 | 09baee0 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | AT-1 proven live; broader UI verify | P1 |
| Reporting-count unification (one activeLeadWhere/leadScope) | Identical per-agent counts everywhere | Jun26-27 | f24e2cb,4dd03d0 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | Churny; locked by invariants | P1 |
| Reports use CURRENT owner (Agent-Perf, changes) + team-scope class fix | Not historical owner | Jun30-Jul02 | 3cc77b8,36a8050,8544fa0 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | Cross-team leak fixed | P1 |
| Module bifurcation (parallel Lead/Buyer reports) across all reports | Every report Lead+Buyer aware | Jul06 | 3b87d68,cc0ca84 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Follow-up Compliance report (FU-4, per-agent overdue/today/chronic) | NULL-status-safe | Jul02 | dbcc4ad | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | — | P2 |
| Ghosting report + Revival-cycles report | New report surfaces for attempt-cycle | Jul17 (session) | working tree | PARTIALLY DEVELOPED | unk | unk | call-attempt cycle | M | N | Finish with call-attempt cycle | P2 |
| Forecasting depth / target-vs-actual (revenue) | Expected-close, commit/best/worst, target vs actual | — | gap #6 | NOT STARTED | N | N | expectedCloseDate | M | Y | Build (Target model exists) | P1 |
| xlsx export + scheduled report delivery + templates all 5 modules | Excel not just CSV; emailed reports | — | gap #12, OVERNIGHT #11 | PARTIALLY DEVELOPED | N | N | — | L | N | Finish exports+templates | P2 |
| Commission → agent incentive/payout statements | Per-agent earnings vs company commission | — | gap #11 | NOT STARTED | N | N | — | M | Y | Build (extends commission report) | P2 |

## CALL LOGS / TELEPHONY

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| AS Phone / Acefone provider-agnostic telephony (click-to-call + auto-record) | Auto-link call to Lead/Revival/Buyer by phone | Jul02 | 27b1e82 | WAITING FOR CREDENTIALS | Y | Y | Acefone creds | M | N | Set ACEFONE_* env + map agent IDs + webhook | P1 |
| Telephony security (SSRF proxy, fail-closed webhook, scope-proxy player) | Recording never exposes provider URL; webhook fail-closed | Jul03 | A1–A5 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | — | P1 |
| Log Call modal (Channel+Direction, mandatory Outcome/Follow-up/Remarks, minutes) | Duration in minutes; instant timeline | May27-Jun21 | c0c87a7,521bf5f | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Cross-module call tracking (module = activity source) + buyer calls counted | Every call-count surface includes buyer calls | Jul08 | bca2d13 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | — | P2 |
| Conversation analytics (WhatsApp metric, WA-aware Connected/Unsuccessful, talk-time) | callOutcome.ts single-source | Jun21 | 04d3df6 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Call-attribution/outcome backfills (actor, imported times) | Historical calls attributed correctly | Jun-Jul | backfill-call-* | DEPLOYED BUT NOT VERIFIED | Y | N/A | — | L | N | — | P3 |
| 3,489-row synthetic CallLog deletion | Remove synthetic call rows from remarks-overhaul | — | project-crm-remarks-overhaul | WAITING FOR BUSINESS DECISION | N | N/A | backup saved | M | Y | ON HOLD — needs Lalit "go"; backup exists | P3 |
| Unmatched Calls Queue (admin maps unassigned inbound) | Separate audit event, never rewrites original | — | audit D6 | NOT STARTED | N | N | telephony live | M | N | Build after Acefone live | P3 |
| WhatsApp Business API live (2-way, real send + inbound capture) | Replace manual wa.me; capture replies | — | gap #2 | WAITING FOR CREDENTIALS | Y | Y | Meta tokens + template approval | M | N | Set WA_BUSINESS_* + verify webhook | P1 |
| Power-dialer / structured warm-follow-up queue | Auto-advance queue beyond cold-call session | — | gap #8 | NOT STARTED | N | N | — | M | N | Generalize ColdCallSession | P2 |
| Bulk WhatsApp/SMS real broadcast | Real sends not link-lists; SMS provider | — | gap #10 | NOT STARTED | N | N | WA API live | M | N | After #2 | P2 |

## DASHBOARD

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Reconcile Dashboard↔Leads counts (shared workableWhere) | Fix 53-vs-33 divergence | Jun21 | 0228fdb | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | — | P1 |
| Command Center action-first tiles + count==drilldown integrity + cohort KPIs | Kill 233% rejection-rate artifact | May27-Jun24 | 9cec162,8d8d5d0 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | Very churny early (section thrash) | P2 |
| Live Lead Assignment & Status widget (admin/mgr) | Current owner, not "assignment history" | Jun24-30 | ccfcc9f,36a8050 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Daily sales quote + hide check-in after attendance | Under greeting | Jun21 | ba049c4 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P3 |
| Dashboard dailyTargets JSON.parse guard (anti-500) | Corrupt setting can't 500 | Jul06 | 0a4b3f0 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Dashboard "Today" IST filter | Actual today only | — | OVERNIGHT #10 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | Assessed correct; cosmetic multi-day label only | P3 |

## NOTIFICATIONS

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Notification system (Web Push + in-app Web-Audio, 6 sounds/4 volumes per-user) | Per-user sound/volume; /notifications | Jun20 | 1cb78c4 | DEPLOYED BUT NOT VERIFIED | Y | Y | VAPID | L | N | — | P2 |
| Decouple notifications from automation (Automation Controls, 6 toggles OFF) | Notifications always fire; automation OFF | Jun22 | c59b502 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P1 |
| Notification source-tracking + no invented callback times | Every notif traces to a real record | Jul04 | 3d2f6a8,53d6df9 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Meeting/Site-Visit 1-hour + lunch + morning reminders (distinct sounds) | Agent+manager | Jun21-22 | 8564ada,e340436 | DEPLOYED BUT NOT VERIFIED | Y | Y | crons | L | N | Depends on cron (on hold) for scheduled ones | P2 |
| Notification cleanup cron + read-on-view bell | Owner spec | Jun19 | 864c94d | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P3 |
| Mobile push iOS install detection + self-heal + diagnostics | Background-delivery guidance | Jun21-22 | 1c460de,030a362 | DEPLOYED BUT NOT VERIFIED | Y | Y | VAPID | M | N | iOS background push reliability still device-limited | P2 |

## IMPORT / EXPORT / DEDUP

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Excel/CSV import engine + Mapping Wizard + safe/preview mode (all 3 importers) | Multi-sheet auto-detect, multi-line remark parse, dup choices | May24-Jun24 | ef77ebe,9d55970 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | — | P1 |
| Import fidelity: canonical phone + OR-dedup + created date/time (tri-state) | Same phone OR same email = same customer; blank time never fabricated | Jul16 (was on HOLD) | 41b9503,9b7ff54,27b549e | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | 6,098 phones/5,510 time-flags backfilled; snapshots on disk | P0 |
| Import date handling (Excel serial, Indian fmt, GMT→IST, preserve createdAt) | Blank-header date-leak P0 + repair + future-date guards | Jun19-22 | f28f179,266c5e6,8b6a76c | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | Recurring P0 cluster; now guarded | P1 |
| Dedup: only ACTIVE leads participate (deleted stop blocking) + custom-col + budget + sourceRaw preserved verbatim | Recycle-bin excluded from dup | Jun03-25 | 274d90e,22a1083,3a6087d | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | — | P1 |
| Admin export completeness (CSV+Excel, hidden/imported fields, 5 modules) + audit every download | Full-fidelity export; watermark/audit | Jul03-08 | d620fb3,6bb2a3d,46b9e99 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Import History / Rollback UI (Batch ID, purge guard, trash) + buyer import revert | Reversible imports | Jun09-Jul09 | 49abc4f,03515c7 | DEPLOYED BUT NOT VERIFIED | Y | Y | OperationLog | M | N | — | P1 |
| Dedup auto-merge/block on create+import + one-time historical-phone backfill | Prompt at create/import; stop new duplicates | — | audit D9/Q5, P1 bug | WAITING FOR BUSINESS DECISION | N | N | — | M | Y | #1 trust blocker; detection+manual-merge shipped, auto not | P1 |
| createdAt / currentStatus round-trip on re-import | Export→import preserves historic date + status | — | audit P1 bug | NOT STARTED | N | N | — | M | N | Add createdat mapper candidate | P1 |
| Phone CSV coercion (leading + → Excel formula) | Text-guard CSV phone cells | — | audit P2 bug | NOT STARTED | N | N | — | L | N | Prefix-guard in CSV writer (xlsx safe) | P2 |
| Unguarded date parse on lead import (followup/meeting/siteVisit) | Guard like buyer import | — | audit P2 bug | NOT STARTED | N | N | — | L | N | Route through guarded parseImportDate | P2 |

## ADMIN / USERS

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Admin AI Assistant — NL bulk-ops (RULE-BASED, no LLM; preview→approve→undo) | Reversible; NOT under AI freeze (no model calls) | Jun20-21 | 7007981,e6a6cb6 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | P0 single-lead-scope safety fixed | P2 |
| OperationLog reversible structural ops + Admin Undo (/admin/operations) | Convert/lead+buyer transfer/edit/import/bulk-edit revertable | Jul08-14 | e8576ff,03515c7,f8dc049 | DEPLOYED BUT NOT VERIFIED | Y | Y | migr 20260708120000 | M | N | OperationLog only started ~early-Jul (67 rows) | P1 |
| Role audit (agents can't create leads, export 403, import admin-only) | Gated everywhere | Jun | role-audit memory | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | — | P1 |
| Sameer = lead-ops admin (mgmt dashboard, no personal-perf cards) + Needs-Lalit escalation | Replaces "Needs Sameer" | Jun21-30 | 0b9ede2,ea70e05 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Exclude Nisha (HR-only) from all Sales lists + auto-assign pool | HR user never in sales surfaces | Jun21-25 | 54ea805,3a7556b | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | — | P1 |
| Admin Nationality edit | Admin can correct nationality | Jul15 | b77246e | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P3 |
| Import-policy inconsistency (csv/sheet ADMIN vs export super-admin) | Align intake gate to canImportData | — | audit §7 | WAITING FOR BUSINESS DECISION | N/A | N/A | — | L | Y | Decide align to Super-Admin or ratify | P3 |

## SETTINGS & FEATURE FLAGS

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Automation Controls hub (autoAssignment/whatsapp/email/autoEscalation/scheduledActions) | All OFF by default; explicit flip | Jun22 | c59b502,settings.ts | WAITING FOR BUSINESS DECISION | N/A | N/A | — | M | Y | All 5 OFF — Lalit flips when ready | P1 |
| Round-robin + 15-min SLA breach flip | Currently OFF (paused 2026-06-22) | Jun22 | 00c5b66,settings.ts | WAITING FOR BUSINESS DECISION | N/A | Y | — | M | Y | Flip after small validation window (Q7) | P1 |
| Fresh-untouched escalation flip (15m nudge / 45m escalate) | Visual layer shipped; escalation flag OFF | Jul01 | settings.ts | WAITING FOR BUSINESS DECISION | N/A | Y | — | L | Y | Flip freshUntouched.enabled after live check | P2 |
| Returning-Client card flag | Deploys as no-op; enable after verify | — | settings.ts, memory | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | Code default OFF; memory says enabled in prod — reconcile | P3 |
| Settings page + typed accessors + admin tools hub | Config surface | Jun03-22 | d098094 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P3 |
| Call-attempt thresholds editor | Configure attempt/ghosting thresholds | Jul17 (session) | working tree | PARTIALLY DEVELOPED | unk | unk | call-attempt cycle | L | N | Ship with call-attempt cycle | P2 |

## PRESENCE

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Presence & Last-Seen (admin-only) | Online/Idle/Offline/Never-Active-Today; per-device; strict RBAC; pathname-only privacy; zero cron | Jul17 | 5ea2b12 | DEPLOYED BUT NOT VERIFIED | N/A(new) | Y | migr 20260717040000 | M | N | **Browser UAT owed on new admin UI** | P2 |
| "I am here" self check-in (once/day, device/IP, admin report) | Top of dashboard | Jun20-21 | 4e46bb1,a6e269d | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | Older attendance system | P3 |
| Agent activity/field-movement tracking (6 status buttons, AgentStatusEvent, durationMin) | Manager notify; stale-watch | Jun24-Jul02 | d693a52,044bb38 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P3 |
| Attendance (check-in/out, block-checkout-before-checkin, EOD mood) | — | May25-Jun27 | 758bb33 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P3 |

## ROUTING

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Lead Routing Scheduler (admin) | Durations/recipients (single/team/round-robin/weighted%)/scopes; priority Manual>Date>Source>Team>Default; version-audited; Pause override; auto-expiry no cron | Jul17 | 5ea2b12 | DEPLOYED BUT NOT VERIFIED | Y(no-rule=legacy) | Y | migr 20260717040000 | M | N | **RR/weighted WRITE path never run on prod — UAT owed** (create rule Disabled→Enable→1 test lead) | P2 |
| Agent leave-cover engine (passthrough+redirect) + admin toggle UI | On-leave agent no auto-assign → teammate→mgr→park | Jul02 | a1bd2f3,8fc713b | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | IST auto-expire | P2 |
| Market write-at-source (co-write Lead.market at every forwardedTeam write) + Phase B Market≠Team | 914 backfilled | Jul02 | a7bbaad,e1afaa6 | DEPLOYED BUT NOT VERIFIED | Y | Y | migr 20260702190000 | M | N | backfill-market-gap heal exists | P1 |
| Round-robin kill-switch + time-window assignment | Pause auto-assign during bulk imports | May25 | b19d05b | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Capacity-aware / skill-based routing + stale-lead reassign | Caps, specialization, reassign ghosted/absent-owner | — | gap #9 | NOT STARTED | N | N | cron slot | M | Y | Build after RR flip | P2 |

## SECURITY / SESSION / AUTH / DEVICE

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Yasir Khan hard session reset (executed) | Force logout every device incl. legacy/stale | Jul16 | 1adb007 | DEPLOYED BUT NOT VERIFIED | Y | N/A | — | M | N | 10 sessions revoked, 2 devices removed, epoch stamped | P1 |
| Legacy-cookie password epoch hardening | Admin reset/force-logout also kills pre-rollout cookies for ALL users | Jul16 | 1adb007 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | Genuine CRM-wide hole closed; super-admin exempt by design | P1 |
| Force Logout admin feature (per-user Sessions panel + all-devices) | Revoke one or all; epoch; hash untouched | Jul17 | 5ea2b12 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | UI UAT owed | P2 |
| Device security (trusted-device binding, DB sessions, admin approval) — MONITOR mode | Phase A monitor; enforce later | Jun18-30 | 246129b,825918c | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | Monitor live; churny enforcement rollout | P1 |
| Device security ENFORCE flip (DEVICE_SECURITY_ENFORCE=true) | Flip monitor→enforce | — | audit Q8, DEV_TRACKER | WAITING FOR BUSINESS DECISION | N/A | Y | clean device list | M | Y | Flip once trusted-device list clean | P2 |
| Security batch (block agent lead-create, market-segregate projects, IST inline-time) | propertyScope server-enforced | Jun20 | db65df5 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | — | P1 |
| Security+perf batch (health redact, email fail-closed, Meta webhook signed, N+1 collapse, indexes) | /api/health no lead count to anon; email intake fail-closed | Jul16 | 15d659a | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | Closed audit P3s (health leak, email fail-open) | P2 |
| Permission-gap scoping (print/note/intake/promote/assign/reactivate/eoi/settings) + lock destructive routes | Close 8 gaps | Jun14-26 | 21f6b2c,249d70d | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | — | P1 |
| Rotate-all-secrets + CRON_SECRET always set | Ops hygiene | May23-Jul | a5183a2, QA-div B8 | WAITING FOR CREDENTIALS | N/A | N/A | env | L | N | Ensure CRON_SECRET set in prod | P2 |

## VOICE (subsystem — Channel voice, NOT AI)

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Voice subsystem 3 features (Dashboard Broadcast · Lead Voice Guidance Ch① · Ch② Escalation) | Shared useVoiceRecorder; rolled to Buyer+Cold | Jun26-28 | 042bc00,bb01d72,a67b9f6 | DEPLOYED BUT NOT VERIFIED | Y | Y | migr 20260626000000 | M | N | Not covered by AI freeze | P2 |
| Voice notes (Web Speech API) + auto-correct + Smart Timeline instant | Preserve names | Jun02-22 | 60fa393,521bf5f | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Motivation pilot (Bucket H voice, team-scoped) | Ships behind flag, piloted | — | settings.ts motivationPilot | WAITING FOR BUSINESS DECISION | N/A | Y | — | L | Y | Flag OFF; AI-adjacent tone — confirm before pilot | P3 |

## HR (separate /hr workspace)

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| HR Recruitment CRM module (Candidate DB, timeline, follow-ups, interviews) | Separate shell, hrOnly (Nisha) | Jun08 | 2428001,acd3c81 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | 447 real applicants — never bulk-delete | P1 |
| HR data reset to clean shell (reversible) | 447 real career applicants; only 5 named test rows | Jun28 | cleanup-hr-data | DEPLOYED BUT NOT VERIFIED | Y | N/A | backups/HR-ARCHIVE | M | N | Restore path exists | P1 |
| HR RBAC engine (3 roles, no migration) + hrOnly gating + deploy-gate scanner | Junior/Senior HR/Admin derived | Jun08-30 | b7bed60,142e391 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | regression-hr-rbac gate | P1 |
| HR ATS full build (voice, saved-view list, detail, interview lifecycle, follow-up, reports, resume bank+hash-dedup) | Sales-parity ATS | Jun28 | b6c876d,8f4c586,eb56380,fe3f8c1 | DEPLOYED BUT NOT VERIFIED | Y | Y | migr hr_ats_phase1 | M | N | 7 gated deploys; **awaiting Lalit live UAT** | P1 |
| HR WhatsApp templates + import dry-run + interview conflict detect + period reports | Buildable-now batch | Jun28 | 46ffafa | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| HR dashboard action-driven redesign (Sales parity) | 13/14 components | Jun30 | 5aa5310 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | Was paused on weekly quota; memory says shipped | P2 |
| HR auto-join cron (EXPECTED_JOINING→JOINED) | Flip on joining date | Jun30 | dde67fe | DEPLOYED BUT NOT VERIFIED | Y | Y | cron (on hold) | L | Y | Cron on intentional hold; decision on auto-join | P3 |
| HR decisions (secondaryOwnerId keep/drop · interview naming · auto-join) | — | — | DEV_TRACKER | WAITING FOR BUSINESS DECISION | N/A | N/A | — | L | Y | Decide 3 items | P3 |
| HR credentials (Acefone call logging · WhatsApp auto-send · Google Calendar sync) | Live integrations | — | DEV_TRACKER | WAITING FOR CREDENTIALS | N/A | N/A | creds | L | N | — | P3 |

## TIMELINE / CONVERSATION

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Smart Timeline vs Raw History separation (1 clean card/remark, no dup) | Processed events vs imported blobs | Jun23-27 | 38324e8,cfa1b35 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | Cross-source interleave DEFERRED | P1 |
| Date-tearing P0 (never parse dates from client-message content) | No torn messages / fake dated cards | Jun26-28 | 016014f,dd7f37 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | Recurring P0; locked by invariant | P1 |
| Remark editing perms (agent own+same-IST-day; admin/mgr any) + CALL remarks editable | Backend-enforced | Jun21-30 | b3ce56c,1db3fef | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | Buyer remark-edit NOT covered | P2 |
| Clean CRM summaries everywhere (needSnapshot.ts) + IST timestamps | No raw remark blobs; raw only in Conversation/Audit | Jun20-21 | 435280e,4bd8048 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Raw History / per-entry Edit = Lalit-only (audited) | "Edited by Lalit" | Jun19 | 30bf6da,13e9b91 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P3 |
| Actor vs Owner timeline (shows performer, never owner) + 130-row reconcile | Store both; historical fix approved | Jul01 | c15a918 | DEPLOYED BUT NOT VERIFIED | Y | Y | migr 20260701140000 | M | N | **DEV_TRACKER: reconcile DONE (130 rows); memory says GATED — reconcile discrepancy** | P1 |
| Modal dismiss helpers (text-selection no longer closes) | useDismiss + backdropProps on all action modals | Jul08 | fb31d79 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Propagate modal fix to remaining ~8–9 un-migrated modals | TimelineEntryEdit, AdminUsers, Vault, HRCandidateDetail, HRImport… | — | audit §10, P2 bug | PARTIALLY DEVELOPED | N | N | — | L | N | Finish Jul-10 fix everywhere (~2–3h) | P2 |
| Conversation = source of truth / CI-BACKFILL (auto-create Meeting/Site-Visit Activity + Needs-Review queue + backfill) | Convo/call = business event → record + counters | — | audit D4, QA-div C2 | NOT STARTED | N | N | — | M | Y | Approve to build (render-time classification only today) | P2 |
| Buyer/Cold Conversation read-only (context prop) | Wire context to gate cold edit | — | ws-buyer-convo-readonly branch | PARTIALLY DEVELOPED | N | N | — | L | N | context prop DEFERRED (defined, unused) | P3 |

## IDENTITY / CUSTOMER LAYER / UNIFIED DETAIL

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Unified Lead Detail framework (one detail all categories) + DetailShell/tokens | ONE detail; one client=one profile | Jun24-Jul02 | e3544b9, memory | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | Shell shared; 3 alignment passes | P1 |
| Returning-Client card (getReturningClientView, cross-module) | Show returning client on detail | — | a12a857, memory | DEPLOYED BUT NOT VERIFIED | Y | Y | flag | L | N | NEXT: consolidate InvestorBanner | P2 |
| Unified Detail consolidation — 5 card pairs still duplicated | Each card exists ONCE, zero drift (Conversation/QuickNote/ClientInfo/Notes/Actions) | — | audit D3, QA-div C1 | WAITING FOR BUSINESS DECISION | N | N | — | M | Y | Large live refactor — needs phased plan+approval | P2 |
| Global Identity Resolution (dup-check whole CRM; virtual profile; admin Center=Phase E) | Built-but-dormant, Lead-only | Jul02 | fab09f7, audit D5/C3 | WAITING FOR BUSINESS DECISION | N | N | customer layer | M | Y | Not live on ingest; buyer-convert bypasses; 5 open decisions | P2 |
| Customer Layer / Release 2 (Customer-360, link/unlink, detection engine) | Additive computed grouping | Jun26 | feat/customer-layer-foundation (2 commits, 9ad1f9e) | PARTIALLY DEVELOPED | N | N | migration unapplied | M | Y | Foundation built, NOT merged/deployed; needs fresh rebase + phased approval | P2 |

## FOLLOW-UP / MEETING AUTOMATION

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Active Follow-up Board exclusions (activeBoardWhere) + Revisit Queue (Release 1, FROZEN) | One DRY board def; terminal-with-followup landing page | Jun26 | 9406e23 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | Release-1 closing audit on live prod data (read-only) | P1 |
| Follow-up "Complete" rolls +1 day (terminal-guarded) | No longer blanks date | Jun25 | RELEASE-1 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Follow-up rollover cron (overdue→next day) | Nightly; moved 9PM→~23:00/evening heartbeat | Jun21-Jul02 | f82a4e9,2760937 | INTENTIONALLY PAUSED | Y | Y | GH-Actions cron | M | N | Cron on intentional hold — rollover not auto-firing | P1 |
| Follow-up completion gate on logged contact + snooze reason + instant snooze + mobile search | Can't complete w/o contact | Jun24-30 | 06d4271,3cc77b8 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | — | P2 |
| Won/Closed boundary (meetings/visits NEVER close a lead) | Booked/sold/leased only | Jun28 | 6535c50 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | — | P1 |
| Won/Closed follow-up: keep clearing vs carry (handover/payment) | Decision | — | audit Q2 | WAITING FOR BUSINESS DECISION | N/A | N/A | — | L | Y | Default keeps clearing | P3 |

## GALLERY / RESOURCE LIBRARY

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Gallery / Resource Library (bytea≤5MB / URLs / templates + per-lead share tracking) | Shareable content; /gallery | Jun24 | 47120b7, migr 20260624170000 | DEPLOYED BUT NOT VERIFIED | Y | Y | 5MB ceiling | L | N | — | P2 |

## SALE OFF / LEASE OFF

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Sale Off / Lease Off (status-views over Lead) | Booked/sold/leased views | — | project-saleoff-leaseoff | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | Y | Keep as views or promote to first-class modules? (Q9/C7) | P3 |

## INFRA / DEPLOY / MIGRATIONS

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Deploy safety (pre-deploy backup + deploy log + rollback + risk gate) | Backup-first; risk disclosure | Jun18 | 5c093b7 | DEPLOYED BUT NOT VERIFIED | N/A | Y | — | L | N | — | P1 |
| Regression deploy-gate (tsc + regression.ts; 76→153 invariants) | Mirror lib query changes | ongoing | regression.ts | DEPLOYED BUT NOT VERIFIED | N/A | Y | — | L | N | 153/153 green at HEAD | P1 |
| RC1 master consolidation (6 sessions → ONE deploy path) | Single source of truth | Jul01 | 5bd8fe5 | DEPLOYED BUT NOT VERIFIED | N/A | Y | — | M | N | — | P1 |
| Migration ledger discipline (schema leads code; hand-apply + resolve) | Never rely on Vercel build to migrate | ongoing | MIGRATION-LEDGER | DEPLOYED BUT NOT VERIFIED | N/A | Y | — | M | N | 83 migrations; ledger clean | P1 |
| SW cache-bump discipline (vN per UI deploy; now v151) | Force fresh clients | ongoing | public/sw.js | DEPLOYED BUT NOT VERIFIED | N/A | Y | — | L | N | Chronic churn (~10+ bumps); deploy warns if missing | P2 |
| Daily pg_dump backup → Google Drive + admin notify | Nightly complete backup | Jun19 | 2952b7f | INTENTIONALLY PAUSED | N/A | Y | GH-Actions cron | M | N | Backup cron under cron hold — verify running | P1 |
| Perf (sin1 region, dashboard 49→19 queries, hot indexes, N+1 collapse) | Scale to 1,778 live leads | May24-Jul16 | d42f60e,20260716200000 | DEPLOYED BUT NOT VERIFIED | Y | Y | — | M | N | First real-scale exercise — measure | P2 |
| Backup hardening (durable off-platform + restore tool + drills) | Restore path; Neon PITR confirm | — | gap #15 | NOT STARTED | N/A | N/A | Neon tier | M | Y | Single JSON→artifacts today, no restore tool | P2 |
| File-storage blob backend (5MB Postgres ceiling → Vercel Blob) | Real object store | — | gap #5 | WAITING FOR BUSINESS DECISION | N | Y | BLOB token | M | Y | Infra/billing decision; blocks docs | P1 |
| Per-lead document storage (KYC/passport/booking forms) | Hold actual files, PII-gated, excluded from export | — | gap #3 | NOT STARTED | N | N | blob (#5) | M | Y | New LeadDocument model after blob | P1 |
| Neon Launch plan upgrade (free tier paused @100 CU-hr/mo) | Prod DB reliability | — | project-neon-hosting | WAITING FOR BUSINESS DECISION | N/A | Y | — | H | Y | ~$15–19/mo Launch plan | P1 |

## OTHER SITES (separate repos)

| Task | Requirement | Date | Source | Status | Exist | Future | Deps | Risk | Dec | Next action | Pri |
|---|---|---|---|---|---|---|---|---|---|---|---|
| WCR public website (CodeIgniter) forms → wc_crm_leads | Marketing site intake | — | project-wcr-website | DEPLOYED BUT NOT VERIFIED | Y | Y | — | L | N | Separate repo | P3 |
| WCR Academy (training, 28 lessons) → training.whitecollarrealty.com | HR induction | — | project-wcr-academy | DEPLOYMENT PENDING | N/A | N/A | Neon live | L | N | 28 lessons SHIPPED, needs Neon live | P3 |
| Whiteland Westin microsite (31 pages, forms→CRM) | SEO microsite | — | project-westin-microsite | WAITING FOR CREDENTIALS | N/A | N/A | logo + CRM key | L | N | Needs logo + IntakeKey | P3 |
| Dubai Property Expo site (25 pages, green build) | dubaipropertyexpo.com | — | project-dubai-property-expo | DEPLOYMENT PENDING | N/A | N/A | IntakeKey+Vercel+OG | L | N | Built, NOT deployed | P3 |
| Internship Ecosystem (/career/internship-program + 16 internships) | Intern JobPosting schema | Jun30 | project-internship-ecosystem | DEPLOYMENT PENDING | N/A | N/A | — | L | N | BUILT, not deployed | P3 |
| Location hierarchy fix (projects missing from city/country pages) | Fix + Trinity SQL | — | project-location-hierarchy | DEPLOYMENT PENDING | N | N | upload+SQL | L | N | FIXED, pending upload | P3 |
| Mobile LCP optimization (property pages own <head>) | Fix worst-LCP | Jun18 | project-mobile-lcp | DEPLOYMENT PENDING | N/A | N/A | — | L | N | Fixes await deploy | P3 |
| Funnel/SEO/AEO audit (GA4 dark, no header CTA) | Conversion tracking | — | project-funnel-seo-audit | WAITING FOR BUSINESS DECISION | N/A | N/A | — | M | Y | AUDIT-ONLY; P0=GA4 dark, P1=header CTA | P2 |

---

## INTENTIONALLY PAUSED (listed separately, per Lalit)

| Item | What it is | Why paused | State | Source |
|---|---|---|---|---|
| **Task Manager module** | Full v1 (My Day, board, reminders+cron, recurring, calendar, manager dash, approval, prefs/quiet-hours, reports, CRM-link, Morning/EOD, digests) | Paused by Lalit | Branch `feat/task-manager` (1 commit) + **uncommitted working tree**; flag `taskManager.enabled` OFF; migration `20260714120000_task_manager` **STAGED, UNAPPLIED** (334-line add); tsc0/regr green; **not browser-verified**; 6 of 7 `/tasks/*` pages 404 without pages | project-task-manager, audit D1, FINAL-REPORT E |
| **ALL AI features** | Summary, Buyer-Intel, Signals, Recommendations, Follow-up-AI, War Room, AI Sales Director | **PERMANENT AI PAUSE** (2026-07-06, Lalit) — build/modify NOTHING AI | `ai.enabled`/`ai.trialMode.enabled` flags OFF; lib/ai.ts dormant; highest historical churn (provider thrash, 1 explicit revert `3ad4e76`) | feedback-ai-pause, project-ai-state |
| **AI Sales OS v2** | Real-LLM engine, 7 /api/ai/* routes, 104 tests | Under AI freeze | Branch `ai-sales-os-v2` (14 commits ahead, @93f3798); complete but NOT merged/deployed | project-ai-sales-os-build, audit §2 |
| **AI Follow-up Intelligence** | 3-layer hybrid + Recommended Actions | Under AI freeze | Phase 1 DONE, Phase 2 awaiting approval | project-ai-followup-intelligence |
| **AI engine architecture / director standards** | src/lib/ai/ mock; 17 standards; central Brain design | Under AI freeze | Design/mock only | project-ai-engine-architecture, feedback-ai-director-standards |
| **GitHub-Actions crons (13 sub-daily)** | Follow-up rollover, SLA, unassigned-reminders, revival-sweep, site-visit-watch, backup, etc. | **INTENTIONAL HOLD** (2026-07-16, Lalit) — do NOT enable/fix/troubleshoot; NOT a bug (supersedes cron-outage-jul2 which flagged it P0) | `.github/workflows/cron.yml` present, Actions scheduling off; 2 Vercel daily crons (morning/evening) DO fire | project-cron-intentional-hold, audit §5/Q1 |
| **Development Sandbox** | Isolated intern/dev/QA env | ON HOLD | Code shipped (sandbox-gated); blocked on Neon+Vercel provisioning | project-dev-sandbox |
| **Motivation pilot (Bucket H voice)** | Team-scoped motivational voice | AI-adjacent; flag OFF | `motivationPilot.enabled` OFF | settings.ts |

> **Note on cron reclassification:** the Jul-14 recovery audit lists "13 GitHub-Actions crons dead" as its single **P0 bug (Q1)**. Per the newer `project-cron-intentional-hold` memory (Lalit, 2026-07-16), this is now an **intentional hold, not a defect**. Operational consequence stands (overdue follow-ups don't auto-roll; nightly backup + SLA don't fire) — flagged under Decisions.

---

## DECISIONS REQUIRED FROM LALIT (shortlist — Workstream 11 will expand)

1. **Cron intentional-hold vs operational drift** — confirm keeping all 13 GH-Actions crons off (follow-up rollover, nightly backup, SLA, unassigned-reminders all dormant), or re-enable selectively.
2. **Round-robin + 15-min SLA flip** (Q7) — currently OFF since 2026-06-22; flip after a validation window?
3. **Automation Controls** (autoAssignment/whatsapp/email/autoEscalation/scheduledActions) — all OFF; when to flip which?
4. **Dedup auto-merge/block on create+import + one-time historical-phone backfill** (Q5/D9) — #1 trust blocker; detection+manual-merge shipped, auto not built.
5. **Integration credentials** (Q6) — Acefone (telephony), Meta/WhatsApp Business, email/Resend, push/VAPID, Vercel Blob. All dark until supplied.
6. **File-storage blob backend + per-lead document (KYC/passport) storage** (gap #3/#5) — infra + billing call; blocks compliance docs.
7. **Neon Launch plan upgrade** (~$15–19/mo) — free tier paused at 100 CU-hr/mo; prod DB reliability.
8. **Device security ENFORCE flip** (Q8) — monitor→enforce once trusted-device list clean.
9. **Won/Closed follow-up** (Q2) — keep clearing, or let booked deals carry a follow-up?
10. **Bulk-action permission scope** (Q3, V1–V5) — `cold-data/bulk-assign` MANAGER (parked GS7), `leads set_team`, buyer assign/distribute: Admin-only or keep Manager?
11. **Unified-Detail consolidation** (C1/D3) — approve phased refactor of the 5 duplicated card pairs.
12. **Global Identity Resolution go-live** (C3, Phase E) — 5 open decisions; buyer-convert currently bypasses.
13. **Conversation = source of truth / CI-BACKFILL** (C2/D4) — approve the build (auto-create Meeting/Site-Visit records + Needs-Review queue + backfill).
14. **Buyer terminal rule** (G3) — accept stale follow-up on rejected buyers, or add `previousOwnerId`/clear-follow-up (schema change)?
15. **India Buyer Performance report** (C4) + **AI/rule buyer distribution generalize to India** (C5) — quick parity builds awaiting go-ahead.
16. **Task Manager** (Q11) — is the build approved to continue and who owns it? Commit the WIP so it isn't lost.
17. **Sale Off / Lease Off** (Q9/C7), **HR decisions** (secondaryOwnerId, interview naming, auto-join), **import-policy gate** (admin vs super-admin), **Revival keep-record-after-convert (rule 5)**, **funnel GA4 conversion tracking + header CTA**.
18. **Data items needing review** (not auto-fixed): 10 duplicate groups / 22 leads (`docs/reviews/duplicate-review-2026-07-16.md`); the Alok Gupta date sample (2023→2026); 27 Won/Closed unowned leads; 1 buyer→deleted-lead stranded pointer; 318 Needs-Review reclassification backlog; actor-owner 130-row reconcile status (DEV_TRACKER says DONE vs memory says GATED — reconcile the record).
19. **3,489-row synthetic CallLog deletion** — parked cleanup from the remarks overhaul; needs an explicit "go" (backup saved).
20. **Schema/build approvals pending**: `LeadIntakeLog` schema (batch-Jun30 recommendation); reference-data (status/source) editor greenlight; Dev Sandbox Neon+Vercel provisioning; HR website career-form manual upload + create Anu/Kimmi HR users; RC2 go/no-go (AI Sales OS + Customer Layer).

---

## SUPERSEDED / REMOVED (context — not open work)

- **Early "Wave 1–20" mass ship (May 27–28)** — ~60+ scaffolded features (digests, heatmaps, drip campaigns, Smart CMA, workflow builder, gamification/XP/Vault journal, Customers module, EOI). Much later **stripped/folded** (Customers → Lead record; gamification/Vault removed from lead page; dashboard sections repeatedly stripped per Lalit). Status: **DUPLICATE / SUPERSEDED**.
- **AI Sales Director panel** (`cdbb4db`) → explicitly **REVERTED** `3ad4e76` ("wrong direction").
- **`RevivalEngineListClient.tsx` / `LeadBulkActions.tsx`** — dead code (defined, never mounted). `ComingSoon.tsx` — 0 imports.
- **Dormant `BuyerVoiceMessage`/`Read` tables** in prod (harmless; from a mid-build incident, safe to drop later).
- Redundant branches: `ws-actor-vs-owner-timeline`, `ws-buyer-convo-readonly`, `ws-fresh-leads-priority`, `ws-*` (content shipped on main); remote `recovered/stash-*` — candidates for deletion after confirmation.

---

## SOURCES CONSULTED
DEPLOY_LOG.md (1749 lines, ~210 deploys) · CRM-AUDIT-RECOVERY-2026-07-14.md · FINAL-REPORT-2026-07-17.md · PRODUCT_QA_DIVERGENCES_2026-07-03.md · CRM-GAP-ANALYSIS.md · DEV_TRACKER.md · RELEASES.md · MIGRATION-LEDGER.md · OVERNIGHT_TASKS.md · 857-commit git log (2026-05-23→07-17) · 83 prisma migrations · src/lib/settings.ts feature flags · git branches + working tree · MEMORY.md index (~134 files).

**Could not access / out of scope:** live production UI (login-gated — the reason nothing is `VERIFIED IN PRODUCTION`); live Neon DB not probed (read-only probes were available but deferred as low-value for inventory); other-site repos (website/academy/microsite/expo live in separate repos, captured from memory only); prod runtime values of DB-stored feature-flag Settings rows (code defaults captured; e.g. Returning-Client card default-OFF in code vs memory "enabled in prod" — flagged to reconcile).
