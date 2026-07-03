# White Collar Realty CRM — Development Sandbox

A **permanent, fully-independent** training/development/QA environment. It runs the
**same code, UI, APIs, workflows and permissions as production**, but on a
**separate database, storage and env** seeded with **dummy data only**. Nothing done
in the sandbox — import, export, delete, AI run, automation, cron — can ever touch
the live CRM, because the sandbox never holds a single production credential.

> Interns / developers / QA get a **Sandbox login**. They never receive production access.

---

## 1. How isolation is guaranteed (maps to the 10 requirements)

| # | Requirement | How it's met |
|---|---|---|
| 1 | Isolated environment | Separate Vercel project + separate Neon database. |
| 2 | No production data visible | Sandbox DB is created **empty** and seeded with dummy rows only — prod rows are never copied in. |
| 3 | Dummy data on every module | `scripts/sandbox/seed-sandbox.ts` seeds Leads, Master Data, Dubai + India Buyer, Revival, Reports, Dashboard, Call Logs, Notes, Conversations, Meetings, Site Visits, AI, AS Phone. |
| 4 | Realistic dummy data | Real-format names / UAE + India phones / emails / projects / conversation snippets. |
| 5 | Same permissions/workflows/APIs/UI | It's the **same codebase + same commit** — only env vars differ. |
| 6 | Never affects production | Sandbox `DATABASE_URL`, `RESEND_API_KEY`, `ANTHROPIC_API_KEY`, telephony creds, `CRON_SECRET` are all sandbox-only/blank. Cron/AI/email/telephony have **no path** to prod. |
| 7 | Freedom to experiment | It's disposable — reseed anytime with `npm run sandbox:seed`. |
| 8 | Reusable | Add a user row (or share the Sandbox Admin login). No prod access handed out. |
| 9 | No prod creds/recordings copied | `.env.sandbox.example` has every prod secret blanked or replaced. Recordings are dummy `sandbox://…` strings. |
| 10 | Fully independent | Separate DB + storage (Neon-in-DB storage) + env + deploy. |

---

## 2. What already exists in the repo (built, committed)

- `scripts/sandbox/guard.ts` — **prod-safety interlock**. Any sandbox script gets its
  Prisma client from `sandboxClient()`, which refuses to run unless `SANDBOX_DATABASE_URL`
  is set, ≠ `DATABASE_URL`, and its host/db name contains `sandbox|dev|test|staging|demo`.
  It is **structurally impossible** for the seed to write to prod.
- `scripts/sandbox/seed-sandbox.ts` — the pure fictional dummy-data seeder (idempotent).
- `scripts/sandbox/anonymize.ts` — deterministic realistic-fake generators (names, phones,
  emails, real-estate conversations, budgets) used by the refresh.
- `scripts/sandbox/anonymize-from-prod.ts` — **the anonymized refresh**: reads production
  READ-ONLY and writes an anonymized copy into the sandbox (real structure / volumes /
  statuses / workflow states, every PII field replaced with a *realistic fake*). The write
  client is the guarded one, so it can never touch prod.
- `.env.sandbox.example` — the sandbox env template (prod secrets stripped).
- Amber **"🟡 DEMO ADMIN MODE — DATA MASKED — NO REAL CLIENT DATA"** banner shows on every
  page + the login when `NEXT_PUBLIC_SANDBOX=1`.
- `npm run sandbox:seed` — pure fictional data. `npm run sandbox:refresh -- --confirm` —
  anonymized snapshot of prod (**refreshable on demand**: re-run any time for a fresh masked copy).

### Two ways to populate the sandbox
| Command | Data | Use it when |
|---|---|---|
| `npm run sandbox:seed -- --confirm` | Fully fictional (Rajesh Sharma, Marina Vista…) | You want a clean, prod-independent demo. |
| `npm run sandbox:refresh -- --confirm` | **Anonymized copy of production** — real structure + volumes + statuses, PII replaced with realistic fakes (Demo names / +91 90000… / demo-crm.local / fake budgets / fake conversations) | Interns need to see genuine "live CRM issues" without any real client identity. |

