# W5 — Import/Export Deep Testing + Reports/Dashboard Audit (Workstreams 7 + 8)

Audit-5 · 2026-07-17 · **STATIC, READ-ONLY** (source read + read-only prod DB probes; no writes, no live imports/exports).
Scope: Leads · Master Data · Dubai Buyer · India Buyer · Revival.

---

## Executive summary

**Part A (Import/Export):** The lead CSV importer (`intake/csv`) and its Google-Sheet twin are exemplary — Excel-serial/date/time handling, phone/email normalization, `phone OR email` dedup, verbatim `rawImport`/`customFields` preservation, `importBatchId` history, and a full delete/restore/purge revert flow. Buyer + Revival importers reach the same bar. **Three concrete gaps found:**
1. **`intake/google-sheet` is missing the Super-Admin (`canImportData`) gate** the CSV route enforces → a regular ADMIN can bypass the owner-only import rule.
2. **`/api/reports/export` interprets `smart=visit_potential` / `smart=ghosting` with a STALE `status`-enum clause** while `/leads` uses `currentStatus` → the exported CSV ≠ the on-screen list (probed: **26 rows on screen, 0 in the export**).
3. **India-buyer CSV export can emit a single bare-digit phone** (no `+`) that Excel coerces to a number (latent — 0 India buyers in prod today).

**Part B (count==records):** The flagship **Lead Source Intake report + the Dashboard hero tiles are the gold standard** — every number is computed through the exact envelope its drill URL opens, pinned to the **original `createdAt`**, with honest "not clickable" flags where no list filter exists. Probes confirmed count==records (converted 25==25; the report correctly uses *raw* unassigned for Master vs *strict* for /leads — a 274-row envelope gap it handles per-drill). **The weaker surfaces are the older reports:** most of `/reports/*` (sources, sla, daily, ytd, leaderboard, travel) are **entirely non-clickable**, several key "closed" metrics use **`updatedAt` as a fake close-date**, and `reports/page.tsx`'s Stalled-deals card **counts one population but links to another**.

---

## PART A — Import / Export

### A.1 Findings table

