// Behavioural lead re-scoring.
//
// Unlike src/lib/ai.ts (which scores ONCE at intake from the static profile),
// this module recomputes the aiScore based on what the lead has actually DONE
// since they entered the pipeline: WhatsApp replies, picked-up calls, completed
// site visits, BANT verdicts, contact recency, etc.
//
// Called fire-and-forget from API routes after the user action persists, plus
// nightly via /api/cron/rescore-all for leads that no one has touched today.
//
// Returns a small diff so the caller can log / react if needed.

import "server-only";
import { prisma } from "@/lib/prisma";
import {
  AIScore,
  ActivityType,
  ActivityStatus,
  CallOutcome,
  WAMessageDirection,
  BantStatus,
} from "@prisma/client";

// Update threshold — avoid logging activity / bumping aiUpdatedAt for tiny moves.
const NOISE_THRESHOLD = 3;

export interface RescoreResult {
  /** Previous numeric score (0-100). Null = no change applied (sub-threshold or lead missing). */
  from: number | null;
  /** New numeric score (0-100). Null = no change applied. */
  to: number | null;
  /** Signed delta (to - from). 0 means no change applied. */
  changedBy: number;
  /** Set when a lead was scored but the delta was below NOISE_THRESHOLD. */
  skippedBelowThreshold?: boolean;
  /** Set when the leadId was not found. */
  notFound?: boolean;
}

function bucketFor(score: number): AIScore {
  if (score >= 70) return AIScore.HOT;
  if (score >= 40) return AIScore.WARM;
  return AIScore.COLD;
}

export async function rescoreLead(leadId: string): Promise<RescoreResult> {
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: {
      callLogs: { orderBy: { startedAt: "desc" }, take: 30 },
      activities: { orderBy: { createdAt: "desc" }, take: 20 },
      waMessages: { orderBy: { receivedAt: "desc" }, take: 20 },
    },
  });
  if (!lead) return { from: null, to: null, changedBy: 0, notFound: true };

  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  const base = typeof lead.aiScoreValue === "number" ? lead.aiScoreValue : 50;
  let score = base;

  // ── Positive signals ───────────────────────────────────────────────────────
  // 1) Lead replied to WA in last 7 days (+10)
  const sevenDaysAgo = now - 7 * DAY;
  const repliedRecentlyOnWA = lead.waMessages.some(
    (m) => m.direction === WAMessageDirection.INBOUND && m.receivedAt.getTime() >= sevenDaysAgo
  );
  if (repliedRecentlyOnWA) score += 10;

  // 2) Call CONNECTED in last 14 days (+8)
  const fourteenDaysAgo = now - 14 * DAY;
  const recentConnectedCall = lead.callLogs.some(
    (c) => c.outcome === CallOutcome.CONNECTED && c.startedAt.getTime() >= fourteenDaysAgo
  );
  if (recentConnectedCall) score += 8;

  // 3) Site visit COMPLETED ever (+15) — DONE SITE_VISIT activity
  const completedSiteVisitEver = lead.activities.some(
    (a) => a.type === ActivityType.SITE_VISIT && a.status === ActivityStatus.DONE
  );
  if (completedSiteVisitEver) score += 15;

  // 4) Budget set + over 1M (+5) — min OR max greater than 1,000,000
  const hasBudgetOver1M =
    (lead.budgetMin != null && lead.budgetMin > 1_000_000) ||
    (lead.budgetMax != null && lead.budgetMax > 1_000_000);
  if (hasBudgetOver1M) score += 5;

  // ── Negative signals ───────────────────────────────────────────────────────
  // 5) 3+ consecutive NOT_PICKED at the head of call history (-12)
  let consecutiveNotPicked = 0;
  for (const c of lead.callLogs) {
    if (c.outcome === CallOutcome.NOT_PICKED) consecutiveNotPicked++;
    else break;
  }
  if (consecutiveNotPicked >= 3) score -= 12;

  // 6) No contact in 30+ days (-15) — based on lastTouchedAt (falls back to createdAt)
  const lastTouch = lead.lastTouchedAt ?? lead.createdAt;
  const daysSinceTouch = (now - lastTouch.getTime()) / DAY;
  if (daysSinceTouch >= 30) score -= 15;

  // 7) BANT NOT_QUALIFIED (-20)
  if (lead.bantStatus === BantStatus.NOT_QUALIFIED) score -= 20;

  // Clamp 0-100, map to bucket
  score = Math.max(0, Math.min(100, Math.round(score)));
  const newBucket = bucketFor(score);
  const oldBucket = lead.aiScore ?? bucketFor(base);

  const delta = score - base;

  // Only persist if the value moved by ≥ NOISE_THRESHOLD (avoid timeline spam)
  if (Math.abs(delta) < NOISE_THRESHOLD) {
    return { from: base, to: base, changedBy: 0, skippedBelowThreshold: true };
  }

  const updatedAt = new Date();
  await prisma.lead.update({
    where: { id: leadId },
    data: {
      aiScore: newBucket,
      aiScoreValue: score,
      aiUpdatedAt: updatedAt,
    },
  });

  // Log a STATUS_CHANGE activity so the timeline shows the score movement.
  // The lead detail page detects this via the "🤖 AI re-score:" title prefix.
  await prisma.activity.create({
    data: {
      leadId,
      // userId omitted — system-generated activity has no user
      type: ActivityType.STATUS_CHANGE,
      status: ActivityStatus.DONE,
      title: `🤖 AI re-score: ${base} → ${score} (${oldBucket} → ${newBucket})`,
      completedAt: updatedAt,
    },
  });

  return { from: base, to: score, changedBy: delta };
}
