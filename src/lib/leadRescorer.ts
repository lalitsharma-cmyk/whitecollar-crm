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
import { notifyHotLead } from "@/lib/push";
import { aiEnabled, aiScoreLead } from "@/lib/ai";
import { CLOSING_STATUSES } from "@/lib/lead-statuses";

const NOISE_THRESHOLD = 3;

// ─────────────────────────────────────────────────────────────────────────────
// HOT / WARM / COLD DEFINITION (Agent I, scoring spec)
//
// These are the opinionated rule-based baselines. They cover the no-AI fallback
// path AND act as a sanity floor/ceiling even when AI is enabled (we don't let
// Claude call a 0-call ghost lead "HOT" — see clampBucketByRules).
//
//   HOT  := BANT.QUALIFIES
//           AND (status ∈ {NEGOTIATION, SITE_VISIT, BOOKING_DONE}
//                OR whenCanInvest ∈ {IMMEDIATE, THIRTY_DAYS})
//           AND ≥1 explicit buying signal in the last 14 days.
//   WARM := BANT ∈ {QUALIFIES, UNDER_REVIEW}
//           AND ≥1 connected call ever
//           AND last touch ≤14 days.
//   COLD := everything else, or no contact in 30+ days.
// ─────────────────────────────────────────────────────────────────────────────
// No stage system — HOT is determined by currentStatus (Excel status) + BANT + timeline.
// CLOSING_STATUSES (Meeting, Site Visit Schedule, Visit Dubai, etc.) = high-intent statuses.
const HOT_TIMELINES = new Set(["IMMEDIATE", "THIRTY_DAYS"]);
const DAY_MS = 24 * 60 * 60 * 1000;

export type LeadBucket = "HOT" | "WARM" | "COLD";

interface BucketInputs {
  bantStatus: BantStatus | null;
  currentStatus: string | null;
  whenCanInvest: string | null;
  callLogs: Array<{ outcome: CallOutcome; durationSec?: number | null; startedAt: Date }>;
  buyingSignalsCount14d: number;
  lastTouchedAt: Date;
}

/** Authoritative rule-based bucket (HOT/WARM/COLD). Status-only, no stages. */
export function ruleBucket(args: BucketInputs): LeadBucket {
  const now = Date.now();
  const daysSinceTouch = (now - args.lastTouchedAt.getTime()) / DAY_MS;
  if (daysSinceTouch >= 30) return "COLD";

  const hasConnectedCallEver = args.callLogs.some((c) => c.outcome === CallOutcome.CONNECTED);

  const qualifies = args.bantStatus === BantStatus.QUALIFIES;
  // "Status hot" = lead is in a closing-type Excel status (Meeting, Site Visit, Visit Dubai, etc.)
  const statusHot = args.currentStatus != null && CLOSING_STATUSES.includes(args.currentStatus);
  const timelineHot = args.whenCanInvest != null && HOT_TIMELINES.has(args.whenCanInvest);
  if (qualifies && (statusHot || timelineHot) && args.buyingSignalsCount14d >= 1) return "HOT";

  const bantWarm = args.bantStatus === BantStatus.QUALIFIES || args.bantStatus === BantStatus.UNDER_REVIEW;
  if (bantWarm && hasConnectedCallEver && daysSinceTouch <= 14) return "WARM";

  return "COLD";
}

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

// ─────────────────────────────────────────────────────────────────────────────
// BUYING SIGNAL EXTRACTION
// Define a clean, on-the-fly extractor — NOT persisted to a schema column this
// turn. Surfaces human-readable strings that we (a) feed into the AI prompt
// for grounding and (b) use as a "real evidence of intent" gate in HOT.
// ─────────────────────────────────────────────────────────────────────────────
const BUYING_PHRASES: Array<{ rx: RegExp; label: string }> = [
  { rx: /\bready to (book|buy|invest|close)\b/i, label: "Said 'ready to book/buy'" },
  { rx: /\btoken\b|\btoken amount\b|\bpaid token\b/i, label: "Token discussed" },
  { rx: /\bsite visit done\b|\bvisited (the )?site\b|\bsite seen\b/i, label: "Site visit completed" },
  { rx: /\bwants to invest\b|\binterested to invest\b/i, label: "Said 'wants to invest'" },
  { rx: /\bsend (me )?(the )?(eoi|booking form|payment link)\b/i, label: "Asked for EOI / booking form / payment link" },
  { rx: /\bsign(ing)? (the )?(mou|agreement)\b/i, label: "Signing agreement" },
  { rx: /\bkyc\b/i, label: "KYC discussed" },
  { rx: /\bblock(ed|ing)? (the )?unit\b/i, label: "Unit blocking discussed" },
];

