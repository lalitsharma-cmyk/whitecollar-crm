// Reverse-inventory matching — given a project, surface ACTIVE-pipeline leads
// whose stated preferences make them worth pitching this project to.
//
// This is the inverse of bestUnitsForLead() in ./inventoryMatch.ts. We mirror
// its budget/team-geography filtering, but the scoring constants here are
// project-side specific (per spec §9.8) and are intentionally NOT shared from
// inventoryMatch.ts — the lead→unit scorer uses a different weighting (config
// match, price-fit curve) that doesn't apply when we don't have a single unit
// to compare against. Comment block kept inline so future devs don't try to
// DRY this with the wrong helper.
//
// Scoring (per spec §9.8):
//   • budget overlap (lead.budgetMin within ±30% of project's median unit
//     priceBase)                            → +50
//   • aiScore == HOT                        → +20
//   • aiScore == WARM                       → +10
//   • lead.city matches project.city/area   → +15
//
// Filtering (BEFORE scoring):
//   • lead.status IN (NEW, CONTACTED, QUALIFIED, SITE_VISIT, NEGOTIATION)
//   • team match: project.country "India" → lead.forwardedTeam "India";
//                 project.country "UAE"/"Dubai" → lead.forwardedTeam "Dubai"
//   • lead.budgetMin present (>0) — we skip leads with no stated budget
//   • not already attached to any unit of this project via LeadProperty
//     (avoid double-pitching the same prospect)
//
// Two entry points, ONE ranking implementation (scoreAndRank — keeps their
// output semantics in lockstep):
//   • bestLeadsForProject()  — single project (project detail page).
//   • bestLeadsForProjects() — BATCH for list pages. PERF CONTRACT: bounded
//     queries, not per-project — see the function's own comment.

import { prisma } from "@/lib/prisma";
import { AIScore, Prisma } from "@prisma/client";
import { ACTIVE_PURSUIT_STATUSES } from "@/lib/lead-statuses";

export type SuggestedLead = {
  leadId: string;
  leadName: string;
  budget: number;
  currency: string;
  aiScore: AIScore | null;
  score: number;
};

// Minimal project shape the batch matcher needs — structurally satisfied by a
// full Prisma Project row with `units` included (what the Properties page
// already fetched), so callers never re-fetch the project.
export type ProjectForMatching = {
  id: string;
  city: string | null;
  area: string | null;
  country: string | null;
  units: { id: string; priceBase: number }[];
};

// Lead fields the scorer consumes (subset of Lead — matches the findMany select).
type CandidateLead = {
  id: string;
  name: string;
  budgetMin: number | null;
  budgetCurrency: string;
  aiScore: AIScore | null;
  city: string | null;
};

// Status-based active filter — no stage system.
const ACTIVE_STATUSES = ACTIVE_PURSUIT_STATUSES;

// Score weights — see header comment for spec reference.
const SCORE_BUDGET_MATCH = 50;
const SCORE_HOT = 20;
const SCORE_WARM = 10;
const SCORE_CITY_MATCH = 15;

// Candidate over-fetch per project so AI-score / city tiebreakers have
// something to rank from. Same formula in both entry points.
function poolSize(limit: number): number {
  return Math.min(Math.max(limit * 8, 24), 200);
}

