# CRM Performance Review

**App:** White Collar Realty CRM — `crm.whitecollarrealty.com`
**Stack:** Next.js 16 (Turbopack) · React 19 · Prisma 6 · PostgreSQL (Neon, **Singapore** region) · Vercel **Hobby** plan
**Source reviewed at:** commit `4dd8ba1` ("Round 11")
**Method:** Source-code review only. The live app is login-gated, so there is **no real Lighthouse run, no production profiler trace, and no live network waterfall** behind this report. Every concrete latency number is a **source-based estimate labelled (to be measured during live UAT)**. Query counts, N+1 patterns, and missing indexes are read directly from source and are not estimates.
**Seed findings:** `docs/QA-AUDIT-FINDINGS.md` §P2-5 (loading/error states) and §P2-6 (perf hotspots). Note: that audit was taken at commit `60fa393` with **45 leads**; the perf observations below are re-verified against current Round 11 source.

---

## 0. Spec targets (what "good" means here)

| Surface | Target |
|---|---|
| Dashboard | < 3s |
| Leads list (paginated) | < 3s |
| Lead detail | < 2s |
| Mobile key actions (call / WhatsApp / remark / follow-up) | < 2s |

These are the bars the rest of this report measures risk against.

---

## 1. The structural fact that shapes everything: `force-dynamic` everywhere

Roughly **78** occurrences of `export const dynamic = "force-dynamic"` across pages, API routes, and cron routes. Practically every page in the app is force-dynamic. Consequences:

- **No static generation, no ISR, no full-route cache.** Every page view is server-rendered on demand and hits the database.
- **Every navigation = a fresh round-trip to Neon Singapore.** For agents on mobile data in India/UAE, the network + DB latency is paid on **every** page load, with nothing served from cache.
- This is a defensible choice for a CRM (data is per-user and must be live), but it means **the only levers for speed are query count, query efficiency, and indexes** — there is no caching cushion. That makes the items below high-leverage.

**Geography note:** the DB is in Singapore; agents are in India and UAE. Base round-trip latency is non-trivial and is paid per request. **(to be measured during live UAT)** — but it amplifies every extra query described below.

---

## 2. Per-page query load (read from source)

| Page | Queries per load | Pagination | Reconciler runs? | Notes |
|---|---|---|---|---|
| **Dashboard** (`dashboard/page.tsx`) | **~40+** | n/a | **Yes** (line 30) | 3 `Promise.all` batches (~16 + 5 + 4) **plus** sequential singletons (mood, attendance, morning queue, testing-mode, last win) **plus** a by-salesperson `$queryRaw` with **9 correlated subqueries per agent** (ADMIN/MANAGER only). |
| **Leads list** (`leads/page.tsx`) | ~12 (one `Promise.all`) | **Yes** — `PAGE_SIZE = 50`, skip/take | **Yes** (line 35) | Batch = leads, count, hot, newToday, totalAll, agents, 5 follow-up counts, distinct-tags `$queryRaw` (UNNEST/string_to_array). Default view = today's follow-ups. |
| **Lead detail** (`leads/[id]/page.tsx`) | ~8–10, **several sequential** | n/a (single lead) | **Yes** (line 72) | Main `Promise.all` (lead w/ 8 includes, meeting acts, all projects, sticky-note upsert) **then sequentially**: `findMatchingLeads` (dynamic import, ~line 120), `bestUnitsForLead(id,3)` (~line 129), `getTravelRatePerKmInr` (~166), conditional `agents` findMany (~174). ~20+ cards rendered. |
| **Properties** (`properties/page.tsx`) | **1 + 3N** (N+1) | No | No | `project.findMany` (units + `_count.discussedBy`) then `Promise.all(projects.map(p => bestLeadsForProject(p.id, 5, scope)))`. Each `bestLeadsForProject` runs **3 queries** (`leadsForProject.ts`). 20 projects ⇒ **~61 queries**. |
| **Pipeline** (`pipeline/page.tsx`) | 2 (one `Promise.all`) | **No — loads ALL active-pipeline leads** | Inferred no | `leads.findMany` with a per-lead STATUS_CHANGE activity include + agents. Scales linearly with the active pipeline; no cap. |

---

## 3. Hotspots (confirmed in source) and why they bite

