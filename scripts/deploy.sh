#!/usr/bin/env bash
# Trigger a fresh Vercel deploy from main branch HEAD.
#
# Used because Vercel's GitHub webhook stopped firing for some commits
# (the Git-author email "lalit@whitecollarrealty.com" wasn't matched to a
# GitHub account → silent block). The Deploy Hook URL is a direct trigger
# that bypasses every spam/author check.
#
# Setup once:
#   1. Vercel Settings → Git → Deploy Hooks → Create on `main`
#   2. Paste the URL into .env as VERCEL_DEPLOY_HOOK_URL=...
#
# Then any of:
#   • bash scripts/deploy.sh           — manual
#   • npm run deploy                    — wrapped by package.json
#   • npm run push                      — git push + deploy in one shot
#
# The hook URL is a secret — never commit it. .env is gitignored.

set -e
cd "$(dirname "$0")/.."

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; source .env; set +a
fi

if [ -z "${VERCEL_DEPLOY_HOOK_URL:-}" ]; then
  echo "❌ VERCEL_DEPLOY_HOOK_URL not set in .env"
  echo "   Vercel Settings → Git → Deploy Hooks → Create on main → copy URL"
  exit 1
fi

# ─── REGRESSION GATE ─────────────────────────────────────────────────────────
# Run BEFORE we push / trigger Vercel. Two gates, in order:
#   1. `tsc --noEmit`            — types/compile (catches what the editor would).
#   2. `tsx scripts/regression.ts` — READ-ONLY data-invariant assertions against
#                                    the live prod DB (deleted-lead exclusion,
#                                    source migration, import validation, remark
#                                    preservation, report sanity, scoping data).
# If EITHER exits non-zero, abort WITHOUT deploying. The Vercel build itself
# already gates on `next build`; this adds the typecheck + data-logic gate that
# the build can't see, so a green compile can't ship a silent data regression.
echo "🔎 Regression gate: typecheck (tsc --noEmit)..."
if ! npx tsc --noEmit; then
  echo ""
  echo "❌ REGRESSION GATE FAILED — deploy aborted"
  echo "   (TypeScript typecheck failed — fix the errors above, then retry.)"
  exit 1
fi

echo "🔎 Regression gate: data invariants (tsx scripts/regression.ts)..."
if ! npx tsx scripts/regression.ts; then
  echo ""
  echo "❌ REGRESSION GATE FAILED — deploy aborted"
  echo "   (A data-invariant assertion failed above — investigate before shipping.)"
  exit 1
fi

echo "✅ Regression gate passed — proceeding to deploy."
echo ""
# ─────────────────────────────────────────────────────────────────────────────

echo "📤 Pushing to GitHub (origin/main)..."
git push origin main

echo ""
echo "🚀 Triggering Vercel deploy of $(git rev-parse --short HEAD) ($(git log -1 --format=%s))..."
response=$(curl -sX POST "$VERCEL_DEPLOY_HOOK_URL")
echo "   Vercel response: $response"
echo ""
echo "📊 Watch the deploy at: https://vercel.com/lalitsharma-cmyks-projects/whitecollar-crm/deployments"
echo "   Production URL:    https://crm.whitecollarrealty.com"