Both require `SANDBOX_DATABASE_URL` (guarded). `refresh` also reads `DATABASE_URL` (prod) but
**only ever reads it** — every write goes through the sandbox guard.

---

## 3. Provision it — two paths

### Path A — I do it for you (fastest)
Give me **one of**:
- a **Vercel access token** (Account → Settings → Tokens) **and** a **Neon API key**
  (Neon → Account → API keys), or
- run `npm i -g vercel neonctl && vercel login && neonctl auth` on this machine.

Then I'll create the Neon sandbox DB, push the schema, seed it, create the Vercel
sandbox project with the isolated env, and hand you the URL + login. ~10 min.

### Path B — you click, I've written everything
Follow the steps below (~15 min). All code/config is already in the repo.

---

## 4. Step-by-step (Path B)

### Step 1 — Create the sandbox database (Neon)
1. Neon console → your project → **Branches** → **New branch** (or create a **new
   project** for maximum independence).
2. Name it **`sandbox`** (the word matters — the guard requires it).
3. **Important:** if you branched from prod, it copied prod data. Wipe it clean in
   Step 3 (`prisma db push --force-reset` recreates the schema empty). A brand-new
   project/branch starts empty already.
4. Copy its connection string (with `?sslmode=require`).

### Step 2 — Point a local shell at the sandbox and load the schema
```bash
# from the repo root, in a shell — these are LOCAL only, they never deploy
export SANDBOX_DATABASE_URL="postgres://…/…sandbox…?sslmode=require"
export DATABASE_URL="$SANDBOX_DATABASE_URL"   # so prisma db push targets the sandbox

# create every table in the empty sandbox DB (schema only, no data)
npx prisma db push --force-reset
```

### Step 3 — Seed dummy data
```bash
# the guard requires --confirm and a sandbox-looking URL; it refuses prod
npm run sandbox:seed -- --confirm
```
You should see `🧪 SANDBOX target OK → …sandbox…` then per-module row counts.

### Step 4 — Create the sandbox Vercel project
1. Vercel → **Add New → Project** → import the **same GitHub repo**.
2. Name it e.g. **`whitecollar-crm-sandbox`**.
3. **Environment Variables:** paste from `.env.sandbox.example`, filling in the
   sandbox Neon URL and generating fresh secrets. Leave `RESEND_API_KEY`,
   `ANTHROPIC_API_KEY`, VAPID, and telephony **blank** (keeps them inert).
   Set `NEXT_PUBLIC_SANDBOX=1`.
4. Deploy. Optional: add a domain like `sandbox-crm.whitecollarrealty.com`.

### Step 5 — Log in
- URL: your sandbox domain (or the `*.vercel.app` Vercel gives you)
- **Sandbox Admin:** `sandbox@whitecollarrealty.com` / `Sandbox@123`
- Dummy agents/manager also exist (see the seed output) for testing scoping/reports.

---

## 5. Reusing it (req #8)
- New intern/dev/QA → hand them the **Sandbox Admin** login, or add a user row in the
  sandbox DB (Admin → Users, or a one-line `prisma.user.create`). Never give prod access.
- To reset to a clean slate anytime: re-run **Step 3** (`npm run sandbox:seed -- --confirm`).
  It wipes + reseeds the sandbox only.

## 6. Guardrails recap
- Seed **cannot** target prod (guard: dedicated `SANDBOX_DATABASE_URL` + sandbox-name
  check + `--confirm`, client bound explicitly to the sandbox URL).
- Sandbox deploy has **no** prod DB / email / AI / telephony / push credentials, so its
  crons, AI runs, imports and deletes are contained.
- The amber banner makes it visually unmistakable.

## 7. Cost note
Neon sandbox branch and a second Vercel project are **free on Hobby**. Keep the
sandbox on ≤2 Vercel crons like prod (see `AGENTS.md`), or disable its crons entirely.
