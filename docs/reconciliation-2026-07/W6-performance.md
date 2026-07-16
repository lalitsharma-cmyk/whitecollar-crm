# W6 — Performance Audit (Workstream 10 / Audit-6)

**Date:** 2026-07-17 · **DB:** Neon Postgres PG17 (prod, ap-southeast-1 / Singapore) · **Mode:** STRICTLY READ-ONLY
**Method:** static source review + four temp read-only probes (`pg_indexes` / `_prisma_migrations` / `pg_class.reltuples` / `SELECT` / `EXPLAIN`). **Every DB statement executed was a READ — zero UPDATE/DELETE/INSERT/DDL, and `EXPLAIN` only (never `EXPLAIN ANALYZE`, so nothing was executed on the server, only planned).** Probes lived in the scratchpad, never in the repo.

**Population (live reltuples):** Notification ~39,657 · Activity ~22,277 · LeadFieldHistory ~10,449 · **Lead ~6,188** (3,856 live / 2,332 soft-deleted) · BuyerActivity ~6,156 · CallLog ~4,066 · BuyerRecord ~2,102 · WhatsAppMessage ~312 · Customer ~0.

**Context that shapes everything:** 109 pages carry `export const dynamic = "force-dynamic"` — practically the whole app renders on-demand and hits Neon on every navigation, with **no ISR / route cache**. The DB is in Singapore; agents are in India + UAE. Base round-trip latency is paid **per query barrier, per request**. The only speed levers are **query count, query shape, indexes, and payload size** — exactly this audit's scope. (Supersedes the source-only `docs/CRM_PERFORMANCE_REPORT.md`, written at 45 leads; this one is at 6,188 with live DB evidence.)

---

## Headline verdict

**Indexes are in excellent shape — there is no missing-index emergency.** Every hot Lead filter/sort column is indexed on prod, including the newest ones (`ghostingAt`, `returnedToPoolAt`, and the `forwardedTeam+currentStatus` composite from migration `20260716200000`, all verified live), plus five `gin_trgm_ops` GIN indexes for name/phone/email/company search. The `20260716200000_lead_hot_indexes` migration that the schema comment flagged as "authored only" **has in fact been applied** (`_prisma_migrations.finished_at` is set).

**The real risks are query SHAPE and PAYLOAD, not indexes**, and they are amplified by the Singapore-latency-per-barrier structure:

1. **Reports engine over-fetch** — the agent-performance **detail** page builds the *entire company* report to display *one* agent; `sources` and `agent-performance` pull tens of thousands of Lead rows into Node just to count them.
2. **A true parallelized N+1** in `reports/fresh-leads` (3 × N-agents `count` round-trips).
3. **Leads smart-sort** loads the full matching id-set into Node to sort in JS — bounded today, but the clearest scaling cliff.
4. **buyer-data** ships the whole scoped buyer table to the browser (client-side pagination).
5. **The first-contact-pending anti-join** (heaviest recurring query, EXPLAIN cost ~1,967, seq-scans Activity 22k + Lead 3.8k) runs ~4× per Leads load.

At 6,188 leads none of these is user-visibly slow yet; every one of them scales with table growth, and the fixes are mechanical.

---

## 1. INDEX COVERAGE

Verified against live `pg_indexes`. "Hot" = columns used in the WHERE/ORDER of the heavy pages.

### Lead (27 indexes live — comprehensively covered)

