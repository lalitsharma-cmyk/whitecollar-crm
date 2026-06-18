# Deploy Safety Playbook

**Policy: "Safety First, Features Second."** The CRM is live with real users — data
integrity outranks shipping speed. Every deploy through `npm run push` now:

1. **Regression gate** — `tsc` + read-only data-invariant checks (aborts on failure).
2. **Risk classification** — `RISK=Safe|Low|Medium|High` (default `Low`). **High needs `APPROVED=1`.**
3. **Schema-change flag** — warns if `prisma/` changed (no silent migrations).
4. **Pre-deploy backup** — read-only gzipped snapshot of every critical table → `backups/pre-deploy-<ts>/` (aborts if it fails — never deploy without a snapshot).
5. **Deploy log + rollback point** — appended to `docs/DEPLOY_LOG.md` (who, when, commit, previous-commit, files, backup path).

## Deploying
```bash
npm run push                       # default = Low risk
RISK=Medium npm run push           # mark medium risk
APPROVED=1 RISK=High npm run push  # high-risk, explicitly approved
```
Any change touching **records / schema-with-data / routing / imports** → tell the
owner the **Risk · Impact · Rollback plan · Backup status FIRST and wait for
approval** (Production Safety Rule). Migrations: apply + report before deploying;
schedule heavy/locking ones **after office hours (after 19:00 IST)**.

## Rolling back (3 paths, fastest first)
1. **Code, instant (~30s, no rebuild):** Vercel dashboard → Deployments → pick the
   last good build → **Promote to Production**. Best for "the last deploy broke the UI."
2. **Code, git path:** `bash scripts/rollback.sh <good-sha>` — reverts everything
   since that commit and redeploys through the gate. Targets are in `docs/DEPLOY_LOG.md`.
3. **Database:** the DB is **not** auto-rolled-back with code (data restore is
   destructive). Two options:
   - **Neon point-in-time restore** (primary): Neon console → Branches/Restore →
     restore the branch to a timestamp *before* the bad change. Built-in, covers
     the whole DB.
   - **Selective restore** from the pre-deploy snapshot: `backups/pre-deploy-<ts>/snapshot.json.gz`
     holds leads/activities/notes/assignments/field-history/etc. — gunzip and
     re-insert only the affected rows. Used for "a script overwrote N rows," not a
     full-DB rollback.

## What's protected (never deleted/overwritten by a deploy)
Leads · Remarks (rawRemarks is immutable) · Notes · Activities · Follow-ups ·
Assignments · Projects · Contact info · Status history (LeadFieldHistory) · Audit
history (AuditLog) · Attachments · Notifications · Devices/Sessions · Imports.

## Backups
- Auto pre-deploy snapshot: `backups/pre-deploy-<ts>/` (gitignored — local + PII).
- Manual snapshot any time: `npx tsx scripts/backup.ts`.
- ~0.9 MB gzipped at current data size; keep the last ~20, prune older.
