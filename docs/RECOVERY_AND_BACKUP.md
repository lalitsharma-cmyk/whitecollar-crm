# Recovery & Backup

> Where the data lives, how it's backed up, what can be undone vs what is permanent,
> and how to recover. **The CRM holds live client data — read this before any
> data-risky action.**

## Where the data lives

The entire CRM database is **PostgreSQL on Neon** (Singapore, `ap-southeast-1`). Neon
is a managed Postgres with **point-in-time restore** built in. See memory note
`project-neon-hosting.md` (free tier can pause at the compute-hour cap; the fix is
the Launch tier ~$15-19/mo).

## Three layers of backup

### 1. Daily full backup → Google Drive (primary)

A GitHub Actions workflow (`.github/workflows/db-backup.yml`) runs **daily at 02:30
IST**: it `pg_dump`s the **entire** database, gzips it, and uploads it to Google
Drive via rclone. Retention: **30 daily + 12 monthly** copies. It emails admins
success/failure and POSTs status to `/api/cron/backup-report`.

This is a **true full export** — every table (leads, activities, remarks, HR
candidates & resumes, projects, properties, settings — everything).

Setup (one-time, 3 GitHub secrets) and restore steps are in
[`BACKUP_SETUP.md`](./BACKUP_SETUP.md):
- `BACKUP_DATABASE_URL` — Neon **direct** (not pooled) connection string.
- `GDRIVE_RCLONE_TOKEN` — rclone Google Drive token.
- `GDRIVE_FOLDER_ID` — the `WCR-CRM-Backups` folder id.

> **Caveat:** this workflow runs on **GitHub Actions**, which is currently
> not firing reliably (see [CRON_JOBS.md](./CRON_JOBS.md) §5). Until GitHub Actions is
> re-enabled, **rely on Neon point-in-time restore** (below) as the live safety net,
> and/or run a manual snapshot.

### 2. Pre-deploy snapshot (automatic, every deploy)

Every `npm run push` runs `scripts/backup.ts` **before** deploying — a read-only
gzipped JSON snapshot of the business-critical tables (leads, activities, notes,
assignments, field history, call logs, sticky notes, import batches, devices,
recent notifications + audit) written to `backups/pre-deploy-<timestamp>/`. If the
snapshot fails, the deploy aborts. These files are gitignored (local + PII). ~0.9 MB
gzipped at current size; keep the last ~20.

Run one manually any time: `npx tsx scripts/backup.ts`.

> User rows in these snapshots **never** include password hashes; the nightly
> `/api/cron/db-backup` JSON additionally strips private vault (agent journal) text.

### 3. Neon point-in-time restore (whole-DB, fastest for disasters)

Neon console → Branches / Restore → restore the branch to a timestamp **before** the
bad change. This is the primary path for "something corrupted a lot of rows." Restore
into a fresh branch first to verify, to avoid a destructive overwrite.

## Restore procedures

**From the Google-Drive dump (full DB):**
```bash
gunzip -c wcr-backup-YYYY-MM-DD.sql.gz | psql "YOUR_DATABASE_URL"
```
Restore into a **fresh/empty** database or a new Neon branch to be safe.

**From a pre-deploy snapshot (selective, "a script overwrote N rows"):** gunzip
`backups/pre-deploy-<ts>/snapshot.json.gz` and re-insert only the affected rows. Used
for surgical fixes, not a full rollback.

## The recycle bin — soft delete (reversible)

The CRM does **not** hard-delete records in normal operation. Deleting a lead, buyer,
or similar sets a `deletedAt` timestamp — the row still exists but is hidden from
every list, pool, rollup, dedup check, and "previous history" banner (all scoped
queries filter `deletedAt: null`). Soft-deleted records:

- can be **restored** (clear `deletedAt`);
- are **excluded** from duplicate detection, so re-importing the same person creates
  a fresh record rather than colliding with the deleted one;
- apply to Leads, BuyerRecords, and other core tables (each has its own `deletedAt`).

This is the recycle-bin / import-rollback model — the safe default.

## What is reversible vs permanent

| Action | Reversible? | How |
|---|---|---|
| Delete a lead / buyer (soft delete) | **Yes** | Restore from recycle bin (clear `deletedAt`) |
| Identity link/merge (Customer Identity) | **Yes** | Linking is virtual — records stay separate; unlink to reverse |
| Follow-up rollover / status change | **Yes** (traceable) | Logged in `LeadFieldHistory`; correct manually |
| Bad deploy (code) | **Yes** | Promote previous Vercel build, or `scripts/rollback.sh` |
| Bulk data overwrite by a script | **Yes** (usually) | Neon PITR or pre-deploy snapshot |
| **Hard delete** (raw SQL / `soft_delete` purge) | **No** | Only recoverable from a backup taken before it |

Remarks and conversation history are treated as **immutable source of truth** —
`rawRemarks` is never overwritten by a deploy or an import merge; imports append.

> **Precedent, not permission:** the one-time hard deletes in the history
> (`project-silverglades-purge.md` — 867 mistaken cold leads; test-data cleanups)
> were **explicitly approved, one-off** actions. Hard-delete is never a standing
> permission. Per the Production Safety Rule, any data-risky action requires a
> **backup + risk disclosure + owner approval first**.

## If you need to recover something

1. **Recently deleted a few records?** → Restore from the recycle bin (soft delete).
2. **A change went wrong today but rows still exist?** → Check `LeadFieldHistory` /
   `AuditLog` and correct the fields; nothing is lost.
3. **A script/import damaged many rows?** → Neon point-in-time restore to just before
   it, or selectively re-insert from `backups/pre-deploy-<ts>/`.
4. **Whole-DB disaster?** → Restore the latest Google-Drive `.sql.gz` into a fresh
   Neon branch, verify, then cut over.

Related: [DEPLOYMENT.md](./DEPLOYMENT.md), `docs/DEPLOY_SAFETY.md`,
[`BACKUP_SETUP.md`](./BACKUP_SETUP.md).
