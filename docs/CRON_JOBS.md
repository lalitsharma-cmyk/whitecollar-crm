# Scheduled Jobs (Crons)

> Automated background jobs — daily digests, meeting reminders, follow-up
> rollover, cleanups, backups. This explains what runs, when, and the current
> "GitHub Actions is dead" situation. For a non-technical reader: **Section 1
> and Section 5** are the important parts.

## 1. The short version (for Lalit)

The CRM runs about two dozen small automated jobs on a timer. They are driven by
**three** independent schedulers, on purpose, because our hosting plan is limited:

1. **Vercel** runs exactly **2** daily jobs (the morning + evening reminders).
   Our plan (Vercel Hobby) will silently break the whole site if we add more than
   2, so we can't put everything here.
2. **GitHub Actions** was supposed to run *everything else* (all the every-5-minute
   and once-a-day jobs). **As of 2 July 2026 it stopped firing** — see Section 5.
3. **A "heartbeat" pinger** hits one public URL (`/api/cron/warm`) every ~2 minutes.
   We piggy-backed the most important jobs onto it so they keep working even while
   GitHub Actions is down. This is why meeting reminders and follow-up rollover
   still run today.

**What Lalit should check:** GitHub → repo → **Actions** tab (is the "External
crons" workflow enabled? are runs failing?) and **Settings → Secrets → `CRON_SECRET`**
(must equal the `CRON_SECRET` in Vercel). You can see whether each job actually ran
today at **Admin → Cron Health** (`/admin/cron-health`).

## 2. The 2 Vercel crons

Defined in [`vercel.json`](../vercel.json) (this is the entire list — the hard cap):

| Endpoint | Schedule (UTC) | IST time | What it does |
|---|---|---|---|
| `/api/cron/morning-reminder` | `30 4 * * *` | 10:00 daily | Per-agent morning digest (today's follow-ups, hot leads, overnight leads, callbacks) + sales quote; also emails manager reports and resyncs the project list |
| `/api/cron/evening-reminder` | `30 12 * * *` | 18:00 daily | Per-agent end-of-day nudge (missed follow-ups, un-called hot leads) + a team summary to Admin/Manager |

`vercel.json` also pins the region to `sin1` (Singapore, nearest to the Neon DB).

> **Hobby-plan rule (do not violate):** max 2 crons, each daily-or-less-frequent.
> A 3rd cron or a sub-daily schedule makes Vercel **silently drop the entire
> deployment** (no error shown). See [`../AGENTS.md`](../AGENTS.md) and
> [DEPLOYMENT.md](./DEPLOYMENT.md).

## 3. The heartbeat dispatcher (`/api/cron/warm`)

File: [`src/app/api/cron/warm/route.ts`](../src/app/api/cron/warm/route.ts).

**Origin:** `/api/cron/warm` was created to keep the Neon database connection
"warm" (the free tier scales to zero when idle). An external uptime pinger
(UptimeRobot / cron-job.org) hits it every ~2 minutes and it runs a trivial
`SELECT NOW()`. It is **public — no authentication** (it exposes nothing and
mutates nothing directly).

**Upgrade (2026-07-02):** because the GitHub-Actions schedule died, `warm` was
turned into a **heartbeat dispatcher**. On each ~2-min tick it fires **at most ONE
due job**, throttled by that job's last run time so a public endpoint can never
spam. Only **idempotent, notification-only** jobs are auto-run here; jobs that
*send* (drip WhatsApp/email) or *move data* (buyer distribution) are deliberately
excluded. When it dispatches, it calls the target with `Authorization: Bearer
${CRON_SECRET}` against `PUBLIC_BASE_URL` (default `https://crm.whitecollarrealty.com`).

Each tick checks **daily-backup jobs first** (they self-skip after one run/day),
then the sub-daily jobs.

### `HEARTBEAT_JOBS` — sub-daily, throttled by `everyMin`

| Job name | Endpoint | Every | Purpose |
|---|---|---|---|
| `pre-meeting-reminder` | `/api/cron/pre-meeting-reminder` | 5 min | 30-min + 1-hr meeting/site-visit reminders; 10-min lead callbacks |
| `unassigned-escalation` | `/api/cron/unassigned-reminders` | 5 min | Escalate still-unowned inbound leads to admins at 15/30/60 min |
| `site-visit-watch` | `/api/cron/site-visit-watch` | 15 min | Nudge agents who left a site-visit/meeting status open too long |
| `data-quality` | `/api/cron/data-quality` | 720 min (~2×/day) | Data-quality scan — detect + notify only, never mutates |
| `re-engage` | `/api/cron/re-engage` | 360 min (~6h) | Reactivate leads whose scheduled re-engage date arrived |
| `telephony-retry` | `/api/cron/telephony-retry` | 5 min | Drain failed webhook/dial retry queue; no-op when empty |
| `telephony-sync` | `/api/cron/telephony-sync` | 30 min | Reconcile calls where a webhook was missed; no-op when unconfigured |

### `DAILY_BACKUP_JOBS` — once/day, only after the IST hour AND only if not already run today

| Job name | Endpoint | After IST hour | Purpose |
|---|---|---|---|
| `morning-reminder` | `/api/cron/morning-reminder` | 10:00 | Backup for the Vercel morning cron (Vercel Hobby crons are best-effort) |
| `evening-reminder` | `/api/cron/evening-reminder` | 18:00 | Backup for the Vercel evening cron |
| `followup-rollover` | `/api/cron/followup-rollover` | 23:00 | **Primary trigger** (no free Vercel slot): rolls today's still-open follow-ups to tomorrow, late enough not to bump ones agents are still working |

The daily-backup jobs use `cronRanTodayIST(name)` so if Vercel already fired that
day's morning/evening reminder, the heartbeat run is a no-op — nobody is
double-notified.

## 4. Every cron endpoint (reference)

All routes live under `src/app/api/cron/`. Each writes a `CronRun` row (via
[`src/lib/cronRun.ts`](../src/lib/cronRun.ts)) so **Admin → Cron Health** can show
whether it ran and succeeded.

**Authentication (uniform):** every endpoint requires
`Authorization: Bearer ${CRON_SECRET}` and returns `401` otherwise. The env var is
**`CRON_SECRET`** (must be set identically in Vercel Production env *and* as a
GitHub Actions repo secret). Two exceptions:

- **`warm`** — no auth (public heartbeat).
- **`db-backup`** — fails **closed**: if `CRON_SECRET` is unset it refuses (the
  others skip the check when the secret is unset, for local dev).

| Endpoint | Purpose |
|---|---|
| `morning-reminder` | 10:00 IST per-agent digest + manager email reports + project resync |
| `evening-reminder` | 18:00 IST per-agent EOD nudge + team summary |
| `pre-meeting-reminder` | 30-min & 1-hr meeting reminders (1-hr also to Lalit) + 10-min callbacks; deduped per activity/lead |
| `unassigned-reminders` | Default = 15/30/60-min unassigned-lead escalation; `?summary=1` = one EOD "N still unassigned" digest |
| `followup-rollover` | Roll pending overdue follow-ups → next day (never touches remarks; logs each move); `?dryRun=1` previews |
| `workflows` | Drip-campaign dispatcher — runs due `WorkflowRun`s. **Sends WhatsApp/email** |
| `site-visit-watch` | Nudge agents with an over-long open site-visit/meeting status (2h/4h → 6h Requires-Review + manager) |
| `data-quality` | Data-quality scan — detect + notify only |
| `re-engage` | Reactivate leads whose re-engage date arrived (reassign to owner-at-reject / Lalit, notify) |
| `telephony-retry` | Drain `CallSyncTask` retry queue (exp-backoff); no-op when empty |
| `telephony-sync` | Reconcile provider calls with missed webhooks; no-op when telephony unconfigured |
| `rescore-all` | Nightly behavioural AI re-score of every open lead (currently moot — AI paused) |
| `revival-sweep` | Daily: cold-but-previously-hot leads with a fresh signal → bumped to warm + owner pinged |
| `hr-auto-join` | Daily: flip HR candidates `EXPECTED_JOINING → JOINED` on their joining date; `?dryRun=1` previews |
| `weekly-digest` | Sunday night: 7-day leaderboard + team totals emailed to Admins/Managers |
| `cleanup` | Daily housekeeping — deletes only read Notifications >10d, any >90d, CronRun >30d; `?dryRun=1` previews |
| `buyer-distribute` | Daily round-robin of the ADMIN_POOL buyer bank — **only when the admin toggle is ON** (idempotent no-op otherwise); `?dryRun=1` previews |
| `lunch-reminder` | `?phase=start` (14:00 IST) / `?phase=ending` (14:25 IST) lunch notifications |
| `db-backup` | Emit one JSON snapshot of critical tables (strips passwords + private vault text); GitHub Actions saves it as an artifact |
| `backup-report` | **POST** — receives the Drive-backup success/failure status → notifies Admins (in-app + email) |
| `sync-projects` | Sync the project catalogue from the marketing site (also called from `morning-reminder`) |
| `warm` | Keep Neon warm (`SELECT NOW()`) **+** the heartbeat dispatcher (Section 3) |

### GitHub Actions schedule (`.github/workflows/cron.yml`)

The "External crons" workflow curls the endpoints above with the bearer secret.
Its schedule (**currently not firing — Section 5**):

| Cron (UTC) | IST | Endpoint(s) |
|---|---|---|
| `*/5 * * * *` | every 5 min | `/workflows`, `/pre-meeting-reminder`, `/unassigned-reminders` |
| `0 3 * * *` | 08:30 | `/rescore-all` |
| `0 4 * * *` | 09:30 | `/revival-sweep`, `/hr-auto-join` |
| `0 14 * * 0` | Sun 19:30 | `/weekly-digest` |
| `30 14 * * *` | 20:00 | `/unassigned-reminders?summary=1` |
| `30 21 * * *` | 03:00 | `/cleanup` |
| `0 18 * * *` | 23:30 | `/followup-rollover` (backup path; heartbeat is primary) |
| `0 22 * * *` | 03:30 | `/db-backup` → uploaded as a workflow artifact (90-day retention) |
| `30 8 * * *` / `55 8 * * *` | 14:00 / 14:25 | `/lunch-reminder?phase=start` / `?phase=ending` |
| `30 6 * * *` | 12:00 | `/buyer-distribute` |

A **second, separate** workflow — `.github/workflows/db-backup.yml` ("Database
backup → Google Drive", `0 21 * * *` = 02:30 IST) — `pg_dump`s the whole Neon DB,
gzips it, and rclone-uploads it to Google Drive (30 daily + 12 monthly). See
[RECOVERY_AND_BACKUP.md](./RECOVERY_AND_BACKUP.md).

> `site-visit-watch`, `data-quality`, `re-engage`, `telephony-retry`,
> `telephony-sync`, and `sync-projects` are **not** in any GitHub Actions
> workflow — they run only via the `warm` heartbeat (or, for `sync-projects`,
> inside `morning-reminder`).

## 5. The outage — "GitHub Actions crons are dead" (2026-07-02)

Source: memory note `project-cron-outage-jul2.md`.

**What happened:** the entire `.github/workflows/cron.yml` schedule **stopped
firing** — zero `CronRun` rows in 7 days for every GitHub-scheduled job. The only
jobs still logging runs were the **2 Vercel crons** and **`warm`** (hit by the
external pinger). Because `warm` works, the endpoints themselves are healthy — it
is specifically **GitHub Actions scheduling** that stopped.

**Jobs that went dark (~6 days):** follow-up rollover, meeting/callback reminders,
unassigned escalation + 8 PM summary, drip workflows, nightly rescore, revival
sweep, HR auto-join, lunch reminders, weekly digest, buyer distribution, cleanup,
DB backup, backup report, project sync.

**Suspected causes (unverified from the code side):** GitHub auto-disabled the
scheduled workflow (its 60-day-inactivity rule — common), the workflow was
manually disabled, Actions is disabled/out of minutes for the repo, or the
GitHub `CRON_SECRET` secret no longer matches the Vercel env value.

**What was already mitigated (2026-07-02 → 07-03):**

- The **`warm` heartbeat dispatcher** now carries the agent-critical, idempotent,
  notification-only jobs off the reliable ~2-min ping (meeting reminders,
  unassigned escalation, site-visit watch, data-quality, re-engage, telephony
  retry/sync) plus daily backups of morning/evening/rollover.
- **`followup-rollover`** was moved onto the heartbeat as its **primary** trigger
  and shifted to **~23:00 IST** (it previously ran from `evening-reminder` at
  18:00, which bumped follow-ups agents were still working). Lalit's decision was
  to **keep and fix** the rollover, not retire it.

**Still dead / not portable to the heartbeat** (they *send* or *mutate*, or need
the GitHub runner) — these need GitHub Actions re-enabled, or explicit approval to
auto-run: `workflows`, `buyer-distribute`, `revival-sweep`, `rescore-all`,
`hr-auto-join`, `lunch-reminder`, `weekly-digest`, `cleanup`, `db-backup`,
`backup-report`, `sync-projects`, the 8 PM `unassigned-summary`.

**Fix options (fastest first):**
1. **Re-enable GitHub Actions** (do this first — if it's just a toggle it restores
   all 14 jobs at once, and it diagnoses the root cause).
2. **Fan more daily jobs out from the 2 Vercel crons** (durable, no GitHub
   dependency — the same pattern the heartbeat already uses).
3. **External scheduler** (cron-job.org / the uptime pinger) hitting the endpoints
   with the bearer secret.

> **Stale-doc finding:** the memory note `project-followup-policy.md` still says
> rollover runs "from evening-reminder at 18:00 IST." The current code runs it from
> the `warm` heartbeat at ~23:00 IST. The code is authoritative.