| Module | Flow | Aspect | Status | Evidence | Gap / fix |
|---|---|---|---|---|---|
| Leads | CSV/Excel import | Auth (Super-Admin only) | **WORKS** | `intake/csv/route.ts:273-276` `requireRole("ADMIN")` + `if(!canImportData(me)) 403` | — |
| Leads | CSV import | Template correctness | **WORKS** | `importMapping.ts:130` `leadTemplateHeaders()` (FIELD_LABELS, auto-remaps on re-import) | — |
| Leads | CSV import | Required vs optional | **WORKS** | `csv:556` skip row unless name\|phone\|email; preview reports missingName/Phone/Project `csv:356-369` | — |
| Leads | CSV import | Date + Excel-serial | **WORKS** | `parseImportDate.ts:20-42` (serial 1<n<100000, dd/mm/yyyy, ISO); future-date guard `csv:868-883` | — |
| Leads | CSV import | Time mapping | **WORKS** | `detectTimeColumn`+`applyTimeToDate` `csv:872-877`; `createdTimeKnown` blank when no Time col | — |
| Leads | CSV import | Phone + country/normalization | **WORKS** | `splitPhones(...,"+91")` + `validPhone` (10–13 digits) `csv:571-578` | Note: lead path uses `normalizePhone`, NOT the newer `phoneCanonicalDigits` (buyer path) — dedup still matches by last-10 tail, so OK |
| Leads | CSV import | Email normalization | **WORKS** | `validEmail` lowercases + rejects non-email `importValidate.ts:11-16` | — |
| Leads | CSV import | Dedup (phone OR email) | **WORKS** | preview `dupKeysForRow` (phone-tail OR email) `csv:380-394`; write path `leadDedupOR(phone,email,altPhone,altEmail)` `csv:603` | — |
| Leads | CSV import | Raw fields preserved | **WORKS** | `customFields` (unmapped, `csv:983-997`) + `rawImport` (entire row verbatim, `csv:1003-1012`); merge-safe on re-import | — |
| Leads | CSV import | Import history + batchId | **WORKS** | `importBatch.create` `csv:470`; `importBatchId` stamped on NEW rows only `csv:739`; counts finalized `csv:1112-1121` | — |
| Leads | CSV import | Revert / hard-delete | **WORKS** | `intake/history/[id]:40-149` delete(soft)→restore→purge; purge is Super-Admin-only, only after Trash | — |
| Leads | CSV import | Failure / partial reporting | **WORKS** | per-row try/catch `csv:1104-1106`; `errors[]`, `futureDateRows`, `unmatchedOwners`, `skippedCount` in response | — |
| Leads | **Google-Sheet import** | **Auth (Super-Admin only)** | **PARTIAL — GAP** | `google-sheet:147` `requireRole("ADMIN")` **only — no `canImportData`** (CSV has both `csv:276`) | **Regular ADMIN (Sameer, `isSuperAdmin=false`) can import via Sheet, bypassing owner-only rule. Fix: add `if(!canImportData(meUser)) return 403` after line 147.** |
| Leads | Google-Sheet import | Parity (batch/raw/date/dedup/revival) | **WORKS** | `importBatch` `gs:284`, `rawImport`, `parseImportDate`+future guard `gs:427-434`, `leadDedupOR` `gs:323`, `applyRevivalMerge` `gs:380` | — |
| Master Data | import | (uses lead CSV/Sheet path) | **WORKS** | All bulk imports land `leadOrigin=MASTER_DATA` `csv:735`; admin then Moves to Leads/Revival | — |
| Revival | import (dupMode=revival) | Non-destructive re-engage | **WORKS** | `revivalImport.ts:167-327` fill-if-empty + append remarks + NOTE timeline + `leadOrigin=REVIVAL` + `LeadFieldHistory` audit | Revival re-engagements are **not** batch-rollback-able (lead pre-existed) — per-field history is the undo trail (documented `revivalImport.ts:28-29`) |
| Dubai/India Buyer | import | Auth (Super-Admin only) | **WORKS** | `buyer-data/import:219-220` `requireUser()` + `canImportData` 403 | — |
| Dubai/India Buyer | import | Template correctness | **WORKS** | `buyerImportMap.ts:34-130` canonical first-alias headers; `buyerTemplateHeaders()` re-imports at 100% | — |
| Dubai/India Buyer | import | Required field | **WORKS** | `clientName` required, else logged failure `buyer-data/import:269-273` | — |
| Dubai/India Buyer | import | Date + follow-up (guarded serial) | **WORKS** | `transactionDate`=`parseImportDate` (never import time) `:334,431`; `parseFollowupDate` guards bare ints `:318` | — |
| Dubai Buyer | import | Phone canonical + nationality | **WORKS** | Dubai: `canonicalizePhone(+CC)` + `nationalityFromPhone` `:286-291`; India: raw `toJsonArray` | — |
| Dubai/India Buyer | import | Dedup (buyerKey/phone/email, per market) | **WORKS** | `findExistingBuyer` buyerKey→last-8 tail→email, `market`-scoped `:158-204`; dupMode skip/update/create/history | — |
| Dubai/India Buyer | import | Raw fields + history + failures | **WORKS** | `rawImport`+`extraFields` `:446-447`; `BuyerImportBatch` counters + `BuyerImportLog` `:472-482` | — |
| Dubai/India Buyer | import | Revert / purge | **WORKS** | `buyer-data/import/history/[id]:44-120` delete/restore/purge (purge Super-Admin, Trash-first) | — |
| Leads/Master/Revival | **Export** | Auth (Super-Admin only) | **WORKS** | `reports/export:178,214-215` `requireRole("ADMIN")` + `canExportData` | — |
| Leads/Master/Revival | Export | All rows / all fields / imported fields | **WORKS** | `leadCsvRow` `reports/export:85-139` — 40+ cols incl. `rawImport`, `rawRemarks`, `module`, ownership | — |
| Leads/Master/Revival | Export | Phone format (no sci-notation) | **WORKS** | `l.phone` is E.164 (`+…`) → Excel treats as text | — |
| Leads/Master/Revival | Export | Date/number format | **WORKS** | `istIso()` → `…+05:30` string (text); budgets numeric but ordinary magnitude | — |
| Leads/Master/Revival | Export | Filtered vs full + CSV + Excel | **WORKS** | GET mirrors `/leads` filters; POST = explicit client id-set (`leadIds`); `master=1`; xlsx branch | — |
| Leads | **Export — `smart=` filters** | Filtered-export fidelity | **MISSING/BUG** | `reports/export:341-352` `smart=visit_potential`→`status IN [QUALIFIED,SITE_VISIT]`; `smart=ghosting`→`status notIn [WON,LOST]` — but `/leads:462-464` uses `currentStatus IN CLOSING_STATUSES` / `currentStatus notIn SUPPRESSED` | **Export CSV ≠ on-screen list. Probed: /leads?smart=visit_potential = 26 rows, export = 0. The /leads Export button forwards `smart` verbatim (`leads/page.tsx:801-806`), so this is user-reachable. Fix: make the export reuse the /leads smart clauses (currentStatus/CLOSING_STATUSES).** |
| Leads/Master/Revival | Export | Re-import compatibility | **PARTIAL** | Export headers (`id,name,phone,currentStatus,aiScore…`) differ from import template labels; core fields (name/phone/email/city/budget/source/remarks) re-map via fuzzy `pick()`, but status/AI/module columns won't | Acceptable round-trip for contact data; not a lossless re-import. Low priority |
| Dubai/India Buyer | Export | Auth / all rows / all fields / imported | **WORKS** | `buyer-data/export:137-152` `canExportData`; `deletedAt:null` per market; incl. `rawImport`, `ownerName`, `poolStatus`, `businessStatus` | — |
| Dubai/India Buyer | Export | Phone format | **PARTIAL (latent)** | `parseJsonArray(phones).join("; ")` `:60`. Multi-phone → text (has `;`). **Single bare-digit India phone (no `+`) → Excel coerces to number** | Probed: **0 India buyers today** → latent. Fix: prefix `'` or quote single all-digit phones, or canonicalize India phones to `+91…` on import |
| Dubai/India Buyer | Export | Number format (txn value) | **WORKS** | `transactionValue` numeric **plus** `transactionValueDisplay` formatted string alongside `:69-70` | Very large AED values could show sci-notation in a narrow Excel col, but the display column mitigates |
| Call Logs | Export | Auth + scope + audit | **WORKS** | `call-logs/export:45-47` `canExportData` (Super-Admin); role-scoped where; `startedAt` basis; phone from lead (E.164) | Stale code comment (`:106`) says "reachable by AGENTs" — the `canExportData` gate above already blocks them. CSV only (no xlsx) — minor |
| Agent-Perf / Buyer-Perf | Export | Auth + single-source columns | **WORKS** | `agent-performance/export` & `buyer-performance/export` — `requireRole("ADMIN")`+`canExportData`; shared `buildAgentReport`/`buildBuyerReport` + `*_METRIC_COLUMNS`; watermark+audit | — |
| HR Candidates | Export | Auth (HR RBAC) | **WORKS** | `hr/candidates/export:38` `requireHrPermission("exportData")` (HR's own engine — correct, separate module); `createdAt` basis | — |

### A.2 Import/export gaps by module (concise)

- **Google-Sheet import (all lead modules):** missing `canImportData` Super-Admin gate → owner-only-import rule bypassable by a regular ADMIN. **Top fix.**
- **Leads export:** `smart=visit_potential`/`smart=ghosting` interpreted with the stale `status` enum → exported set ≠ screen (26 vs 0 probed).
- **India Buyer export:** single bare-digit phone → Excel scientific-notation coercion (latent; no India buyers yet).
- Everything else (CSV lead import, buyer import, revival import, revert flows, lead/buyer/call/perf exports): **WORKS**, with strong `rawImport` preservation and audit/watermark discipline throughout.

---

## PART B — Reports & Dashboard (count == records)

### B.1 Report/Metric table

| Report / Metric | Count source | Drill target | Clickable? | count==records verdict | Date basis | Issue / fix |
|---|---|---|---|---|---|---|
| **Lead Source Intake — Total / Today / Assigned / Unassigned / Converted / Lost** | `intake.ts` per-module envelopes (leadsBase/masterBase/revivalBase/buyer) `:522-553` | `/leads`,`/master-data`,`/cold-calls`,`/buyer-data` via `leadDrill`/`buyerDrill` | **YES** (each cell a `<Link>`) | **MATCH — gold standard.** Envelope == drill by construction; honest flags where no filter exists | **`createdAt`** — `dateField:"createdAt"` pinned on every drill `:352` | Model report. Others should follow it |
| Intake — Master Converted | `masterBase + currentStatus IN CLOSED_OUTCOME` | `/master-data?bucket=converted` | YES | **MATCH — probed 25 == 25** | createdAt window | — |
| Intake — Rejected/Lost | `lostFull = LOST status OR rejectedAt` | `/master-data?bucket=lost` | YES | **MATCH — probed lostFull=374; the +15 rejected-but-workable remainder shown separately, not folded in** | createdAt window | Correctly honest |
| Intake — Unassigned | Master uses **raw** `ownerId:null`; Leads uses **strict** `ownerId:null AND rejectedAt:null` | `?bucket=unassigned` vs `?owner=unassigned` | YES | **MATCH — probed raw 376 vs strict 102 (274 rejected-unowned gap); report uses the correct envelope per drill** | createdAt window | The 274-gap is exactly the trap other reports fall into |
| Intake — Assigned (Leads part) | `ownerId not null` | (none — `/leads` has no "any owner" filter) | **NO (flagged)** | Honest: count shown, part left unlinked + noted `:770-772` | createdAt | Would need a `/leads?owner=any` affordance |
| **Dashboard — Fresh untouched today** | `freshUntouchedWhere(meScope)` `dashboard:233` | `/leads?fresh=untouched` (+seg) | YES | **MATCH** (shared `freshLeads.ts`) | assignedAt (fresh concept) | — |
| Dashboard — Hot untouched | `hotUntouchedWhere(meScope)` `:205` | `/leads?ai=HOT&untouched=1&followup=all` | YES | **MATCH** | snapshot | — |
| Dashboard — Overdue follow-ups | `activeBoardWhere + followupDate < boundary` `:206-210` | `/leads?followup=overdue` | YES | **MATCH** (shared `activeBoardWhere` w/ Action List) | followupDate | — |
| Dashboard — Meeting/Visit Stage | `workableWhere + currentStatus IN CLOSING_STATUSES` `:215-217` | `/leads?smart=visit_potential` | YES | **MATCH** — `/leads` uses the same `currentStatus IN CLOSING_STATUSES` `leads:462-464` | snapshot | (But the **export** of this same param diverges — see A.1) |
| Dashboard — Cold revival | `coldScope + lastTouchedAt<30d + (budget>5M OR HOT)` `:218-230` | `/cold-calls` (no params) | YES-but | **DIVERGE** — count is a filtered subset; drill opens the **whole** cold list (far larger) | lastTouchedAt | Fix: pass params reproducing the 30d/high-value filter, or relabel as a curated shortcut |
| Dashboard — By-Salesperson: Closeable / Needs Lalit / Clients | per-agent `$queryRaw` `:300-319` | `/leads?owner=&cstatus=&seg=all` · `?needs=1` · `/master-data?owner=` | YES | **MATCH** — drill statuses mirror the SQL exactly `:334,876,883` | snapshot | — |
| Dashboard — By-Salesperson: Calls/Connected/Due/Overdue | same `$queryRaw` | (none) | **NO** | Plain numbers; logically could drill to call-logs/activities | period (startedAt/scheduledAt) | Add drills to `/activities`/call logs |
| Dashboard — Daily Performance KPIs (calls/connected/virtual/f2f/fresh/deals) | callLog/activity/lead counts `:358-367` | (none) | **NO** | Non-clickable scorecard | mixed; **deals = `updatedAt IN period`** `:363` | `updatedAt` ≠ close date; not verifiable to records |
| reports/page.tsx — Forecast / Leak / **Stalled deals** | weighted `findMany` / 4× `count` / `$queryRaw` Activity-age | `/leads` · `#funnel` · `/leads?when=overdue` | Link (generic) | **DIVERGE** — Stalled counts "meeting-stage aging >7d (Activity.createdAt)" but link opens `?when=overdue` (a lastTouched filter) = different population | snapshot / Activity.createdAt | Also `statusCounts` groupBy omits `ACTIVE_ORIGIN_WHERE` while the leak card includes it → internal mismatch |
| reports/sources — source × (total/contacted/qualified/booked/lost) | 5× `lead.findMany` bucketed in JS `:192-211` | (none) | **NO** | Not verifiable — no drill | **`createdAt` window** ✅ | Add `/leads?source=&dateFrom=&dateTo=&…` drills; layers a current-status filter on the createdAt window so a drill must reproduce both |
| reports/followup-compliance — Overdue / Due today / Chronic | `lead.groupBy` on `followupDate`; chronic via rollover history | Overdue → `/leads?owner=&followup=overdue&showCold=1` | Partial | Overdue **MATCH** (null-status fix, 752-row gap closed `:52-55`); Due-today & Chronic **not linked** | followupDate | Add drills for Due-today + Chronic |
| reports/sla — Scheduled/Completed/Reschedule/No-show | `activity.findMany` tallied in JS | (none; agent chips only) | **NO** | No drill; "Rescheduled" sums an event counter (≠ record count) | scheduledAt/completedAt | Operational dating correct; add drills |
| reports/cooling — cooling count / avg budget / top owner | `$queryRaw` HOT→WARM/COLD downgrade events | per-row lead → `/leads/{id}` | Row-only | Headline count not a set-drill; top-owner unlinked | Activity.createdAt (re-score) | Add a set-drill for the total |
| reports/activity — calls-by-module + feed | `callLog.findMany` (uncapped count) + feed (take 100/50) | audit rows → `/leads/{id}` | Row-only | **DIVERGE (documented `:243-245`)** — total uncapped, feed capped → count > visible | startedAt | Call rows/names not clickable |
| reports/changes — change count + per-user | `leadFieldHistory.findMany take:500` | per-row → `/leads/{id}` | Row-only | **Cap risk** — when >500, count + per-user chips undercount | changedAt | Note "(showing latest 500)" but chips derived from capped set |
| reports/daily — targets/achieved | callLog/activity/lead counts | (none) | **NO** | Not verifiable; **Deals/Sales = `updatedAt IN day`** → any edit to a booked lead re-counts it | mixed + updatedAt proxy | Fully non-clickable |
| reports/ytd — leads/bookings/won/commission | `lead.count`/`findMany`, callLog | (none) | **NO** | Non-clickable; **wonDeals & top-agents on `updatedAt`** proxy | leadsCreated ✅ `createdAt`; rest bookingDoneAt/updatedAt | — |
| reports/team-comparison — 11 metrics | `computeTeamMetrics` mixed | **Active leads only** → `/leads?showCold=1&seg=all&team=&cstatus=&followup=all` | Partial | **Best-behaved** — links only the one URL-reproducible metric; bookings-on-`updatedAt` left intentionally unlinked | newLeads ✅ createdAt; others mixed | Model for "link only what reconciles" |
| reports/leaderboard — calls/active/qualified/won | `groupBy` mixed windows | (none) | **NO** | Row mixes windows (Calls=90d vs Active/Qualified/Won=all-time) — not one cohort; agent name plain | startedAt 90d + all-time snapshot | — |
| reports/fresh-leads — assigned/first-contact/untouched/backlog | `lead.count` via `freshLeads.ts` | name → `/leads?fresh=untouched&owner=` | Partial | Only "untouched" reproduced by the link; "assigned today"/"first-contact"(a subtraction)/"backlog" not | assignedAt (createdAt legacy fallback) | — |
| reports/commission — booked/received/outstanding + detail | `lead.findMany` bookingWhere; detail take 50 | detail → `/leads/{id}` | Row-only | Detail capped 50 vs full count → summary can exceed visible; summary tiles unlinked | bookingDoneAt/commissionReceivedAt/updatedAt | — |
| reports/travel — trips/km/reimbursement | `activity.findMany completedAt` | (none; agent chips) | **NO** | No drill; sums stored km/amount (fine) | completedAt | — |

### B.2 count==records — probe results (read-only, prod)

Probe script: `…/scratchpad/w5-probe.ts` (counts only). Numbers as of 2026-07-17:

| # | Check | Result | Verdict |
|---|---|---|---|
| 1 | `smart=visit_potential`: `/leads` (`currentStatus IN CLOSING_STATUSES`) vs `/api/reports/export` (`status IN [QUALIFIED,SITE_VISIT]`) | **26 vs 0** | **DIVERGE** — export CSV ≠ screen (Part A bug) |
| 2 | Intake "Master Converted" report count vs `/master-data?bucket=converted` | **25 == 25** | MATCH |
| 3 | "Rejected/Lost": LOST-status-only vs `bucket=lost` (status OR rejectedAt) | **359 vs 374** (remainder 15) | MATCH — report flags the 15 separately, doesn't fold into the /leads-linked number |
| 4 | Unassigned raw (`owner=null`) vs strict (`owner=null AND rejectedAt=null`) | **376 vs 102** (274 gap) | MATCH — report uses raw for Master `bucket=unassigned`, strict for `/leads owner=unassigned`; each matches its drill |
| 5 | India-buyer export single bare-digit-phone rows (Excel sci-notation risk) | **0 of 0** | Latent — no India buyers in prod yet |

**Interpretation:** where the codebase has been rebuilt around the count==records mandate (Intake report, Dashboard hero tiles, team-comparison, followup Overdue), it **holds exactly** — including the subtle raw-vs-strict unassigned envelope (a 274-row trap it navigates correctly). The divergences are (a) the export's stale `smart` clause and (b) the older, pre-mandate reports that were never wired for drill-through.

### B.3 Non-clickable-but-should-be metrics (highest value first)

1. **reports/sources** — the entire source × stage funnel (already `createdAt`-windowed; just needs `/leads?source=&dateFrom=&dateTo=&<status pin>` drills).
2. **reports/daily & reports/ytd** — performance/volume tiles: no drill anywhere; plus they should move off the `updatedAt` close-date proxy before they're made clickable.
3. **reports/leaderboard** — per-agent Active/Qualified/Won cells (agent name isn't even a link).
4. **Dashboard By-Salesperson Calls/Connected/Due/Overdue** — plain numbers next to already-clickable Closeable/Needs.
5. **reports/sla & reports/travel** — every metric cell plain (agent chips link, numbers don't).
6. **Set-level drills** for `cooling` (total), `commission` (summary), `activity` (calls-by-module) — currently only single-row `/leads/{id}` links exist.

### B.4 Date-basis findings (original-date mandate)

- **Correct (`createdAt` = original lead date):** Lead Source Intake (all drills pinned `dateField:createdAt`), `reports/sources` (all fetches), `ytd` leadsCreated, `team-comparison` newLeads, Dashboard "new since yesterday" (`when=24h`). Import path also **backdates `createdAt` to the sheet's Date column** with a future-date guard (`csv:861-883`), so retroactive intake reports stay honest.
- **`updatedAt`-as-fake-close-date (flag):** `daily` Deals/Sales, `ytd` wonDeals + top-agents, `team-comparison` bookings fallback, `dashboard` dealsPersonal, `reports/page.tsx` compat slots. "Closed in period" is really "row edited in period" → inflatable and not a true close date. Fix: use `bookingDoneAt`/`commissionReceivedAt` (or a dedicated `closedAt`) consistently.
- **Current-owner snapshot despite a range selector (flag):** `agent-performance` assignment/outcomes book and `leaderboard` Active/Qualified/Won ignore the date window entirely (point-in-time current book). Fine if labelled "current book", misleading under a `?range=` control.
- **Operationally-dated (appropriate, not a bug):** followup-compliance (followupDate), sla (scheduled/completedAt), cooling (downgrade event), activity (startedAt), changes (changedAt), commission (bookingDoneAt), travel (completedAt).

### B.5 Bifurcation / scoping (spot-checks)

- **Module separation:** Intake report keeps Leads / Master / Revival / Dubai-Buyer / India-Buyer as **disjoint envelopes** (`intake.ts:520-562`), each drilling to its own list; buyer strips are market-split. Export `leadCsvRow.module` correctly derives Revival/Master/Leads from `isColdCall`/`leadOrigin` `reports/export:117-121`.
- **Agent/team/source scoping:** honored via `leadScopeWhere` (leads/revival), `buyerScopeWhereForMarket`, MANAGER team-lock, and the AGENT source-privacy gate (`canSeeSource`) — mirrored between report and drill.
- **Back-navigation:** `changes` passes `?back=/reports/changes`; most reports rely on browser back (filters live in the URL, so they survive). No broken state observed.

### B.6 In-flight reports (not faulted, per brief)

- `/reports/ghosting` and `/reports/revival-cycles` **exist and appear built** (246 / 285 lines). The shared `ghost=1|0` drill primitive is already wired into `leadFilterWhere.ts:117-121` (`GHOSTING_DISPLAY_WHERE`). Treated as **owned by the feature agents** — not audited for count==records here.

---

## Top fixes (priority order)

1. **Add the Super-Admin gate to `intake/google-sheet`** — `if(!canImportData(meUser)) return 403` after `requireRole("ADMIN")` (`google-sheet:147`). Closes an owner-only-import bypass that the CSV route already blocks. *(Security/permission — do first.)*
2. **Fix the export `smart=` clauses** to reuse the `/leads` definitions (`currentStatus IN CLOSING_STATUSES` for `visit_potential`, `currentStatus notIn SUPPRESSED` for `ghosting`) in `reports/export/route.ts:341-352`. Today a Super-Admin exporting the on-screen `visit_potential` view gets **0 rows instead of 26**.
3. **reports/page.tsx Stalled-deals card** — point its link at the same population it counts (meeting-stage aging), and align `StatusFunnel`'s `statusCounts` groupBy with `ACTIVE_ORIGIN_WHERE` so the funnel and the leak card agree.
4. **Retire the `updatedAt` close-date proxy** in `daily`/`ytd`/`team-comparison`/dashboard deals — use `bookingDoneAt`/`commissionReceivedAt` so "closed in period" is a real close.
5. **India-buyer export phone** — quote/prefix single all-digit phones (or canonicalize India phones to `+91…` on import) to avoid Excel numeric coercion (latent today).
6. **Make the pre-mandate reports clickable** — start with `reports/sources` (already `createdAt`-windowed) using the `leadFilterWhere` drill primitives (`bucket=`, `dateFrom/dateTo`, `source=`) that the Intake report already proves out.