// Lead.forwardedTeam value that should be matched against this project.
function teamForCountry(country?: string | null): string | null {
  if (!country) return null;
  const c = country.toLowerCase();
  if (c === "india") return "India";
  if (c === "uae" || c === "united arab emirates" || c === "dubai") return "Dubai";
  return null;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function normaliseCity(s?: string | null): string {
  return (s ?? "").toLowerCase().trim();
}

// Project-side derivation shared by both entry points: which team pool to
// search + the ±30% budget band around the project's median unit price.
// null = project can't be matched (no team / no priced units) → empty result.
function matchBand(p: {
  country: string | null;
  units: { priceBase: number }[];
}): { team: string; lo: number; hi: number } | null {
  const team = teamForCountry(p.country);
  if (!team) return null;
  const prices = p.units.map((u) => u.priceBase).filter((pr) => pr > 0);
  if (prices.length === 0) return null;
  const medianPrice = median(prices);
  if (medianPrice <= 0) return null;
  // ±30% budget band around the project's median unit price.
  return { team, lo: medianPrice * 0.7, hi: medianPrice * 1.3 };
}

// THE ranking step — shared verbatim by single + batch paths. Candidates MUST
// already be filtered (active/team/band/not-attached) and trimmed to poolSize().
function scoreAndRank(
  leads: CandidateLead[],
  projectCity: string | null | undefined,
  projectArea: string | null | undefined,
  limit: number,
): SuggestedLead[] {
  const pCity = normaliseCity(projectCity);
  const pArea = normaliseCity(projectArea);

  const scored: SuggestedLead[] = leads.map((l) => {
    let score = 0;
    // Budget match — by construction every candidate is in the ±30% band,
    // so award the full budget bonus.
    if (l.budgetMin && l.budgetMin > 0) score += SCORE_BUDGET_MATCH;
    if (l.aiScore === AIScore.HOT) score += SCORE_HOT;
    else if (l.aiScore === AIScore.WARM) score += SCORE_WARM;
    const leadCity = normaliseCity(l.city);
    if (
      leadCity &&
      (leadCity === pCity ||
        (pArea && leadCity === pArea))
    ) {
      score += SCORE_CITY_MATCH;
    }
    return {
      leadId: l.id,
      leadName: l.name,
      budget: l.budgetMin ?? 0,
      currency: l.budgetCurrency,
      aiScore: l.aiScore,
      score,
    };
  });

  // Highest score first; ties broken by larger budget (bigger ticket = better
  // deal to pursue first).
  scored.sort((a, b) => (b.score - a.score) || (b.budget - a.budget));

  return scored.slice(0, limit);
}

export async function bestLeadsForProject(
  projectId: string,
  limit = 5,
  // Ownership scope (from leadScopeWhere): ADMIN → {} (all), MANAGER → own +
  // reports, AGENT → { ownerId: me.id }. Defaults to {} for callers that have
  // already gated access. Without it, an agent's "matching leads" expander
  // would name peers' clients + budgets (audit P2-1).
  scope: Prisma.LeadWhereInput = {},
): Promise<SuggestedLead[]> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      city: true,
      area: true,
      country: true,
      units: { select: { id: true, priceBase: true } },
    },
  });
  if (!project) return [];

  const band = matchBand(project);
  if (!band) return [];

  // Exclude leads already attached to any unit in this project — avoid
  // double-pitching a prospect we're already working on the same project with.
  const unitIds = project.units.map((u) => u.id);
  const alreadyAttached = unitIds.length
    ? await prisma.leadProperty.findMany({
        where: { unitId: { in: unitIds } },
        select: { leadId: true },
      })
    : [];
  const excludeLeadIds = [...new Set(alreadyAttached.map((lp) => lp.leadId))];

  // Pre-filter at DB layer: active pipeline + correct team + budget present
  // and within ±30%. Over-fetch a small pool so AI-score / city tiebreakers
  // have something to rank from.
  const leads = await prisma.lead.findMany({
    where: {
      ...scope,
      deletedAt: null,
      currentStatus: { in: ACTIVE_STATUSES },
      forwardedTeam: band.team,
      budgetMin: { gte: band.lo, lte: band.hi },
      ...(excludeLeadIds.length ? { id: { notIn: excludeLeadIds } } : {}),
    },
    select: {
      id: true,
      name: true,
      budgetMin: true,
      budgetCurrency: true,
      aiScore: true,
      city: true,
    },
    take: poolSize(limit),
    orderBy: { lastTouchedAt: "desc" },
  });
  if (leads.length === 0) return [];

  return scoreAndRank(leads, project.city, project.area, limit);
}

