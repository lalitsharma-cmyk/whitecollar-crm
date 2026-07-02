# Deployment

> How the CRM is deployed to production, the hosting constraints that shape it, and
> the safety gates every deploy passes through. Production URL:
> **https://crm.whitecollarrealty.com**

## Stack

- **Framework:** Next.js 16 (App Router), React 19.
- **Database:** PostgreSQL on **Neon** (Singapore, `ap-southeast-1`), via Prisma.
- **Hosting:** **Vercel Hobby** (free) plan, region `sin1`.

## The Hobby-plan constraints (do not violate)

Vercel's Hobby plan has hard limits. **Breaking them makes Vercel silently drop the
entire deployment** — no error in the dashboard. This cost 18+ hours once. See
[`../AGENTS.md`](../AGENTS.md).

- **Max 2 cron jobs** in `vercel.json` (currently 2: morning + evening reminders).
- All Vercel crons must be **daily or less frequent** (no `*/N` schedules).
- Everything sub-daily lives in **GitHub Actions** (`.github/workflows/cron.yml`)
  or the **`/api/cron/warm` heartbeat** instead. See [CRON_JOBS.md](./CRON_JOBS.md).

**Migrations are NOT run at build time.** The build command is:

```
prisma generate && next build
```

Note the absence of `prisma migrate deploy`. This is deliberate — schema changes are
applied to the Neon database **manually, before** the code that needs them ships, so
a migration can never lock the live DB during a build or ship silently. See
[RECOVERY_AND_BACKUP.md](./RECOVERY_AND_BACKUP.md) and the memory note
`project-wcr-prod-schema-drift.md` (prod schema can silently lag `schema.prisma` —
smoke-test enum/table writes against prod after a schema change).

## How to deploy

Deploys are triggered by a **Vercel Deploy Hook** (a direct URL), not the GitHub
webhook — the webhook historically dropped commits from the git author email. The
hook URL is a secret stored in `.env` as `VERCEL_DEPLOY_HOOK_URL` (never committed).

```bash
npm run push          # git push origin main + trigger the deploy hook (default: Low risk)
npm run deploy        # just trigger the deploy hook (no push)
```

Risk-classified variants (Production Safety Rule — high-risk deploys need explicit
approval):

```bash
RISK=Medium npm run push
APPROVED=1 RISK=High npm run push
```

## What every deploy does (`scripts/deploy.sh`)

`npm run push` runs `scripts/deploy.sh`, which enforces, in order:

1. **Risk classification** — `RISK=Safe|Low|Medium|High` (default `Low`). `High`
   aborts unless `APPROVED=1`.
2. **Schema-change flag** — if `prisma/schema.prisma` or `prisma/migrations/` changed,
   it warns loudly (reminder: apply + confirm the migration on prod first — no silent
   migrations).
3. **Service-worker cache guard** — if UI files (`src/`/`public/`) changed but
   `public/sw.js` was **not** bumped, it warns. The service worker caches the app
   shell; if its `const CACHE = "wcr-shell-vNN"` version isn't bumped, users keep
   seeing the **old UI** ("fixes not visible"). **Bump the cache version on every UI
   deploy.**
4. **Regression gate** (aborts on any failure):
   - `tsc --noEmit` — typecheck.
   - `tsx scripts/regression.ts` — read-only data-invariant checks against live prod
     (deleted-lead exclusion, source migration, import validation, remark
     preservation, report sanity, scoping). Mirror any lib query change into it.
   - `tsx scripts/regression-hr-rbac.ts` — HR authorization/permission-matrix checks
     (never ship an RBAC hole).
5. **Pre-deploy backup** (aborts if it fails) — `tsx scripts/backup.ts` writes a
   read-only gzipped snapshot of every critical table to `backups/pre-deploy-<ts>/`.
6. **Push + trigger deploy** — `git push origin main`, then `curl` the deploy hook.
7. **Deploy log + rollback point** — appends who/when/commit/previous-commit/files/
   backup path to `docs/DEPLOY_LOG.md`, and writes the new SHA to `.last-deploy-sha`.

## Health check (confirm what's live)

After deploying, verify **which commit** is actually live (the webhook has silently
dropped commits before):

```bash
curl https://crm.whitecollarrealty.com/api/health
# → { "ok": true, "commit": "<7-char sha>", "leads": <count>, "ts": "..." }
```

Confirm `commit` matches `git rev-parse --short HEAD`. `/api/health` is public, runs
a real DB query (counts leads), and is the only CLI/cron-visible way to confirm a
live deploy.

## Rolling back

Three paths, fastest first (details in `docs/DEPLOY_SAFETY.md`):

1. **Code, instant (~30s):** Vercel dashboard → Deployments → pick the last good
   build → **Promote to Production**. Best for "the last deploy broke the UI."
2. **Code, git:** `bash scripts/rollback.sh <good-sha>` (targets are in
   `docs/DEPLOY_LOG.md`) — reverts and redeploys through the gate.
3. **Database:** **not** auto-rolled-back with code. Use Neon point-in-time restore
   (whole DB) or selectively re-insert rows from the pre-deploy snapshot. See
   [RECOVERY_AND_BACKUP.md](./RECOVERY_AND_BACKUP.md).

## Environment variables (essentials)

Set in Vercel → Settings → Environment Variables (Production). Full annotated list in
[`../.env.example`](../.env.example); the operational ones:

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Neon Postgres connection (pooled) |
| `NEXTAUTH_SECRET` | Session signing secret (required) |
| `CRON_SECRET` | Bearer token guarding `/api/cron/*` (must match the GitHub Actions secret) |
| `VERCEL_DEPLOY_HOOK_URL` | Deploy-hook URL (in `.env` locally, used by `deploy.sh`) |
| `PUBLIC_BASE_URL` | Base URL the heartbeat/crons call (default `https://crm.whitecollarrealty.com`) |
| `DEVICE_SECURITY_ENFORCE` | `true` to enforce trusted-device binding (see [ADMIN_SETTINGS.md](./ADMIN_SETTINGS.md)) |
| AS Phone / telephony creds | See [TELEPHONY.md](./TELEPHONY.md) / `AS_PHONE_SETUP.md` |
| AI provider keys | See [AI.md](./AI.md) — set only at "Deploy AI" |

> Many runtime behaviours are **not** env vars — they're **settings keys** stored in
> the database (e.g. `ai.enabled`, automation toggles). See
> [ADMIN_SETTINGS.md](./ADMIN_SETTINGS.md).