| Hot column(s) | Indexed? | Note / Recommendation |
|---|---|---|
| `ownerId`, `(ownerId, deletedAt)` | ✅ single + composite | agent scope |
| `currentStatus`, `(forwardedTeam, currentStatus)` | ✅ single + composite | status chips + per-team boards |
| `followupDate` | ✅ | follow-up chips/board |
| `createdAt` | ✅ | default sort / date filters |
| `forwardedTeam`, `(forwardedTeam, deletedAt)` | ✅ single + 2 composites | team scope |
| `leadOrigin` | ✅ | section gate |
| `lastTouchedAt` | ✅ | ghosting/overdue |
| `deletedAt` | ✅ | soft-delete chokepoint |
| `customerId` | ✅ | Customer layer |
| `ghostingAt`, `returnedToPoolAt` | ✅ | new attempt-cycle (07-17) |
| `market`, `reEngageAt`, `eoiStage`, `source`, `status`, `importBatchId` | ✅ | all present |
| `fingerprint` (partial, `WHERE deletedAt IS NULL`) | ✅ | dedupe |
| name/phone/email/company/altPhone | ✅ GIN `gin_trgm_ops` | substring search |
| **`assignedAt`** | ❌ | Used by `assignedTodayOr()` on **every** Leads load (4 counts + smart-sort). **EXPLAIN shows it is adequately served today** by the `(leadOrigin)` + `(importBatchId)` BitmapAnd (cost 138 — the active-pipeline gate narrows first, then filters `assignedAt` in memory). **Forward-looking only** — add if Activity/Lead grow 10×: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Lead_assignedAt_idx" ON "Lead"("assignedAt");` |
| `rejectedAt`, `needsManagerReview`, `isColdCall`, `budgetMin`, `meetingDate`, `siteVisitDate`, `aiScore` | ❌ | Low-selectivity or infrequent-drill columns; EXPLAIN shows no seq-scan pain at current size. **No action** — indexing booleans/low-cardinality here would not help the aggregate scans that use them. |

**Verdict: no Lead index changes required now.** The single genuinely-hot unindexed column (`assignedAt`) is already covered by composite bitmap-ands at this scale.

### CallLog (4,066 rows)

| Hot column(s) | Indexed? | Recommendation |
|---|---|---|
| `leadId`, `buyerId`, `userId`, `startedAt`, `ivrCallId` | ✅ singles | present |
| **`(userId, startedAt)`** | ❌ composite | Dashboard scoreboard + agent-performance count calls per agent per date-window. EXPLAIN today = BitmapAnd of the two singles (cost 95) — fine. **Forward-looking** (CallLog is append-only and grows fastest with call volume): `CREATE INDEX CONCURRENTLY IF NOT EXISTS "CallLog_userId_startedAt_idx" ON "CallLog"("userId","startedAt");` |

### BuyerActivity (6,156 rows)

| Hot column(s) | Indexed? | Recommendation |
|---|---|---|
| `buyerId`, `(buyerId, createdAt)`, `userId` | ✅ | present |
| **`(userId, createdAt)`** | ❌ composite | Dashboard buyer-call subquery filters `userId + createdAt + type`. Fine now; **forward-looking**: `CREATE INDEX CONCURRENTLY IF NOT EXISTS "BuyerActivity_userId_createdAt_idx" ON "BuyerActivity"("userId","createdAt");` |

### Activity (22,277 rows — 2nd largest)

