// AI Sales OS — Coach / Analyst / BI core (M5), PURE + unit-testable. Turns a flat
// list of already-classified leads into (a) a pipeline-health summary and (b) per-agent
// coaching nudges + a manager daily digest. READ-ONLY by construction — it computes
// numbers and sentences, never a mutation. The server layer (analyticsService) does the
// live reads + flag computation and passes plain DigestLeads in, so this stays pure.
//
// ISOLATED (branch ai-sales-os-v2). Not deployed until "Deploy AI".
import type { AiConfidence } from "./types";

export type DigestMarket = "India" | "UAE";

/** One lead reduced to the flags the digest needs (computed server-side). */
export interface DigestLead {
  id: string;
  market: DigestMarket | null;
  ownerId: string | null;
  ownerName: string | null;
  isTerminal: boolean;       // closed/lost → not workable
  followupOverdue: boolean;  // follow-up date in the past
  hotUncontacted: boolean;   // high intent + no contact in the window
  stalled: boolean;          // no activity in N days
  freshToday: boolean;       // created in the last IST day
}

export interface PipelineSummary {
  workable: number;
  freshToday: number;
  overdueFollowups: number;
  hotUncontacted: number;
  stalled: number;
  byMarket: { India: number; UAE: number; unknown: number };
}

export interface CoachingNudge {
  ownerId: string;
  ownerName: string;
  headline: string;
  overdueFollowups: number;
  hotUncontacted: number;
  stalled: number;
  priority: AiConfidence; // reuse high/medium/low as severity
}

export interface DailyDigest {
  summary: PipelineSummary;
  nudges: CoachingNudge[];
  topRisks: string[]; // human one-liners, most-urgent first
}

const workable = (l: DigestLead) => !l.isTerminal;

export function buildPipelineSummary(leads: DigestLead[]): PipelineSummary {
  const w = leads.filter(workable);
  const byMarket = { India: 0, UAE: 0, unknown: 0 };
  for (const l of w) {
    if (l.market === "India") byMarket.India++;
    else if (l.market === "UAE") byMarket.UAE++;
    else byMarket.unknown++;
  }
  return {
    workable: w.length,
    freshToday: w.filter((l) => l.freshToday).length,
    overdueFollowups: w.filter((l) => l.followupOverdue).length,
    hotUncontacted: w.filter((l) => l.hotUncontacted).length,
    stalled: w.filter((l) => l.stalled).length,
    byMarket,
  };
}

/** Severity: any hot-uncontacted OR ≥5 overdue → high; any overdue OR ≥3 stalled →
 *  medium; else low. Deterministic, explainable. */
function severity(overdue: number, hot: number, stalled: number): AiConfidence {
  if (hot > 0 || overdue >= 5) return "high";
  if (overdue > 0 || stalled >= 3) return "medium";
  return "low";
}

const RANK: Record<AiConfidence, number> = { high: 0, medium: 1, low: 2 };

export function buildCoachingNudges(leads: DigestLead[]): CoachingNudge[] {
  const byOwner = new Map<string, { name: string; leads: DigestLead[] }>();
  for (const l of leads.filter(workable)) {
    if (!l.ownerId) continue; // unassigned rolls up elsewhere, not a coaching target
    const g = byOwner.get(l.ownerId) ?? { name: l.ownerName ?? "Unassigned", leads: [] };
    g.leads.push(l);
    byOwner.set(l.ownerId, g);
  }

  const nudges: CoachingNudge[] = [];
  for (const [ownerId, g] of byOwner) {
    const overdue = g.leads.filter((l) => l.followupOverdue).length;
    const hot = g.leads.filter((l) => l.hotUncontacted).length;
    const stalled = g.leads.filter((l) => l.stalled).length;
    if (overdue === 0 && hot === 0 && stalled === 0) continue; // nothing to coach

    const parts: string[] = [];
    if (hot) parts.push(`${hot} hot lead${hot > 1 ? "s" : ""} uncontacted`);
    if (overdue) parts.push(`${overdue} overdue follow-up${overdue > 1 ? "s" : ""}`);
    if (stalled) parts.push(`${stalled} stalled`);

    nudges.push({
      ownerId,
      ownerName: g.name,
      headline: parts.join(", "),
      overdueFollowups: overdue,
      hotUncontacted: hot,
      stalled,
      priority: severity(overdue, hot, stalled),
    });
  }

  // Most urgent first: by priority, then by total open issues.
  return nudges.sort((a, b) => {
    if (RANK[a.priority] !== RANK[b.priority]) return RANK[a.priority] - RANK[b.priority];
    const ai = a.hotUncontacted + a.overdueFollowups + a.stalled;
    const bi = b.hotUncontacted + b.overdueFollowups + b.stalled;
    return bi - ai;
  });
}

export function buildDailyDigest(leads: DigestLead[]): DailyDigest {
  const summary = buildPipelineSummary(leads);
  const nudges = buildCoachingNudges(leads);

  const topRisks: string[] = [];
  if (summary.hotUncontacted > 0) topRisks.push(`${summary.hotUncontacted} hot lead(s) still uncontacted`);
  if (summary.overdueFollowups > 0) topRisks.push(`${summary.overdueFollowups} overdue follow-up(s) across the team`);
  if (summary.stalled > 0) topRisks.push(`${summary.stalled} lead(s) stalled with no recent activity`);
  if (summary.byMarket.unknown > 0) topRisks.push(`${summary.byMarket.unknown} workable lead(s) with no market set`);

  return { summary, nudges, topRisks };
}
