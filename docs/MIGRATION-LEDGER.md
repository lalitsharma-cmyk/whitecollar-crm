# Migration Ledger — White Collar Realty CRM

This is the canonical record of **how production migrations actually get applied**
on this project, and the reconciliation that closed the ledger on **2026-06-26**.

Read this **before** touching `prisma/schema.prisma` or `prisma/migrations/`.

---

## The one rule that matters

**Production migrations are NEVER auto-applied on deploy.** The Vercel build command is:

```jsonc
// package.json → "scripts"
"build": "prisma generate && next build"
```

It runs `prisma generate` (regenerate the client) and `next build` (compile the app).
It does **not** run `prisma migrate deploy`. There is no `migrate deploy` anywhere in
the deploy path (`scripts/deploy.sh`, `npm run push`, or the Vercel build).

**Consequence:** pushing code that references a new column/table will **not** create
that column/table in production. If the schema change has not been applied to the
Neon database *first*, the deploy ships against a database that is missing the
structure — runtime errors, not a clean failure. **Schema must lead code.**

> This pairs with the Hobby-plan rule in `AGENTS.md` (Vercel silently drops
> deployments that violate plan limits). Neither migrations nor plan compliance is
> enforced by the build — both are manual discipline.

---

## How prod migrations are actually applied (the hand-applied pattern)

Because the build does not migrate, the established, safe pattern on this project is:

1. **Author** the migration in `prisma/migrations/<timestamp>_<name>/migration.sql`
   (and the matching `schema.prisma` change), keeping the SQL **idempotent** —
   `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, additive enum values,
   guard-on-exists for indexes. Idempotency is what makes a re-run or a partial
   prior apply safe.
2. **Apply the raw SQL to Neon by hand** (psql / Neon SQL console), during office
   hours for anything heavy or locking (Production Safety Rule → after 19:00 IST).
3. **Sync Prisma's migration history** so Prisma knows the migration is already in
   the database:
   ```bash
   npx prisma migrate resolve --applied <migration_name>
   ```
   This records the migration in the `_prisma_migrations` table **without** re-running
   its SQL — exactly right when the SQL is already live.
4. **Confirm** with `npx prisma migrate status` → must read
   **"Database schema is up to date!"**
5. **Only then deploy the code** (`npm run push`) that depends on the new structure.

This is why several Buyer-module schema steps note "migration hand-applied to prod
(idempotent, recorded in `_prisma_migrations`)" — `migrate deploy` was deliberately
not used, and in at least one case was blocked by pre-existing DB-only drift, so the
raw-SQL-then-`resolve --applied` path is the standing procedure.

---

## 2026-06-26 reconciliation (ledger closed)

On 2026-06-26 the migration history was reconciled so that Prisma's recorded state
matches the live Neon database exactly. Four migrations that were already present in
the database (their SQL had been hand-applied) were marked applied via
`prisma migrate resolve --applied`:

| Migration directory | Alias | Resolved |
|---|---|---|
| `20260624160000_add_buyer_raw_import` | `add_buyer_raw_import` | `--applied` 2026-06-26 |
| `20260624170000_add_resource_library` | `add_resource_library` | `--applied` 2026-06-26 |
| `20260624200000_smart_timeline_activity_edit` | `smart_timeline_activity_edit` | `--applied` 2026-06-26 |
| `20260624210000_add_activity_action_context` | `add_activity_action_context` | `--applied` 2026-06-26 |

**Result:** `npx prisma migrate status` →
**"Database schema is up to date!"**

The ledger is now clean: every migration in `prisma/migrations/` is recorded as
applied in `_prisma_migrations`, with no pending and no failed entries.

---

## Safe procedure for the NEXT migration

Follow this every time. It is additive-first, backup-gated, and keeps schema ahead
of code.

1. **Design additive.** Prefer new nullable columns / new tables / new enum values.
   Avoid drops, renames, and type-narrowing on populated columns (those are separate,
   owner-approved, after-hours operations with their own backup).
2. **Write idempotent SQL.** `IF NOT EXISTS` / `IF EXISTS` guards so a re-run or a
   partial prior apply is harmless.
3. **Disclose first for data-risky changes.** Per the Production Safety Rule, tell the
   owner **Risk · Impact · Rollback plan · Backup status** and wait for approval
   before anything that touches records, schema-with-data, routing, or imports.
4. **Back up.** A pre-deploy snapshot is taken automatically by `npm run push`; for a
   standalone migration take one explicitly: `npx tsx scripts/backup.ts`. Never apply
   a migration without a current snapshot (and Neon point-in-time restore is the DB-level
   safety net — see `DEPLOY_SAFETY.md`).
5. **Apply the raw SQL to Neon by hand** (psql / Neon console). Schedule heavy/locking
   work after 19:00 IST.
6. **Sync history:** `npx prisma migrate resolve --applied <migration_name>`.
7. **Verify:** `npx prisma migrate status` reads **"Database schema is up to date!"**
8. **Then deploy** the dependent code with `npm run push` and confirm the health
   endpoint commit matches `git rev-parse --short HEAD`.

**Never** rely on the Vercel build to run a migration — it will not, and it never has.