### H1 — Properties is a classic N+1: `1 + 3N` queries
`properties/page.tsx` (~line 135) fans out:
```ts
Promise.all(sortedProjects.map(p => bestLeadsForProject(p.id, 5, leadScope)))
```
and `bestLeadsForProject` (`src/lib/leadsForProject.ts`) itself runs **three** queries each: `project.findUnique`, `leadProperty.findMany`, `lead.findMany`. With 20 projects that's **~61 sequential-ish DB hits** in one page render. This is the worst per-page query multiplier in the app and it grows linearly with the number of projects. **Today it's tolerable only because the dataset is tiny.**

### H2 — Lead detail does avoidable sequential work
After the main `Promise.all`, three independent operations run **one after another** instead of together: `findMatchingLeads`, `bestUnitsForLead`, and `getTravelRatePerKmInr` (`leads/[id]/page.tsx` ~lines 120–166). Each is its own DB round-trip to Singapore, serialized. On the spec's < 2s budget, serialized round-trips are exactly what eats the margin.

### H3 — `runReconciler()` runs inline on page loads
`runReconciler()` fires on dashboard (line 30), leads list (line 35), **and** lead detail (line 72). It's a write-heavy SLA engine (`src/lib/reconciler.ts`): orphan auto-assign (take 50), 15-min SLA escalation (take 50), needs-you flag (take 100), each with per-row updates + notifications.
- It's protected by a **module-level 30s throttle** (`MIN_RERUN_GAP_MS = 30_000`) and gated by testing-mode/round-robin settings, so it does **not** run on every single request.
- **But** when it does run, the user whose page load triggers it **pays for that write work synchronously** — an unlucky page view absorbs up to ~200 row-touches + notifications. It also means background SLA correctness is coupled to someone happening to load a page. On serverless, a module-level throttle is also **per-instance**, so multiple warm instances can each run it within the same 30s window.

### H4 — Pipeline has no pagination
`pipeline/page.tsx` loads **all** active-pipeline leads with a per-lead activity include. Fine at 45 leads; at scale this is an unbounded query feeding a Kanban board.

---

## 4. Missing loading / error states (§P2-5) — perceived performance

Confirmed by glob over the route tree:
- **`loading.tsx`: only 3** — `dashboard`, `leads`, `leads/[id]`.
- **`error.tsx`: only 1** — `leads/[id]`.
- **No global `app/error.tsx` and no `not-found.tsx`.**
- There are **~50 page routes** under `(app)`.

Because every page is force-dynamic (server-rendered, DB-per-request), a route **without** `loading.tsx` shows the user **nothing** until the server finishes all its queries — on mobile data to Singapore that's a blank screen that reads as "frozen/broken." Routes like **properties** (the 1+3N page), **pipeline**, **reports/***, and the **admin/*** pages have no loading skeleton today. And with no global `error.tsx`, a thrown server error on most routes has no friendly boundary.

**This is the cheapest perceived-performance win in the whole app:** a `loading.tsx` doesn't speed up the server, but it removes the "is it broken?" pause.

---

## 5. Scalability estimate — 25,000 leads

The dataset reviewed was ~45 leads. Projecting to **25,000 leads / proportionally more projects & activities**, based purely on the query shapes above:

- **Properties (H1)** — `1 + 3N` scales with **project count**, not lead count, but each `bestLeadsForProject` does a `lead.findMany` over the (now huge) lead table. Without the right index (see §6) every one of those N calls is a filtered scan. With 50–100 projects this page becomes the worst offender. **Likely well over the 3s class. (to be measured during live UAT)**
- **Pipeline (H4)** — unbounded `findMany` over all active leads + per-lead activity include. At 25k total leads, even if "active" is a fraction, this is a large unpaginated payload + render. **High risk of blowing the budget. (to be measured during live UAT)**
- **Dashboard (H3/§2)** — the by-salesperson `$queryRaw` runs **9 correlated subqueries per agent**; cost grows with agents × leads. ~40 queries/load is already heavy; at scale the correlated subqueries dominate. **At-risk against < 3s. (to be measured during live UAT)**
- **Leads list** — **already paginated (50/page)**, so it scales the best. Its risk is the **filter/sort columns lacking indexes** (next section), which turns `WHERE`/`ORDER BY` into table scans as the table grows.
- **Lead detail** — single-lead, so it scales fine on row count; its risk is the **serialized round-trips (H2)**, which are constant-but-additive regardless of dataset size.

