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

# ─── PRODUCTION SAFETY: risk classification + rollback point ──────────────────
# "Safety First, Features Second." Mark every deploy's risk; High-risk deploys
# require explicit approval. Flag schema changes so no migration ships silently.
#   RISK=Safe|Low|Medium|High   (default Low)   ·   APPROVED=1 to allow High
RISK="${RISK:-Low}"
case "$RISK" in
  Safe|Low|Medium) ;;
  High)
    if [ "${APPROVED:-}" != "1" ]; then
      echo "⛔ RISK=High requires approval. Re-run:  APPROVED=1 RISK=High npm run push"
      exit 1
    fi ;;
  *) echo "❌ RISK must be Safe|Low|Medium|High (got '$RISK')"; exit 1 ;;
esac
HEAD_SHA="$(git rev-parse --short HEAD)"
PREV_SHA="$(cat .last-deploy-sha 2>/dev/null || git rev-parse --short HEAD~1 2>/dev/null || echo '')"
CHANGED="$(git diff --name-only "${PREV_SHA:-HEAD~1}" HEAD 2>/dev/null || true)"
SCHEMA_CHANGED="$(echo "$CHANGED" | grep -E 'prisma/(schema|migrations)' || true)"
if [ -n "$SCHEMA_CHANGED" ]; then
  echo "🗄  SCHEMA CHANGE in this deploy (no silent migrations — Safety Rule #8):"
  echo "$SCHEMA_CHANGED" | sed 's/^/      /'
  echo "    → Confirm the migration is already applied to prod + reported to the owner."
fi

# ─── SERVICE-WORKER CACHE GUARD ──────────────────────────────────────────────
# The SW (public/sw.js) caches the app shell; if its CACHE version isn't bumped,
# users keep seeing the OLD UI ("fixes not visible"). If this deploy changes any
# UI file (src/** or public/** other than sw.js) but does NOT touch public/sw.js,
# warn loudly — bump `const CACHE = "wcr-shell-vNN"` so cached clients reload.
UI_CHANGED="$(echo "$CHANGED" | grep -E '^(src/|public/)' | grep -v '^public/sw.js' || true)"
SW_CHANGED="$(echo "$CHANGED" | grep -E '^public/sw\.js$' || true)"
if [ -n "$UI_CHANGED" ] && [ -z "$SW_CHANGED" ]; then
  echo "⚠️  UI files changed but public/sw.js was NOT bumped — cached clients may keep the OLD UI."
  echo "    → Bump 'const CACHE = \"wcr-shell-vNN\"' in public/sw.js, commit, and redeploy."
fi
echo "🏷  Risk: $RISK   ·   Rollback point: ${PREV_SHA:-unknown} → $HEAD_SHA"
echo ""

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

echo "🔎 Regression gate: HR RBAC authorization (tsx scripts/regression-hr-rbac.ts)..."
if ! npx tsx scripts/regression-hr-rbac.ts; then
  echo ""
  echo "❌ REGRESSION GATE FAILED — deploy aborted"
  echo "   (An HR authorization leak / permission-matrix assertion failed — never ship an RBAC hole.)"
  exit 1
fi

echo "✅ Regression gate passed — proceeding to deploy."
echo ""
# ─────────────────────────────────────────────────────────────────────────────

# ─── PRE-DEPLOY BACKUP (Safety Rule #2) — abort if it fails ───────────────────
echo "💾 Pre-deploy backup (read-only snapshot of critical tables)..."
if ! BACKUP_OUT="$(DEPLOY_COMMIT="$HEAD_SHA" npx tsx scripts/backup.ts)"; then
  echo "❌ BACKUP FAILED — deploy aborted (never deploy without a snapshot)."
  exit 1
fi
echo "$BACKUP_OUT"
BACKUP_DIR="$(echo "$BACKUP_OUT" | grep -oE 'BACKUP_DIR=.*' | cut -d= -f2-)"
echo ""

echo "📤 Pushing to GitHub (origin/main)..."
git push origin main

echo ""
echo "🚀 Triggering Vercel deploy of $(git rev-parse --short HEAD) ($(git log -1 --format=%s))..."
response=$(curl -sX POST "$VERCEL_DEPLOY_HOOK_URL")
echo "   Vercel response: $response"
echo ""

# ─── DEPLOY LOG + rollback point (Safety Rule #3 / #7) ───────────────────────
mkdir -p docs
{
  echo "## $(date -u +%Y-%m-%dT%H:%M:%SZ)  ·  $HEAD_SHA  ·  risk=$RISK"
  echo "- by:        $(git log -1 --format='%an <%ae>')"
  echo "- subject:   $(git log -1 --format=%s)"
  echo "- rollback→: ${PREV_SHA:-unknown}    (bash scripts/rollback.sh ${PREV_SHA:-<sha>})"
  echo "- backup:    ${BACKUP_DIR:-none}"
  echo "- files:     $(echo "$CHANGED" | tr '\n' ' ')"
  echo ""
} >> docs/DEPLOY_LOG.md
echo "$HEAD_SHA" > .last-deploy-sha
echo "📝 Logged to docs/DEPLOY_LOG.md  ·  rollback point: ${PREV_SHA:-unknown}"
echo ""
echo "📊 Watch the deploy at: https://vercel.com/lalitsharma-cmyks-projects/whitecollar-crm/deployments"
echo "   Production URL:    https://crm.whitecollarrealty.com"
