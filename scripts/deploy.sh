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

echo "🚀 Triggering Vercel deploy of $(git rev-parse --short HEAD) ($(git log -1 --format=%s))..."
response=$(curl -sX POST "$VERCEL_DEPLOY_HOOK_URL")
echo "   Vercel response: $response"
echo ""
echo "📊 Watch the deploy at: https://vercel.com/lalitsharma-cmyks-projects/whitecollar-crm/deployments"
echo "   Production URL:    https://crm.whitecollarrealty.com"