| Hot column(s) | Indexed? | Recommendation |
|---|---|---|
| `leadId`, `scheduledAt`, `status`, `(type, completedAt)` | ✅ | present |
| **`(leadId, type)`** | ❌ | The `FIRST_CONTACT_PENDING_WHERE` anti-join (`activities: { none: { type IN … } }`) is the heaviest recurring pattern. It currently seq-scans Activity filtered by `type` (cost 1,010 within the 1,967 total). A `(leadId, type)` index would let the anti-join probe by leadId+type. **Low-priority** (anti-join is inherent; benefit is modest until Activity 5×'s): `CREATE INDEX CONCURRENTLY IF NOT EXISTS "Activity_leadId_type_idx" ON "Activity"("leadId","type");` |

### Customer (~0 rows) — stats, not an index

`pg_class.reltuples = -1`, `last_analyze = never`, `last_autoanalyze = never` — the Customer table has **never been analyzed**, so the planner has zero stats for any Global-Identity / customer-link query. Impact is nil today (table is empty — Customer layer is Phase-E foundation), but before that feature goes live run once: `ANALYZE "Customer";` (read-adjacent maintenance, not a schema change). Lead/Activity/CallLog show recent **autoanalyze** — stats there are healthy.

**House pattern for any of the above:** add the entry to `scripts/migrate-lead-indexes.ts` (`CREATE INDEX CONCURRENTLY IF NOT EXISTS`, no table lock, idempotent, Prisma-convention name) and mirror into `prisma/schema.prisma` `@@index`.

---

## 2. HOTSPOTS

| Page / Route | Issue | Evidence (file:line) | Impact | Fix |
|---|---|---|---|---|
| `reports/agent-performance/[agentId]` | **Over-fetch: builds the WHOLE company to show ONE agent.** Passes `role:"ADMIN"` so `scopedAgents` ignores `meId` and returns *all* agents; `buildAgentReport` runs ~30 queries incl. the all-leads scan, then `.find()` keeps one. Comment claims "scoped to just this agent" — code does the opposite. | `agent-performance/[agentId]/page.tsx:128-130` + `agentPerformance.ts:230-250` | **H** | Pin to the agent: pass a scope that hits the `role==="AGENT"` single-`findUnique` branch (or filter `agentIds` to `[agentId]`). ~30 queries → ~single-agent set. |
| `reports/fresh-leads` | **True parallelized N+1** — `Promise.all(agents.map(...))` fires **3 × N** `lead.count` round-trips (~61 for 20 agents). | `reports/fresh-leads/page.tsx:62-79` | **H** | Replace with 3 `groupBy({ by:["ownerId"] })` (leaderboard pattern) → 3 queries flat. |
| `reports/sources` | **6 unbounded `lead.findMany` (no `take`)** filtered only by `createdAt >= since` (default 90d, or `?range=year`), reduced in memory for funnel + 3 breakdowns. Can pull tens of thousands of Lead rows to produce counts. | `reports/sources/page.tsx:192-217` | **H** (at scale) | Funnel counts → `groupBy`/`count`; keep one row-pull only if a breakdown truly needs row columns. First-call metric (`$queryRaw`, 227-265) is already a correct SQL aggregate — good. |
| `reports/agent-performance` (combined) | Renders `BuyerPerformanceSection` **twice** (Dubai+India) → `buildBuyerReport`×2 (~14 each) + `buildBuyerSummary`×2 (6 each) on top of `buildAgentReport` → **~70 fixed round-trips** in one render. Downstream `ownedRows` (`agentPerformance.ts:471-490`) is a **no-`take`** all-non-deleted-leads pull for ADMIN, counted in memory. | `reports/agent-performance/page.tsx:171-188`; `agentPerformance.ts:471-490` | **M–H** | Convert `ownedRows` count/bucket to `groupBy`; consider one combined engine pass instead of two section renders. |
| `leads` (default view) | **Smart-sort loads the full matching id-set into Node to sort in JS**, on every unsorted load — two `findMany` with **no `take`**. Bounded by the `todue` window in the default case, but when any non-follow-up filter trips `effectiveFollowup="all"` it loads **all matching workable rows** (≈525 for the biggest agent book, up to ~3,856 for admin "All"+filter) × 2, sorts in JS, slices 50. Scales O(matching leads), unbounded by page size. | `leads/page.tsx:556-596` (`useSmartSort` = `!sp.sort`, line 518) | **M** now, **H** at scale | Push the tier ordering into SQL (a computed `ORDER BY CASE …` or a materialized `sortTier` column) + `skip/take`, so only 50 rows leave Postgres. See §4. |
| `leads` (every load) | **`callLogs: take:20` × 50 rows** pulled only to compute two integers (`connectedCount`/`notPickedCount`, "5C/2NC" col) + last-activity. Up to ~1,000 CallLog rows over the wire per page. Lead now has denormalized `connectedCount`/`attemptCount` columns (added 07-17). | `leads/page.tsx:606,616` → consumed `1116-1124`; same in `cold-calls/page.tsx:254` | **M** | Read the denormalized `connectedCount`/`attemptCount` columns (already selected at 1155), or one `callLog.groupBy` for the page's 50 leadIds. Drop `take:20` include. |
| `leads` (every load) | **5 sequential `Promise.all` barriers** = 5 Neon round-trip waits. Barriers 2 (main list, 598-650) and 3 (second count batch, 655-676) are **independent** (batch 3 uses only pre-computed `boardScope`/`activeScope`), as are the filter-option queries (722-735). | `leads/page.tsx:556, 598, 655, 722, 749` | **M** | Merge the independent barriers into one `Promise.all` → 5 waits down to ~3 (smart-sort → [list+counts+options] → per-row decorations). |
| `leads` (every load) | **Two full-table Seq Scans every load:** `cstatus` `groupBy` (EXPLAIN Seq Scan, cost 640) + DISTINCT-tags `UNNEST` raw query (Seq Scan + Sort, cost 665). Cheap now; pure per-load overhead; the tag list rarely changes. | `leads/page.tsx:633-638` (groupBy), `640-649` (tags) | **L–M** | Cache the tag/source option lists (revalidate on lead write, or short TTL). `cstatus` groupBy is inherent to "count all statuses" — leave. |
| `buyer-data` | **Ships the entire scoped buyer set to the client** — `take:5000` (2,102 live rows) with a lean select, then client filters/sorts/paginates. Large linearly-growing payload; **silent truncation above 5,000**. | `buyer-data/page.tsx:80-92` | **M** | Server-paginate (50/page) like `/leads` + `/cold-calls`; move the summary rollup to a `groupBy`/`$queryRaw` aggregate so the page needn't hold all rows. |
| `reports/sla` | `activity.findMany` with `include:{ user:true }` (**full User row per activity**, only name/team used), **no `take`**, run **twice** per load (this-month + prior). | `reports/sla/page.tsx:63-66,154-156` | **M** | `select:{ user:{ select:{ name,team } } }`; cap or aggregate. |
| `leads/[id]` (most-opened route) | Detail loads `activities take:100` + `callLogs take:50` **each with `include:{ user:true }`** (full User row per related row), plus ~8 sequential trailing awaits after the main `Promise.all`. Bounded per lead but fat payload + many barriers on the hottest route. | `leads/[id]/page.tsx:136-142`, trailing `194,199,221,285,325,435,455,466` | **M** | Lean `select` on the `user` includes; fold the independent trailing queries into the main `Promise.all`. |
| `reports/activity` | `callModuleRows` `findMany` **no `take`**, used only for `.length` + in-memory module tally. | `reports/activity/page.tsx:113-120` (used 183-187) | **L** | `groupBy`/`count` (bounded to one day, so low). |
| `reports/daily` | `readTarget` = 7 separate `findFirst`; `followupWorkflowStats` = 9 parallel `count`. Per-agent, not per-N, so not N+1 — just barrier count. | `reports/daily/page.tsx:91-99`; `followupGate.ts:207-217` | **L** | Collapse `readTarget` to one `findMany({ metric:{ in:[…] } })`. |
| `LeadsListClient` (client) | 2,111-line client component, ~40 `useState`, **0 `useMemo`**. Any state change (open a status dropdown, select a row, hover) re-renders the whole 50-row table and re-derives every per-row map. | `components/LeadsListClient.tsx` (state 260-340; row maps 857,1098,1207,1382) | **L** | Fine at 50 rows; if row interactions feel janky, extract a memoized `<LeadRow>` so popover/selection state doesn't re-render siblings. Static-only flag. |

**Confirmed NOT problems:** `reports/leaderboard` (reference pattern — 6 fixed `groupBy` for any agent count), `reports/ghosting`, `cold-calls` (paginated 50; the `for…of leads` loops at 480/494 fold the already-fetched page, not N+1), `call-logs` (paginated 50, lean includes), the dashboard per-agent scoreboard (already collapsed from "30 queries" to one `$queryRaw` with correlated subqueries, `dashboard/page.tsx:290-319`), and `contactActivityByLeadToday` (one `groupBy`, not N+1). The reconciler (`runReconciler()` on every Leads/Dashboard load) has all mutating branches **gated OFF by default**, so in practice it is ~5 Setting reads throttled to once/30s (note: the throttle is a module-global, so it is **per-serverless-instance** — weaker than it looks, but the gated branches make it cheap regardless).

---

## 3. EXPLAIN evidence (planning-only, no execution)

| Query (reconstructed) | Plan | Cost |
|---|---|---|
| Smart-sort priority SELECT (admin all-workable) | BitmapAnd(`leadOrigin_idx`, `deletedAt_idx`) → Bitmap Heap Scan — **indexed, no seq scan** | 620 |
| Fresh-today count (`assignedAt` window) | BitmapAnd(`importBatchId_idx`, `leadOrigin_idx`) then **filter `assignedAt`** — active-pipeline gate narrows first | 138 |
| **First-contact-pending anti-join** | **Seq Scan Activity (22k, filter type) + Seq Scan Lead (3.8k)** → Hash Right Anti Join → Nested-Loop Anti Join vs `CallLog_leadId_idx` | **1,967** ← heaviest; runs ~4×/Leads load |
| Per-agent CallLog count (`userId`+`startedAt`) | BitmapAnd(`startedAt_idx`, `userId_idx`) | 95 |
| `cstatus` groupBy (chip bar) | **Seq Scan Lead** (filter deletedAt + isColdCall) → HashAggregate | 640 |
| DISTINCT tags UNNEST | **Seq Scan Lead** → ProjectSet → Sort → Unique | 665 |

Takeaway: the only **seq scans** are the three whole-table aggregates (anti-join, cstatus groupBy, tags) — all cheap at 6k rows, all growing with the table. No index would remove the anti-join's Activity scan cheaply; the lever there is **running it fewer times per load** (§4 #5), not a new index.

---

## 4. Prioritized top-10 optimizations

1. **Fix the agent-performance detail over-fetch** (`[agentId]/page.tsx:128`). One-line scope change so it builds one agent, not the whole company. Biggest effort-to-payoff ratio in the set. **[H]**
2. **De-N+1 `reports/fresh-leads`** (`:62-79`) — 3×N `count` → 3 `groupBy(ownerId)`. Copy the leaderboard pattern. **[H]**
3. **`reports/sources` funnel counts → `groupBy`/`count`** (`:192-217`); stop pulling tens of thousands of Lead rows to count them. **[H]**
4. **Push Leads smart-sort into SQL** (`leads/page.tsx:556-596`). Replace the load-all-ids-and-sort-in-JS with an `ORDER BY CASE …` (or a maintained `sortTier` column) + `skip/take`. Removes the one unbounded-by-page-size fetch on the app's busiest page. **[M→H]**
5. **Collapse the repeated first-contact-pending anti-join** — `firstContactPendingCount`, `freshUntouchedCount`, the smart-sort `untouchedSortRows`, and the per-page `untouchedSet` each embed the cost-1,967 pattern (~4×/load). Compute the untouched id-set **once** per Leads render and reuse. **[M]**
6. **Server-paginate `buyer-data`** (`:80`) to 50/page + aggregate the summary; removes the whole-table→browser payload and the 5,000-row truncation risk. **[M]**
7. **Drop `callLogs: take:20` from the Leads + cold-calls list** (`leads:606/616`, `cold-calls:254`); read the denormalized `connectedCount`/`attemptCount` or one `groupBy` for the page. Cuts up to ~1,000 rows/load off the wire. **[M]**
8. **Merge the independent `Promise.all` barriers** on `/leads` (list+counts+filter-options, `:598/655/722`) and `/leads/[id]` (fold trailing awaits) — fewer Singapore round-trip waits per render. **[M]**
9. **Lean the `include:{ user:true }` selects** on `reports/sla` (`:63`) and `leads/[id]` (`:136-142`) down to `select:{ user:{ select:{ name,team } } }`. **[M/L]**
10. **Cache the Leads filter-option lists** (DISTINCT tags + sources, `:640/728`) and run **`ANALYZE "Customer";`** before the Customer-layer feature ships. **[L]**

**Forward-looking indexes** (add only when the relevant table grows ~10×; none needed today, all verified by EXPLAIN as adequately served now): `Lead_assignedAt_idx`, `CallLog_userId_startedAt_idx`, `BuyerActivity_userId_createdAt_idx`, `Activity_leadId_type_idx` — DDL in §1, house pattern `scripts/migrate-lead-indexes.ts`.

---

## Read-only confirmation

Every database statement executed during this audit was a **read**: `SELECT` against `pg_indexes` / `pg_class` / `pg_stat_user_tables` / `_prisma_migrations`, `prisma.*.count` / `groupBy`, and **`EXPLAIN` (plan-only, never `EXPLAIN ANALYZE`)**. No `UPDATE`, `DELETE`, `INSERT`, `CREATE`, `ALTER`, or `$executeRaw` ran. No source file was modified. The only file written is this report.