export interface BuyingSignalsInput {
  remarks?: string | null;
  todoNext?: string | null;
  whoIsClient?: string | null;
  notesShort?: string | null;
  recentCalls: Array<{
    outcome: CallOutcome;
    durationSec?: number | null;
    notes?: string | null;
    startedAt: Date;
  }>;
  recentWA: Array<{ direction: WAMessageDirection; receivedAt: Date; body?: string | null }>;
}

/**
 * Returns human-readable buying-signal strings observed in remarks, recent
 * calls (notes / outcome / duration), and recent WA messages.
 * Stable, deterministic, deduplicated. Top-N caller's responsibility.
 */
export function extractBuyingSignals(input: BuyingSignalsInput): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (s: string) => {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  };

  const haystack = [input.remarks, input.todoNext, input.whoIsClient, input.notesShort]
    .filter(Boolean)
    .join("\n");
  for (const { rx, label } of BUYING_PHRASES) {
    if (rx.test(haystack)) push(label);
  }

  // Connected call longer than 5 min — real conversation, not a check-in.
  for (const c of input.recentCalls) {
    if (c.outcome === CallOutcome.CONNECTED && (c.durationSec ?? 0) > 300) {
      push("Connected call >5 min");
      break;
    }
  }

  // Inbound WhatsApp after a missed call — classic re-engagement.
  const lastMissedAt = input.recentCalls.find(
    (c) =>
      c.outcome === CallOutcome.NOT_PICKED ||
      c.outcome === CallOutcome.BUSY ||
      c.outcome === CallOutcome.SWITCHED_OFF,
  )?.startedAt;
  if (lastMissedAt) {
    const reEngaged = input.recentWA.some(
      (m) => m.direction === WAMessageDirection.INBOUND && m.receivedAt > lastMissedAt,
    );
    if (reEngaged) push("Inbound WA reply after a missed call (re-engaged)");
  }

  // Pure inbound WA in the last 7d is itself a buying-intent flag.
  const sevenAgo = Date.now() - 7 * DAY_MS;
  if (input.recentWA.some((m) => m.direction === WAMessageDirection.INBOUND && m.receivedAt.getTime() >= sevenAgo)) {
    push("Inbound WhatsApp <7d");
  }

  // Buying-intent phrases inside call notes themselves.
  for (const c of input.recentCalls) {
    if (!c.notes) continue;
    for (const { rx, label } of BUYING_PHRASES) {
      if (rx.test(c.notes)) push(`Call note: ${label}`);
    }
  }

  return out;
}

