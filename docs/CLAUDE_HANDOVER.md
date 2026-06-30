# CLAUDE_HANDOVER — White Collar Realty Sales CRM

> Portable handover so you can move development to a new laptop and continue safely.
> **Claude Code chat history and Claude's local memory do NOT transfer between laptops** —
> this file is the durable substitute. Last updated: 2026‑06‑30.

---

## 0. The one‑paragraph summary

This is the **live, production Sales CRM** for White Collar Realty (Dubai property investment).
It is a **Next.js 16 + Prisma 6.19.3 + Neon Postgres** app deployed on **Vercel** at
**https://crm.whitecollarrealty.com**. Real teams use it daily, so **data safety beats features**.
All code lives in GitHub; the database and secrets live in the cloud (Neon + Vercel). Moving laptops
= clone the repo + copy the `.env` file + `npm install`. Nothing about the data or production changes.

---

## 1. Repository

- **GitHub:** `https://github.com/lalitsharma-cmyk/whitecollar-crm`
- **Working branch:** `main` (this is also the deploy branch — pushing/deploying `main` is production).
- **Local path on the old laptop:** `C:\Users\Lenovo\whitecollar-crm`
- As of this writing `main` is fully pushed (local == origin). The production code is 100% on GitHub.

### Branches preserved to GitHub for the migration (were local‑only)
These would have been lost on a fresh clone, so they were pushed on 2026‑06‑30. They are **parked /
review‑only** — do NOT merge without review:
- `feat/customer-layer-foundation` — Customer‑360 foundation (parked, never deployed).
- `recovered/stash-0-device-security-wip` — leftover device‑security WIP (device security already shipped; likely superseded).
- `recovered/stash-1-buyer-classification-wip` — early buyer‑classification WIP (buyer classification already shipped).
- `recovered/stash-2-war-fear-reclass` — out‑of‑scope status reclassification, never deployed.
- `recovered/stash-3-terminal-followup` — out‑of‑scope follow‑up cleanup, contradicts the shipped Revisit approach.

---

## 2. Tech stack & key facts

- **Next.js 16** App Router (this is NOT the Next.js most models know — read `AGENTS.md` first; it has breaking changes).
- **Prisma 6.19.3** → **Neon Postgres** (PG17, region ap‑southeast‑1).
- **Auth:** custom session (`UserSession` table + `wcr_session` cookie) + bcryptjs. NextAuth is a dependency but the live auth is the custom one in `src/lib/auth.ts`.
- **PWA:** `public/sw.js` — bump the `CACHE = "wcr-shell-vNN"` version on every UI deploy or phones serve a stale shell.
- **Hosting limits:** Vercel **Hobby** plan — max 2 cron jobs in `vercel.json`, all crons daily‑or‑less; sub‑daily crons live in `.github/workflows/cron.yml`. Violating this makes Vercel silently drop the whole deploy.

---

## 3. Current CRM status (2026‑06‑30)

- **Production:** LIVE and healthy at https://crm.whitecollarrealty.com.
- **Regression suite:** 110 invariants, all green (run `npm run regression`).
- **Data:** ~693 leads, 12 users, real sales + HR data. The HR candidate data (447 rows) is **real applicants** — never bulk‑delete.
- A **second Claude Code session** has been running in this same repo (HR candidate‑module work). If both laptops/sessions are ever active at once they share the same `main` — always `git pull` before working and push small, frequently.

---

## 4. Latest completed work (most recent first)

Shipped & live today (2026‑06‑30):
- **Live Lead Assignment + Agent‑Performance reports use CURRENT owner** (not assignment history) — a reassigned lead (e.g. Akanksha Chugh, Raushan Prasad) now counts under the new owner only, and the widget labels say "current owner (live)". `src/lib/agentPerformance.ts`, `DashboardAssignmentWidget.tsx`.
- **"Needs Lalit" manager‑escalation** (replaced viewer‑name "Needs Sameer"): clickable dashboard drill + `POST /api/leads/[id]/manager-resolve` + Mark‑resolved button; escalations route to sales managers, not data‑admin Sameer.
- **Instant snooze** — no mandatory reason; auto‑logs to timeline.
- **Mobile Lead Search** — search button added to the mobile header (palette was Ctrl+K‑only).
- **Conversation‑history CALL remarks editable** (agent own+today / admin any) + audit.
- **Website→CRM 30‑day audit** (read‑only): website leads ARE landing (~62–93/30d, steady) — "low leads" is a traffic/funnel problem, not a CRM‑integration failure.

