// Behavioural lead re-scoring — STATELESS.
//
// Bug fix (May 26): the previous version read lead.aiScoreValue as the BASE
// and applied +/- deltas on top of it each run. That meant penalties stacked
// indefinitely — a HOT 85 lead with a not-picked streak lost 12 every nightly
// pass (85 → 73 → 61 → 49 → 37 → COLD) even when nothing about the lead
// actually changed. Lalit: "AI rescore does not work correct — HOT lead shows
// as COLD or vice versa". Now the rescorer is stateless: it always computes
// from scratch using the lead's current profile + recent behavior, so the same
// data always yields the same score.
//
// Conceptually:
//   1. SEED the score from the lead's classification (categorization column
//      from the MIS sheet — "Highly Responsive" / "Cold" / etc.) or default 50.
//   2. CLAMP via BANT verdict (definitive QUALIFIES / NOT_QUALIFIED).
//   3. BOOST for fresh positive behavior (WA reply, connected call, site visit).
//   4. PENALIZE for negative behavior (consecutive not-picked, idle decay).
//   5. CLAMP 0..100, map to bucket via thresholds.
//
// Called fire-and-forget from API routes after the user action persists, plus
// nightly via /api/cron/rescore-all for leads no one touched today.

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

const NOISE_THRESHOLD = 3;

export interface RescoreResult {
  from: number | null;
  to: number | null;
  changedBy: number;
  skippedBelowThreshold?: boolean;
  notFound?: boolean;
}

function bucketFor(score: number): AIScore {
  if (score >= 70) return AIScore.HOT;
  if (score >= 40) return AIScore.WARM;
  return AIScore.COLD;
}

/**
 * Stateless score computation. Does NOT depend on the lead's previous score —
 * always derives the new score from current profile + recent activity.
 */
function computeScore(args: {
  categorization: string | null;
  bantStatus: BantStatus | null;
  fundReadiness: string | null;
  potential: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  callLogs: Array<{ outcome: CallOutcome; startedAt: Date }>;
  waMessages: Array<{ direction: WAMessageDirection; receivedAt: Date }>;
  activities: Array<{ type: ActivityType; status: ActivityStatus }>;
  lastTouchedAt: Date;
}): number {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;

  // 1. SEED from MIS categorization. Lalit's team writes this manually in the
  // sheet; respect what they typed. Default 50 (neutral) when blank/unknown.
  const cat = (args.categorization ?? "").toLowerCase();
  let score = 50;
  if (/highly responsive|🔥|hot|excited|ready to (book|buy|close)|booked|signed|paid/i.test(cat)) {
    score = 80;
  } else if (/responsive|warm|interested|positive|considering|will visit|meeting scheduled|🙂/i.test(cat)) {
    score = 60;
  } else if (/sometimes responsive|🤔/i.test(cat)) {
    score = 45;
  } else if (/not interested|dropped|do not call|wrong number|stale|❌/i.test(cat)) {
    score = 15;
  } else if (/cold|not picking|switched off|low interest|just browsing|window shopping|future plan|🧊|📵/i.test(cat)) {
    score = 25;
  }

  // 2. BANT verdict — definitive overrides. QUALIFIES floors at WARM-high,
  // NOT_QUALIFIED caps at low-WARM.
  if (args.bantStatus === BantStatus.QUALIFIES) score = Math.max(score, 70);
  if (args.bantStatus === BantStatus.NOT_QUALIFIED) score = Math.min(score, 25);

  // 3. Profile signals (small, one-shot, additive)
  const ccyMul = args.budgetMin && args.budgetMin > 1_000_000 ? 5 : 0;
  score += ccyMul;
  if (args.fundReadiness === "CASH_READY") score += 8;
  else if (args.fundReadiness === "BANK_APPROVED") score += 4;
  if (args.potential === "HIGH") score += 5;
  else if (args.potential === "LOW") score -= 5;

  // 4. Behavioural BOOSTS (fresh evidence of engagement)
  const sevenDaysAgo = now - 7 * DAY;
  const fourteenDaysAgo = now - 14 * DAY;
  const repliedRecentlyOnWA = args.waMessages.some(
    (m) => m.direction === WAMessageDirection.INBOUND && m.receivedAt.getTime() >= sevenDaysAgo
  );
  if (repliedRecentlyOnWA) score += 12;

  const recentConnectedCall = args.callLogs.some(
    (c) => c.outcome === CallOutcome.CONNECTED && c.startedAt.getTime() >= fourteenDaysAgo
  );
  if (recentConnectedCall) score += 10;

  const completedSiteVisitEver = args.activities.some(
    (a) => a.type === ActivityType.SITE_VISIT && a.status === ActivityStatus.DONE
  );
  if (completedSiteVisitEver) score += 15;

  // 5. Behavioural PENALTIES
  // Consecutive not-picked at the head of the call list — capped, NOT cumulative.
  let consecutiveNotPicked = 0;
  for (const c of args.callLogs) {
    if (c.outcome === CallOutcome.NOT_PICKED || c.outcome === CallOutcome.SWITCHED_OFF || c.outcome === CallOutcome.BUSY) {
      consecutiveNotPicked++;
    } else break;
  }
  if (consecutiveNotPicked >= 7) score -= 20;
  else if (consecutiveNotPicked >= 5) score -= 15;
  else if (consecutiveNotPicked >= 3) score -= 10;

  // Idle decay — one-shot bracket, not per-rescore accumulator.
  const daysSinceTouch = (now - args.lastTouchedAt.getTime()) / DAY;
  if (daysSinceTouch >= 60) score -= 15;
  else if (daysSinceTouch >= 30) score -= 8;

  return Math.max(0, Math.min(100, Math.round(score)));
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

  const previousScore = typeof lead.aiScoreValue === "number" ? lead.aiScoreValue : null;

  const score = computeScore({
    categorization: lead.categorization,
    bantStatus: lead.bantStatus,
    fundReadiness: lead.fundReadiness as string | null,
    potential: lead.potential as string | null,
    budgetMin: lead.budgetMin,
    budgetMax: lead.budgetMax,
    callLogs: lead.callLogs.map((c) => ({ outcome: c.outcome, startedAt: c.startedAt })),
    waMessages: lead.waMessages.map((m) => ({ direction: m.direction, receivedAt: m.receivedAt })),
    activities: lead.activities.map((a) => ({ type: a.type, status: a.status })),
    lastTouchedAt: lead.lastTouchedAt ?? lead.createdAt,
  });

  const newBucket = bucketFor(score);
  const oldBucket = lead.aiScore;
  const delta = previousScore != null ? score - previousScore : score;

  // Skip persistence + activity log when the move is below noise threshold AND
  // the bucket didn't change. A bucket flip (WARM→HOT) always gets logged even
  // if the raw delta is small — that's a meaningful UX change.
  if (previousScore != null && Math.abs(delta) < NOISE_THRESHOLD && newBucket === oldBucket) {
    return { from: previousScore, to: previousScore, changedBy: 0, skippedBelowThreshold: true };
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

  await prisma.activity.create({
    data: {
      leadId,
      type: ActivityType.STATUS_CHANGE,
      status: ActivityStatus.DONE,
      title: `🤖 AI re-score: ${previousScore ?? "—"} → ${score} (${oldBucket ?? "—"} → ${newBucket})`,
      completedAt: updatedAt,
    },
  });

  return { from: previousScore, to: score, changedBy: delta };
}
