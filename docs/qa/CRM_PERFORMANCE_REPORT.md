# White Collar Realty CRM — Performance Report
**Audit target:** commit `64e779c`
**Audit date:** 2026-06-04
**Environment:** Production (Vercel Hobby Plan)
**Database:** Neon Postgres
**Framework:** Next.js 15 App Router, server components

---

## Infrastructure

| Component | Details |
|---|---|
| Hosting | Vercel Hobby (free tier) |
| Database | Neon Postgres (serverless) |
| ORM | Prisma |
| CDN | Vercel Edge Network (automatic) |
| Auth | Custom JWT/session via NextAuth |
| Cron | 2 Vercel cron jobs (daily max) + GitHub Actions for sub-daily |

---

## Vercel Hobby plan constraints

The deployment is on the Hobby (free) plan. Hard limits enforced:
- Maximum 2 cron jobs in `vercel.json` — currently at 2 (no headroom)
- All Vercel crons must be daily or less frequent
- Sub-daily crons are routed through `.github/workflows/cron.yml` hitting the same `/api/cron/*` endpoints

---

## Server-side rendering performance observations

### Database query patterns

**Dashboard page:** Executes a large parallel `Promise.all` block — activity counts, lead counts, call counts, per-agent stats. This is the heaviest page. On Neon serverless, cold-start connections may add 200–500ms to first load after idle periods.

**Pipeline page:** Bounded to `take: 300` leads (comment in code notes this is a forward-looking guard). Currently ~45 active leads so no truncation. At scale, this should be watched.

**Leaderboard page (90 days):** Four parallel groupBy queries over call logs and leads. Window extended to 90 days — if the CallLog table grows significantly, this could slow. Currently fast because the team is small.

**Call Logs page:** `take: PAGE_SIZE` (50) with server-side pagination — correct pattern, no unbounded queries.

**Cold Calls page:** `take: 200` for leads — appropriate bound.

### Attendance auto-mark (BUG-001 fix)
`AttendancePing` fires `POST /api/attendance/mark` as a fire-and-forget fetch (`.catch(() => {})`) on every page load. The endpoint uses `findUnique` then early-return if attendance is already marked for today — idempotent and fast. No performance concern.

### Activity feed date picker (BUG-020 fix)
Historical date lookups are bounded to a single IST day window (`gte: selectedDayStart, lt: selectedDayEnd`) with `take: 100` for call logs and `take: 50` for audit logs. Acceptable.

---

## Cron jobs

| Job | Schedule | Endpoint |
|---|---|---|
| Morning reminder | Daily 9am IST via GitHub Actions | `/api/cron/morning-reminder` |
| Evening reminder | Daily 6pm IST via GitHub Actions | `/api/cron/evening-reminder` |
| Revival sweep | Daily via GitHub Actions | `/api/cron/revival-sweep` |
| Rescore all leads | Daily via GitHub Actions | `/api/cron/rescore-all` |
| DB backup | Daily via Vercel cron | `/api/cron/db-backup` |
| Warm leads | Periodic via GitHub Actions | `/api/cron/warm` |

---

## Performance risks

| Risk | Severity | Mitigation |
|---|---|---|
| Neon cold starts on Hobby plan | Medium | Expected 200–500ms extra on first request after idle. No mitigation on free tier. |
| Dashboard heavy parallel queries | Low-Medium | Currently fast at small scale. Monitor as lead count grows past 500. |
| Vercel Hobby cron limit at max (2/2) | High | Any new daily jobs must go to GitHub Actions. Fully documented in AGENTS.md. |
| 90-day leaderboard query growth | Low | GroupBy is indexed by userId+startedAt. Safe at current scale. |

---

## Recommendations

1. Monitor dashboard load time as the leads database grows past 1,000 records.
2. Add a Neon index on `CallLog.startedAt` + `CallLog.userId` if leaderboard queries slow down.
3. Consider upgrading to Vercel Pro if more than 2 daily cron jobs are needed.
4. The `take: 300` bound on pipeline should be revisited if the team exceeds 200 active leads.