Earlier major modules (all in `main`): Buyer Data module + lifecycle, HR Recruitment/ATS, Revival Engine, device security, voice subsystem, notifications (web push), Gallery/Resource library, reporting unification. See `docs/RELEASES.md` and Git history.

---

## 5. Pending / next up

**Approved by Lalit, scoped but NOT yet built** (investigations done; build next):
1. **WS‑F — LeadIntakeLog**: add a `LeadIntakeLog` table (mirror `HRIntakeLog`) + wire into `src/app/api/intake/lead/route.ts` so every website‑lead intake attempt + drop is recorded. **Needs an additive prod migration** (see §8). Approved.
2. **WS‑G — Phone masking**: agents see full phone only for OWN leads; masked elsewhere; admins/managers always full. Add `maskPhone()`/`canSeeFullPhone()` helpers. Only 2 real server‑side leaks today: the `/calls` page + `/api/call-logs/export` (scoped by caller, not owner); the rest is already owner‑scoped. Also un‑masks the owner on the lead‑detail page (currently over‑masks).
3. **WS‑H — Download/export audit**: add `audit()` to the 4 un‑audited export routes — `hr/candidates/export`, `call-logs/export`, `hr/candidates/[id]/resume`, public `resources/[id]/file`. No schema change (AuditLog.meta holds it).
4. **WS‑I — Inactivity auto‑logout**: configurable idle timeout (Setting `security.inactivityTimeoutMin`, default ~30m) → warn then `POST /api/logout`. Mount an `IdleLogoutWatcher` in BOTH `MobileShell.tsx` and `HRShell.tsx`; also enforce server‑side in `getCurrentUser` via `UserSession.lastActiveAt`; super‑admins exempt.

**Other open items:**
- `#253` — 2 product decisions (mostly resolved).
- **Website (CodeIgniter, separate repo) manual deploys pending**: admin lead‑menu removal + admin RBAC gate files are edited locally at `D:\backup-m3mdeveloper.in-5-18-2026\whitecollarrealty.com` but must be hand‑uploaded to the host + Cloudflare purge.
- Real‑device confirmation (iPhone/Android PWA) of responsive + login fixes — owner task.

---

## 6. Deployment status & how to deploy

- **Deploy = `npm run push`** (from the repo root). It runs `git push origin main` then `scripts/deploy.sh`, which: takes a **pre‑deploy DB backup**, runs **`tsc` + `scripts/regression.ts` + `scripts/regression-hr-rbac.ts`** (aborts on any failure), then triggers the **Vercel deploy hook**.
- **The Vercel build does NOT run DB migrations.** Schema changes must be applied to Neon by hand FIRST (see §8).
- **Verify a deploy:** `curl https://crm.whitecollarrealty.com/api/health` → the `commit` field must equal `git rev-parse --short HEAD`.
- Each deploy writes a rollback point to `docs/DEPLOY_LOG.md` (this file is git‑ignored / machine‑local).

---

## 7. Environment variables needed (`.env` at repo root)

`.env` is **git‑ignored** — it does NOT travel with the clone. Copy the file directly from the old
laptop, or recreate the values from the **Vercel project → Settings → Environment Variables**.
There is a `.env.example` in the repo documenting the shape. The 14 variables:

| Variable | What it is | Where to get it |
|---|---|---|
| `DATABASE_URL` | Neon Postgres connection string | Neon dashboard / Vercel env |
| `NEXTAUTH_SECRET` | session signing secret | copy existing (don't regenerate or it logs everyone out) |
| `NEXTAUTH_URL` | base URL (`https://crm.whitecollarrealty.com`) | known |
| `CRON_SECRET` | bearer token for GitHub‑Actions crons | copy existing |
| `INTAKE_SECRET` | secret for the website→CRM intake | copy existing |
| `ANTHROPIC_API_KEY` | AI features | copy existing |
| `RESEND_API_KEY` / `RESEND_FROM` | transactional email | copy existing |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_SUBJECT` | Web Push keys | copy existing (regenerating breaks all push subscriptions) |
| `WHATSAPP_VERIFY_TOKEN` | Meta webhook verify token | copy existing |
| `VERCEL_DEPLOY_HOOK_URL` | the deploy hook `npm run push` calls | Vercel → Settings → Git → Deploy Hooks |

> ⚠️ Keep `NEXTAUTH_SECRET` and the `VAPID_*` keys **identical** to the old laptop / Vercel —
> changing them invalidates all sessions / push subscriptions. Easiest + safest: copy the whole `.env` file.

---

## 8. Commands

### Set up on the NEW laptop (one‑time)
```bash
# 1. Clone
git clone https://github.com/lalitsharma-cmyk/whitecollar-crm.git
cd whitecollar-crm

# 2. Put the .env file in the repo root (copy from old laptop or recreate from Vercel — see §7)

# 3. Install (Node 20+; uses package-lock.json)
npm install            # postinstall runs `prisma generate` automatically

# 4. Sanity-check the schema vs the live DB (read-only)
npx prisma migrate status     # should say "Database schema is up to date!"
```

### Day‑to‑day
```bash
npm run dev            # local dev server (http://localhost:3000) — talks to the LIVE Neon DB, so be careful
npm run build          # prisma generate + next build (what Vercel runs)
npm run regression     # the 110 read-only invariants against prod (safe; zero writes)
npx tsc --noEmit -p tsconfig.json   # typecheck
npm run push           # DEPLOY to production (gate + backup + Vercel hook) — only when you mean it
```
> **Note:** `npm run dev` / `npm run regression` connect to the **production Neon database** (there is
> no separate local DB configured). `regression` is read‑only and safe. `dev` can write — don't test
> destructive actions casually.

### Applying a schema change to production (the WS‑F migration pattern)
A new **additive** table (no data risk) is applied by hand, then recorded:
```bash
# 1. Edit prisma/schema.prisma + write prisma/migrations/<ts>_<name>/migration.sql
#    (use CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS — idempotent)
# 2. Back up: npx tsx scripts/backup.ts
# 3. Apply the raw SQL to Neon (psql / Neon SQL console / a scripts/apply-*.ts runner)
# 4. Record it without re-running: npx prisma migrate resolve --applied <ts>_<name>
# 5. Verify: npx prisma migrate status   → "Database schema is up to date!"
# 6. Only then ship the code: npm run push
```
See `docs/MIGRATION-LEDGER.md` for the full procedure and history.

---

## 9. Risks & warnings (read before touching anything)

- **Production is LIVE with real client data.** Backup‑first, additive/feature‑flag changes, never touch `remarks`/history, run data‑risky migrations in office hours. The regression gate + pre‑deploy backup are your safety net — never bypass them.
- **`main` is the deploy branch.** Pushing `main` can deploy. Don't push half‑finished work to `main`.
- **Schema must lead code.** The Vercel build does NOT migrate. Apply DB changes to Neon BEFORE pushing code that references them, or you get runtime errors in production.
- **`tsc` gotcha:** running bare `npx tsc` from your home directory hits an unrelated "troll" package. Always run from the repo root (`cd .../whitecollar-crm`) and use `npx tsc --noEmit -p tsconfig.json`.
- **Temporary probe/QA scripts:** if you add a throwaway `scripts/_probe_*.ts`, delete it before committing — `scripts/` is type‑checked by the deploy gate, and a stray file can break the build or get committed.
- **Concurrent sessions:** a second Claude/agent session has been editing this repo. Before any work: `git fetch && git status`; commit small and push often; never `git reset --hard` without checking `git stash list` and `git branch -a` first.
- **HR data is real** (447 applicants). Buyer Data is admin‑only and Dubai‑scoped. Don't bulk‑delete either.
- **Currency rule:** Dubai = AED, India = INR — never convert or mix; preserve the raw budget string.

---

## 10. Can Claude Code chat history transfer?

**No.** Claude Code stores conversation history and its local memory under the user’s home `.claude/`
folder (git‑ignored), tied to this machine. On the new laptop, Claude Code starts with a **fresh**
session and no memory of past chats. This `docs/CLAUDE_HANDOVER.md` + the other `docs/*` files
(`RELEASES.md`, `MIGRATION-LEDGER.md`, `DEV_TRACKER.md`, `RELEASE-2-*.md`) are the durable, in‑repo
record — point the new Claude session at them to get up to speed.

> If you want Claude's accumulated project memory too, it lives outside the repo at
> `C:\Users\Lenovo\.claude\projects\...\memory\` on the old laptop. Copying that folder is optional and
> path‑specific; the in‑repo docs above are the supported, portable handover.

---

## 11. Confirmation: no CRM work is lost by switching

✅ All production code is committed and pushed to `main` on GitHub.
✅ The only local‑only branches (1 unmerged feature branch) + all 4 git stashes were pushed to GitHub (`recovered/*`, `feat/customer-layer-foundation`).
✅ Working tree is clean (no uncommitted files).
✅ The database (Neon) and secrets (Vercel) are in the cloud — independent of any laptop.
➡️ Clone + copy `.env` + `npm install` on the new laptop and you're exactly where you left off.
