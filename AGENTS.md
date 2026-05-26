<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:vercel-hobby-limits -->
# Vercel Hobby plan limits — DO NOT VIOLATE

This project is on the **Hobby** (free) plan. Violations make Vercel **silently
drop the entire deployment** (no row, no error in the dashboard). We lost
18+ hours to this once — read before touching `vercel.json`.

  - **Max 2 cron jobs** in `vercel.json.crons` (currently 2)
  - All Vercel cron schedules must be **daily or less frequent** (no `* * * * *` or `*/N * * * *`)
  - Sub-daily crons live in `.github/workflows/cron.yml` instead, hitting the same `/api/cron/*` endpoints with `Authorization: Bearer ${{ secrets.CRON_SECRET }}`

Need a new scheduled job?
  - Daily-or-less + ≤2 total existing  →  add to `vercel.json`
  - Otherwise  →  add a step to `.github/workflows/cron.yml`

Need to deploy? Don't wait for the webhook — run `npm run push` (git push +
deploy hook via `scripts/deploy.sh`). Verify with `curl https://crm.whitecollarrealty.com/api/health`
and confirm the `commit` field matches `git rev-parse --short HEAD`.
<!-- END:vercel-hobby-limits -->
