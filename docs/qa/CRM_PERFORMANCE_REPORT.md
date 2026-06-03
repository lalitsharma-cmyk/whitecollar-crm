# White Collar Realty CRM — Performance Report
**Audit Date:** 4 June 2026 | **Environment:** Production (Vercel Hobby Plan)
**Database:** Neon Postgres | **Framework:** Next.js 15 (App Router, server components)

---

## PERFORMANCE OBSERVATIONS

### Dashboard Page Load — High Query Count

The `/dashboard` page.tsx executes **27+ parallel Prisma queries** in a single server component render via `Promise.all`. This is the heaviest page in the application.

**Query breakdown (counted from page.tsx):**
- 24 queries in the main `Promise.all` (lines 123–165)
- 2 queries for upcoming counts (lines 168–171)
- 4 queries for "Today's Mission" (lines 362–395)
- 1 query for attendance
- 1 query for last vault WIN
- 2 queries for weekly metrics (each: 4 sub-queries)
- 1 raw SQL query for the by-salesperson table (1 query replacing 30 that existed before)
- 3–4 queries for the morning queue (admin-only)

**Total: ~36–40 database roundtrips per dashboard load**

With Neon Postgres on the free/hobby tier, connection pooling may not be active. Each query opens a connection. At 44 leads this is fast. At 25,000 leads with indexes in place, the individual queries will still be fast, but the sheer number of concurrent connections may cause Neon to throttle.

**Observed behavior:** Dashboard loads without error or visible latency in current testing (44 leads). No timeout or slow query indicators observed.

**At-scale risk (25,000 leads):** The raw SQL query (spStatsRaw) is well-optimized (replaces 30 sub-queries with 1). But count queries across 25,000 leads without proper WHERE clause indexes could be slow. Key indexes present: status, ownerId, createdAt, forwardedTeam — these cover the most common filters.

---

### Leads List — Pagination Gap

The `/leads` page currently loads all 44 leads in a single query. There is no virtual scrolling or cursor-based pagination visible in the accessibility tree.

**Current behavior:** "Showing 1–44 of 44 · Page 1 of 1" — all records returned in one request.

**At-scale risk:** Loading 25,000 leads into a single HTML page would:
1. Cause browser memory issues (browsers struggle with DOM trees of 25,000+ nodes)
2. Generate 25,000+ rows × 3 interactive buttons each = 75,000+ DOM elements
3. Create a very large HTML payload sent over the wire

**Assessment:** This must be fixed before importing large volumes of leads. The fix is standard offset/cursor pagination with a page size of 50–100 records.

---

### Properties Page — DOM Size Issue

The `/properties` page returned over 65,000 characters in its accessibility tree at depth 1, suggesting the property catalog renders a very large number of items without pagination.

**Assessment:** Same risk as leads — needs pagination before catalog grows.

---

### Server-Side Rendering Pattern

The CRM uses `export const dynamic = "force-dynamic"` on the dashboard page, disabling Next.js page caching entirely. Every page load fetches fresh data from Postgres.

This is correct for a real-time sales operations tool but means:
- No ISR (Incremental Static Regeneration)
- No edge caching
- Every user session hits the database directly

On Vercel Hobby with Neon Postgres, this is acceptable for the current 4-agent team. Scaling to 20+ simultaneous users may require upgrading to Vercel Pro for better serverless function concurrency limits.

---

### API Endpoints — Known Patterns

The reports pages reference:
- `/api/reports/export?type=leads` — CSV export
- `/api/reports/export?type=calls` — CSV export
- `/api/call-logs/export` — Activity feed export

These are likely streaming or buffered responses. At 25,000 leads, CSV export will be a heavy operation. No streaming indication was found in this audit.

---

### Bundle Size Observations

- The desktop sidebar imports 15+ Lucide icons, multiple custom components (WhatsAppPanel, ThemeToggle, GlobalDateFilter, NotifBell, AccentPainter, FestiveBanner, QuickSearch, QuickAddLeadFab, KeyboardShortcutsHelp, XPToastHost, DealCelebrationHost, OnboardingTour, PWAInstallNudge)
- The MobileShell.tsx is a "use client" component — all of the above imports are part of the client bundle for every page
- No code splitting or lazy loading visible for these shell components (they are always rendered)

**Assessment:** Bundle size is not measurable from accessibility testing. On a modern phone with a good connection this is acceptable. On 4G/low-bandwidth connections in India, a large initial JS bundle will cause perceived slowness.

---

### Database Indexes (from schema.prisma)

Present indexes confirm the team has thought about query performance:
```
Lead: status, source, ownerId, createdAt, eoiStage, forwardedTeam
Activity: leadId, scheduledAt, status, type+completedAt
CallLog: leadId, userId, startedAt
Notification: userId+readAt, createdAt
```

**Missing indexes to consider for scale:**
- `Lead.followupDate` — used heavily in overdue/upcoming queries
- `Lead.isColdCall + lastTouchedAt` — used in cold revival queries
- `Lead.aiScore` — used in hot lead queries
- `Lead.needsManagerReview` — used in action list

---

### Vercel Hobby Plan Constraints (from AGENTS.md)

- Max 2 cron jobs (currently 2 used)
- Daily-or-less cron frequency for Vercel crons
- Sub-daily crons use GitHub Actions instead
- **Serverless function timeout:** Hobby plan has 10-second timeout. The dashboard's 36–40 queries need to complete within 10 seconds. Currently they do at 44 leads. At 25,000 leads with slow queries, this could time out.

---

### Console Errors

No console errors were captured. The console tracking tool noted that tracking starts only when first called — errors during page load may not have been captured.

---

## PERFORMANCE RECOMMENDATIONS

### Immediate (before scaling)
1. **Add pagination to /leads** — implement cursor-based pagination with 50 records per page. Add "Load more" or page number navigation.
2. **Add missing Lead indexes** — `followupDate`, `isColdCall`, `aiScore`, `needsManagerReview`
3. **Cache dashboard KPI counts** — consider 1-minute Redis/KV cache for counts that don't need second-by-second accuracy (Total Clients, Total Not Contacted, etc.)

### Before 25,000 leads
4. **Upgrade Vercel plan** — Vercel Pro increases serverless timeout to 60s and adds better cold-start performance
5. **Add Neon connection pooling** — enable pgBouncer or Prisma Accelerate for Neon to avoid connection exhaustion under concurrent load
6. **Implement streaming for CSV exports** — `/api/reports/export` should use chunked/streaming response for large datasets
7. **Lazy-load dashboard sections** — load the by-salesperson table and weekly metrics via client-side fetching (SWR/React Query) after initial page render

### Monitoring
8. **Add Vercel Analytics or Sentry** — currently no performance monitoring is visible in this audit
9. **Log slow queries** — add Prisma query logging for queries > 500ms in production

---

## SCALABILITY ASSESSMENT

| Metric | Current (44 leads) | Risk at 25,000 leads |
|--------|-------------------|----------------------|
| Dashboard load | Fast | MEDIUM risk (query count) |
| Leads list load | Fast | HIGH risk (no pagination) |
| Properties catalog | Slow to read | HIGH risk (no pagination) |
| Pipeline kanban | Fast | MEDIUM risk (all leads in DOM) |
| Reports | Fast | MEDIUM risk (funnel counts) |
| CSV export | Not tested | HIGH risk (memory/timeout) |
| Notification queries | N/A (test mode) | LOW risk (indexed) |
| Cold calls | Empty | LOW risk (filtered query) |