### Index gaps that turn into scans at 25k (from `prisma/schema.prisma`)
- **`Lead.followupDate`** — **no index**, yet it's the filter for the default leads view ("today's follow-ups") and the follow-up count tiles. **Add an index.**
- **`Lead.lastTouchedAt`** — **no index**, yet it's used for ordering candidate pools (e.g. `leadsForProject.ts` `orderBy: { lastTouchedAt: "desc" }`). **Add an index.**
- **No composite `(forwardedTeam, status)`** — `bestLeadsForProject` filters on `forwardedTeam` + `status IN (...)` + `budgetMin` range. A composite index here directly attacks H1's per-project `lead.findMany`.
- Present today: `Lead` has `@@index` on `status`, `source`, `ownerId`, `createdAt`, `eoiStage`; `Activity` on `leadId`, `scheduledAt`, `status`, `(type, completedAt)`; `CallLog` on `leadId`, `userId`, `startedAt`. Good coverage — the gaps above are the notable holes.

---

## 6. Recommendations (file-cited, prioritized)

### P0 — do before scaling the dataset
1. **Add the missing indexes** in `prisma/schema.prisma`: `@@index([followupDate])`, `@@index([lastTouchedAt])`, and a composite `@@index([forwardedTeam, status])` on `Lead`. These directly de-risk the leads default view, the candidate-pool ordering, and the Properties N+1's inner query. *(Schema change — out of scope for this review to apply; flagged for the dev.)*
2. **Paginate the pipeline** (`pipeline/page.tsx`) or cap/virtualize per column. An unbounded `findMany` over all active leads is the clearest scale cliff.

### P1 — meaningful latency wins
3. **Fix the Properties N+1** (`properties/page.tsx` + `leadsForProject.ts`). Options: (a) batch the per-project candidate lookups into one query over all unit IDs and group in memory; (b) lazy-load each project's "matching leads" only when the row is expanded (client fetch on demand) so the page paints without 3N queries. Either removes ~3× the project count in DB hits.
4. **Parallelize lead detail** (`leads/[id]/page.tsx` ~lines 120–166). Move `findMatchingLeads`, `bestUnitsForLead`, and `getTravelRatePerKmInr` **into the existing `Promise.all`** (or a second one) instead of awaiting them in sequence. Pure latency win on the < 2s target, no logic change.
5. **Move `runReconciler()` off the request path.** It already runs in two existing cron endpoints' spirit; invoking it inline on dashboard/leads/lead-detail makes a random user pay for SLA writes and makes correctness depend on page traffic. Drive it from a scheduled cron instead. **Mind the Vercel Hobby limit (per `AGENTS.md`): max 2 daily `vercel.json` crons — anything sub-daily must go in `.github/workflows/cron.yml` hitting `/api/cron/*`.** Removing it from page loads also removes a variable, sometimes-large write burst from interactive latency.

### P2 — perceived performance & resilience
6. **Add `loading.tsx` to the high-traffic routes that lack it** — at minimum `properties`, `pipeline`, the `reports/*` set, and the busiest `admin/*` pages. Cheapest way to make force-dynamic pages *feel* fast on mobile data.
7. **Add a global `app/error.tsx` and a `not-found.tsx`.** Today only `leads/[id]` has an error boundary; everything else has no graceful failure UI.
8. **Trim the dashboard query count.** The by-salesperson `$queryRaw` (9 correlated subqueries/agent) is the heaviest single piece; consider a single aggregate/grouped query, or render that table lazily/on a separate tab so the first paint isn't blocked by it.

### P3 — investigate during UAT
9. **Real measurements.** Capture production Web Vitals (TTFB/LCP) per route and a Neon slow-query log under realistic data. Everything latency-numeric in this report is **(to be measured during live UAT)**; the query-count and index findings are not.
10. **Console/network hygiene** — verify no noisy client logging or redundant client fetches in production builds. **(to be measured during live UAT)**

---

## 7. Summary

The app's performance profile is defined by one decision — **everything is `force-dynamic`**, so every page is a live DB round-trip to Singapore with **no caching cushion**. Within that model the code is mostly reasonable, and the **leads list is already paginated (50/page)**, which is the right instinct.

The concrete risks, in order: the **Properties N+1 (`1 + 3N`)**, the **unpaginated pipeline**, the **serialized round-trips on lead detail**, the **inline `runReconciler()` on page loads**, and the **~40-query dashboard**. The two structural gaps that bite hardest at 25k leads are **missing `followupDate` / `lastTouchedAt` indexes** and the lack of `loading.tsx`/`error.tsx` across ~50 routes. None require rethinking the architecture — they're indexes, pagination, parallelizing three awaits, moving one background job to cron, and adding loading skeletons. All latency figures here are **source-based estimates to be confirmed during live UAT**; the query counts, N+1 shape, and index gaps are read straight from source.