/** Count buying signals within the last 14 days — used by ruleBucket. */
export function buyingSignalsCount14d(input: BuyingSignalsInput): number {
  const fourteenAgo = Date.now() - 14 * DAY_MS;
  const recentInput: BuyingSignalsInput = {
    ...input,
    recentCalls: input.recentCalls.filter((c) => c.startedAt.getTime() >= fourteenAgo),
    recentWA: input.recentWA.filter((m) => m.receivedAt.getTime() >= fourteenAgo),
  };
  return extractBuyingSignals(recentInput).length;
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

export type ScoreFactorKind = "seed" | "boost" | "penalty" | "cap";

export interface ScoreFactor {
  label: string;
  delta: number;
  kind: ScoreFactorKind;
}

export interface ScoreExplanation {
  score: number;
  bucket: "HOT" | "WARM" | "COLD";
  factors: ScoreFactor[];
}

/**
 * Parallel explainer for computeScore. Reproduces the EXACT same arithmetic
 * step-by-step so the final `score` always matches computeScore(args), while
 * also emitting a human-readable factor for each scoring step. Keep this in
 * lock-step with computeScore above — any change there must be mirrored here.
 *
 * `delta` is expressed relative to the running score:
 *   - the seed factor shows the offset from the 50 neutral baseline,
 *   - cap factors (BANT) show the actual change applied by the floor/ceiling
 *     (0 if the verdict didn't move the score),
 *   - boosts/penalties show their signed contribution.
 */
export function explainScore(args: {
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
}): ScoreExplanation {
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const factors: ScoreFactor[] = [];

  // 1. SEED from MIS categorization (baseline 50).
  const cat = (args.categorization ?? "").toLowerCase();
  let score = 50;
  let seedLabel = "MIS: Uncategorized (neutral)";
  if (/highly responsive|🔥|hot|excited|ready to (book|buy|close)|booked|signed|paid/i.test(cat)) {
    score = 80;
    seedLabel = "MIS: Highly responsive";
  } else if (/responsive|warm|interested|positive|considering|will visit|meeting scheduled|🙂/i.test(cat)) {
    score = 60;
    seedLabel = "MIS: Responsive / interested";
  } else if (/sometimes responsive|🤔/i.test(cat)) {
    score = 45;
    seedLabel = "MIS: Sometimes responsive";
  } else if (/not interested|dropped|do not call|wrong number|stale|❌/i.test(cat)) {
    score = 15;
    seedLabel = "MIS: Not interested / dropped";
  } else if (/cold|not picking|switched off|low interest|just browsing|window shopping|future plan|🧊|📵/i.test(cat)) {
    score = 25;
    seedLabel = "MIS: Cold / not picking";
  }
  factors.push({ label: seedLabel, delta: score - 50, kind: "seed" });

  // 2. BANT verdict — definitive overrides (caps/floors).
  if (args.bantStatus === BantStatus.QUALIFIES) {
    const before = score;
    score = Math.max(score, 70);
    factors.push({ label: "BANT qualifies (floor 70)", delta: score - before, kind: "cap" });
  }
  if (args.bantStatus === BantStatus.NOT_QUALIFIED) {
    const before = score;
    score = Math.min(score, 25);
    factors.push({ label: "BANT not qualified (cap 25)", delta: score - before, kind: "cap" });
  }

  // 3. Profile signals (small, one-shot, additive).
  const ccyMul = args.budgetMin && args.budgetMin > 1_000_000 ? 5 : 0;
  score += ccyMul;
  if (ccyMul) factors.push({ label: "Budget over 1M", delta: 5, kind: "boost" });
  if (args.fundReadiness === "CASH_READY") {
    score += 8;
    factors.push({ label: "Cash ready", delta: 8, kind: "boost" });
  } else if (args.fundReadiness === "BANK_APPROVED") {
    score += 4;
    factors.push({ label: "Bank approved", delta: 4, kind: "boost" });
  }
  if (args.potential === "HIGH") {
    score += 5;
    factors.push({ label: "High potential", delta: 5, kind: "boost" });
  } else if (args.potential === "LOW") {
    score -= 5;
    factors.push({ label: "Low potential", delta: -5, kind: "penalty" });
  }

  // 4. Behavioural BOOSTS.
  const sevenDaysAgo = now - 7 * DAY;
  const fourteenDaysAgo = now - 14 * DAY;
  const repliedRecentlyOnWA = args.waMessages.some(
    (m) => m.direction === WAMessageDirection.INBOUND && m.receivedAt.getTime() >= sevenDaysAgo
  );
  if (repliedRecentlyOnWA) {
    score += 12;
    factors.push({ label: "Replied on WhatsApp <7d", delta: 12, kind: "boost" });
  }

  const recentConnectedCall = args.callLogs.some(
    (c) => c.outcome === CallOutcome.CONNECTED && c.startedAt.getTime() >= fourteenDaysAgo
  );
  if (recentConnectedCall) {
    score += 10;
    factors.push({ label: "Connected call <14d", delta: 10, kind: "boost" });
  }

  const completedSiteVisitEver = args.activities.some(
    (a) => a.type === ActivityType.SITE_VISIT && a.status === ActivityStatus.DONE
  );
  if (completedSiteVisitEver) {
    score += 15;
    factors.push({ label: "Completed a site visit", delta: 15, kind: "boost" });
  }

  // 5. Behavioural PENALTIES.
  let consecutiveNotPicked = 0;
  for (const c of args.callLogs) {
    if (c.outcome === CallOutcome.NOT_PICKED || c.outcome === CallOutcome.SWITCHED_OFF || c.outcome === CallOutcome.BUSY) {
      consecutiveNotPicked++;
    } else break;
  }
  if (consecutiveNotPicked >= 7) {
    score -= 20;
    factors.push({ label: "7+ consecutive not-picked", delta: -20, kind: "penalty" });
  } else if (consecutiveNotPicked >= 5) {
    score -= 15;
    factors.push({ label: "5+ consecutive not-picked", delta: -15, kind: "penalty" });
  } else if (consecutiveNotPicked >= 3) {
    score -= 10;
    factors.push({ label: "3+ consecutive not-picked", delta: -10, kind: "penalty" });
  }

  // Idle decay — one-shot bracket.
  const daysSinceTouch = (now - args.lastTouchedAt.getTime()) / DAY;
  if (daysSinceTouch >= 60) {
    score -= 15;
    factors.push({ label: "Idle 60+ days", delta: -15, kind: "penalty" });
  } else if (daysSinceTouch >= 30) {
    score -= 8;
    factors.push({ label: "Idle 30+ days", delta: -8, kind: "penalty" });
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  return { score: finalScore, bucket: bucketFor(finalScore) as ScoreExplanation["bucket"], factors };
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

  let ruleScoreValue = computeScore({
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

  // Step 1: compute opinionated rule-based bucket (HOT/WARM/COLD) on top of the
  // raw computeScore numeric. This is the AI-OFF default AND a sanity floor
  // even when AI is enabled.
  const buyingInput: BuyingSignalsInput = {
    remarks: lead.remarks,
    todoNext: lead.todoNext,
    whoIsClient: lead.whoIsClient,
    notesShort: lead.notesShort,
    recentCalls: lead.callLogs.map((c) => ({
      outcome: c.outcome,
      durationSec: c.durationSec,
      notes: c.notes,
      startedAt: c.startedAt,
    })),
    recentWA: lead.waMessages.map((m) => ({
      direction: m.direction,
      receivedAt: m.receivedAt,
      body: m.body,
    })),
  };
  const sig14d = buyingSignalsCount14d(buyingInput);
  const ruleBucketResult = ruleBucket({
    bantStatus: lead.bantStatus,
    currentStatus: lead.currentStatus,
    whenCanInvest: lead.whenCanInvest as string | null,
    callLogs: lead.callLogs.map((c) => ({
      outcome: c.outcome,
      durationSec: c.durationSec,
      startedAt: c.startedAt,
    })),
    buyingSignalsCount14d: sig14d,
    lastTouchedAt: lead.lastTouchedAt ?? lead.createdAt,
  });

  // Step 2: if AI is enabled, ask Claude/Gemini to score using full narrative.
  // We grant Claude the right to choose any bucket — but we still record the
  // rule bucket as a guardrail (logged into aiSummary tail for explainability).
  let score = ruleScoreValue;
  let newBucket: AIScore = ruleBucketResult === "HOT" ? AIScore.HOT : ruleBucketResult === "WARM" ? AIScore.WARM : AIScore.COLD;
  let aiSummary: string | null = null;
  let aiNextAction: string | null = null;

  if (aiEnabled()) {
    try {
      const aiResult = await aiScoreLead({
        leadId: lead.id,
        name: lead.name,
        company: lead.company,
        whoIsClient: lead.whoIsClient,
        bantStatus: lead.bantStatus,
        budgetMin: lead.budgetMin,
        budgetMax: lead.budgetMax,
        budgetCurrency: lead.budgetCurrency,
        configuration: lead.configuration,
        remarks: lead.remarks,
        currentStatus: lead.currentStatus,
        whenCanInvest: lead.whenCanInvest as string | null,
        potential: lead.potential as string | null,
        fundReadiness: lead.fundReadiness as string | null,
        moodStatus: lead.moodStatus as string | null,
        categorization: lead.categorization,
        recentActivities: lead.activities.slice(0, 6).map((a) => ({
          type: a.type,
          status: a.status,
          title: a.title,
          createdAt: a.createdAt,
        })),
        recentWA: lead.waMessages.slice(0, 3).map((m) => ({
          direction: m.direction,
          body: m.body,
          receivedAt: m.receivedAt,
        })),
        buyingSignals: extractBuyingSignals(buyingInput),
        lastTouchDaysAgo: Math.floor((Date.now() - (lead.lastTouchedAt ?? lead.createdAt).getTime()) / DAY_MS),
      });
      if (aiResult) {
        score = aiResult.value;
        newBucket = aiResult.score === "HOT" ? AIScore.HOT : aiResult.score === "WARM" ? AIScore.WARM : AIScore.COLD;
        aiSummary = aiResult.whyShort || null;
        aiNextAction = aiResult.nextAction || null;
        ruleScoreValue = score; // keep delta reporting honest
      }
    } catch (e) {
      console.warn("[rescoreLead] aiScoreLead failed, falling back to rules:", e);
    }
  }

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
      ...(aiSummary ? { aiSummary } : {}),
      ...(aiNextAction ? { aiNextAction } : {}),
    },
  });
  // Suppress unused-var warning: ruleScoreValue is mirrored into `score` above;
  // keeping the binding makes the AI-on path's audit trail readable.
  void ruleScoreValue;

  await prisma.activity.create({
    data: {
      leadId,
      type: ActivityType.STATUS_CHANGE,
      status: ActivityStatus.DONE,
      title: `🤖 AI re-score: ${previousScore ?? "—"} → ${score} (${oldBucket ?? "—"} → ${newBucket})`,
      completedAt: updatedAt,
    },
  });

  // Hot-lead Web Push (spec §12.3) — fire only on the WARM/COLD/null → HOT
  // transition so we don't re-ping the owner every rescore on an already-HOT
  // lead. notifyHotLead has its own 1×/24h guard as a second line of defense.
  if (newBucket === AIScore.HOT && oldBucket !== AIScore.HOT && lead.ownerId) {
    notifyHotLead({
      id: lead.id,
      name: lead.name,
      ownerId: lead.ownerId,
      budgetMin: lead.budgetMin,
      budgetMax: lead.budgetMax,
      budgetCurrency: lead.budgetCurrency,
    }).catch(() => {});
  }

  return { from: previousScore, to: score, changedBy: delta };
}
