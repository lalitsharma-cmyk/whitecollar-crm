#!/usr/bin/env bash
# One-command CODE rollback to a previous commit, then redeploy through the gate.
#   bash scripts/rollback.sh <commit-sha>
#
# FASTEST path (no rebuild, ~30s): Vercel dashboard → Deployments → pick the last
# good build → "Promote to Production". Use THIS script for the git-based path.
# The DATABASE is NOT auto-restored — data restore is destructive; see
# docs/DEPLOY_SAFETY.md for Neon point-in-time restore + the pre-deploy snapshot.
set -e
cd "$(dirname "$0")/.."
TARGET="${1:-}"
if [ -z "$TARGET" ]; then
  echo "Usage: bash scripts/rollback.sh <commit-sha>"
  echo ""
  echo "Recent deploys (rollback targets) — from docs/DEPLOY_LOG.md:"
  grep -E '^## ' docs/DEPLOY_LOG.md 2>/dev/null | tail -8 || echo "  (no deploy log yet)"
  exit 1
fi
echo "⏪ Reverting production code to $TARGET (inverse commits for everything since)..."
git revert --no-edit "$TARGET"..HEAD
echo "↪  Redeploying (regression gate + pre-deploy backup run again)..."
bash scripts/deploy.sh