// BATCH variant for list pages. PERF CONTRACT: bounded queries, not
// per-project. The Properties grid used to call bestLeadsForProject() once per
// card (3 queries each → 1+3N; ~60 queries at 20 projects). This resolves the
// SAME output for every project from at most 3 queries total:
//   1. ONE LeadProperty scan over all units of all projects → per-project
//      "already attached" exclusion sets.
//   2. ONE candidate-lead fetch per team present (max 2: India + Dubai),
//      spanning the UNION of that team's project budget bands — identical
//      WHERE to the single-project query except the band is widened (the
//      exact per-project band is re-applied in Node) and there is no `take`.
//      Ordered by lastTouchedAt DESC by the DB, exactly like the per-project
//      query, so Node's filter-then-slice below reproduces the DB's
//      order-then-take: filtering an ordered array preserves order, so each
//      project sees precisely the candidate pool its own query would have
//      returned.
//   3. Zero queries per project — band filter + exclusion + poolSize() trim +
//      the SAME scoreAndRank() as bestLeadsForProject(), all in Node.
// Callers pass project rows they already fetched (no project re-fetch).
export async function bestLeadsForProjects(
  projects: ProjectForMatching[],
  limit = 5,
  // Same ownership scope contract as bestLeadsForProject (audit P2-1).
  scope: Prisma.LeadWhereInput = {},
): Promise<Map<string, SuggestedLead[]>> {
  const out = new Map<string, SuggestedLead[]>();
  for (const p of projects) out.set(p.id, []);

  const eligible: { p: ProjectForMatching; band: { team: string; lo: number; hi: number } }[] = [];
  for (const p of projects) {
    const band = matchBand(p);
    if (band) eligible.push({ p, band });
  }
  if (eligible.length === 0) return out;

  // (1) One LeadProperty scan for ALL projects' units → exclusion set per
  // project (avoid double-pitching a prospect already attached to that project).
  const unitToProject = new Map<string, string>();
  for (const { p } of eligible) for (const u of p.units) unitToProject.set(u.id, p.id);
  const attachedByProject = new Map<string, Set<string>>();
  if (unitToProject.size > 0) {
    const attached = await prisma.leadProperty.findMany({
      where: { unitId: { in: [...unitToProject.keys()] } },
      select: { leadId: true, unitId: true },
    });
    for (const a of attached) {
      const pid = unitToProject.get(a.unitId);
      if (!pid) continue;
      let set = attachedByProject.get(pid);
      if (!set) attachedByProject.set(pid, (set = new Set()));
      set.add(a.leadId);
    }
  }

  // (2) One candidate fetch per team, spanning the union of its bands.
  const teamSpan = new Map<string, { lo: number; hi: number }>();
  for (const { band } of eligible) {
    const s = teamSpan.get(band.team);
    if (!s) teamSpan.set(band.team, { lo: band.lo, hi: band.hi });
    else {
      s.lo = Math.min(s.lo, band.lo);
      s.hi = Math.max(s.hi, band.hi);
    }
  }
  const poolByTeam = new Map<string, CandidateLead[]>();
  await Promise.all(
    [...teamSpan.entries()].map(async ([team, span]) => {
      const rows = await prisma.lead.findMany({
        where: {
          ...scope,
          deletedAt: null,
          currentStatus: { in: ACTIVE_STATUSES },
          forwardedTeam: team,
          budgetMin: { gte: span.lo, lte: span.hi },
        },
        select: {
          id: true,
          name: true,
          budgetMin: true,
          budgetCurrency: true,
          aiScore: true,
          city: true,
        },
        orderBy: { lastTouchedAt: "desc" },
      });
      poolByTeam.set(team, rows);
    }),
  );

  // (3) Per project, in Node: exact band + exclusion on the DB-ordered pool,
  // trim to poolSize(), then the shared ranking.
  const pool = poolSize(limit);
  for (const { p, band } of eligible) {
    const excluded = attachedByProject.get(p.id);
    const teamPool = poolByTeam.get(band.team) ?? [];
    const candidates: CandidateLead[] = [];
    for (const l of teamPool) {
      if (l.budgetMin == null || l.budgetMin < band.lo || l.budgetMin > band.hi) continue;
      if (excluded?.has(l.id)) continue;
      candidates.push(l);
      if (candidates.length >= pool) break; // == the per-project `take`
    }
    out.set(p.id, scoreAndRank(candidates, p.city, p.area, limit));
  }
  return out;
}
