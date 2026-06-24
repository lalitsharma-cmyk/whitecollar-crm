// ────────────────────────────────────────────────────────────────────────────
// buyerDistribution.ts — the shared, rule-based engine for distributing Admin-Pool
// buyers to agents. Powers BOTH:
//   • the AI Distribution console actions (assign-N / split-equally / by-region),
//     which PREVIEW (plan) then CONFIRM (apply), mirroring the safe /admin/assistant
//     pattern — NO LLM, fully deterministic, and
//   • the daily auto-distribution cron (idempotent + toggle-gated).
//
// DESIGN
//   • Only ADMIN_POOL, non-deleted buyers are ever eligible — CONVERTED / ASSIGNED /
//     REJECTED / soft-deleted buyers are never touched.
//   • Selection is oldest-first (createdAt asc) by default — the longest-waiting pool
//     buyers go out first ("unworked-first" is the same ordering since pool buyers
//     carry attemptCount 0 until assigned).
//   • plan*() functions are PURE-ish reads: they compute "which buyer → which agent"
//     WITHOUT mutating, so the UI can show counts-per-agent before applying.
//   • applyPlan() runs each assignment through assignBuyerInTx (stint + BuyerActivity +
//     ownership) inside its own transaction, then fires ONE summary notification per
//     agent — exactly like the bulk /assign endpoint. Returns per-agent counts.
//
// This module is server-side (imports prisma) but has no "server-only" pragma so the
// regression harness + the E2E proof can import the pure planners.
// ────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { notify } from "@/lib/notify";
import { assignBuyerInTx, BUYER_POOL_STATUS } from "@/lib/buyerLifecycle";
import { inferBuyerCurrency } from "@/lib/buyerIntelligence";
import { DUBAI_MARKET } from "@/lib/buyerScope";

// ── eligible-pool helpers ────────────────────────────────────────────────────

/** The where-fragment for "an assignable Admin-Pool buyer": in the DUBAI market,
 *  in the pool, with no owner, not converted/rejected, not soft-deleted. The
 *  single source of truth so the preview, the apply, and the cron can never
 *  diverge on what's eligible — and this Dubai module only ever distributes
 *  Dubai-market buyers (a future Gurgaon module distributes its own market). */
export function poolableWhere(extra?: Record<string, unknown>) {
  return {
    market: DUBAI_MARKET,
    poolStatus: BUYER_POOL_STATUS.ADMIN_POOL,
    ownerId: null,
    deletedAt: null,
    ...(extra ?? {}),
  };
}

/** Count of buyers currently sitting in the Admin Pool (optionally region-filtered). */
export async function poolCount(extra?: Record<string, unknown>): Promise<number> {
  return prisma.buyerRecord.count({ where: poolableWhere(extra) });
}

// Minimal buyer shape a plan needs.
type PoolBuyer = {
  id: string;
  clientName: string;
  nationality: string | null;
  projectName: string | null;
  source: string | null;
  createdAt: Date;
};

const POOL_SELECT = { id: true, clientName: true, nationality: true, projectName: true, source: true, createdAt: true } as const;

/** Load up to `take` oldest pool buyers (optionally region-filtered). */
async function loadPool(take: number, extra?: Record<string, unknown>): Promise<PoolBuyer[]> {
  if (take <= 0) return [];
  return prisma.buyerRecord.findMany({
    where: poolableWhere(extra),
    orderBy: { createdAt: "asc" }, // oldest / longest-waiting first
    take,
    select: POOL_SELECT,
  });
}

// ── region filter ────────────────────────────────────────────────────────────
// "Region" for a buyer is inferred from nationality / project / source (the buyer
// sheets rarely carry an explicit country column) via the SAME inferBuyerCurrency
// signal the rest of the module uses: INR ⇒ India market, AED ⇒ UAE/Dubai market.
// A free-text region string is matched leniently against that inferred market plus
// raw substrings (so "Dubai" / "UAE" / "India" / a city all work).

export type BuyerRegion = "Dubai" | "UAE" | "India" | string;

/** Build a Prisma where-fragment that narrows the pool to a region. Returns {} for a
 *  blank region (no narrowing). Uses inferBuyerCurrency-style signals expressed as
 *  case-insensitive OR contains across nationality/projectName/source. */
export function regionWhere(region?: string | null): Record<string, unknown> {
  const r = (region ?? "").trim().toLowerCase();
  if (!r) return {};
  // Canonical token sets per market.
  const UAE = ["uae", "dubai", "emirat", "abu dhabi", "sharjah", "ajman"];
  const INDIA = ["india", "indian", "mumbai", "gurgaon", "gurugram", "delhi", "noida", "bengaluru", "bangalore", "pune", "hyderabad", "chennai"];
  let tokens: string[];
  if (UAE.some((t) => r.includes(t)) || r === "uae" || r === "dubai") tokens = UAE;
  else if (INDIA.some((t) => r.includes(t)) || r === "india") tokens = INDIA;
  else tokens = [r]; // arbitrary region string → literal contains match
  const ors = tokens.flatMap((t) => [
    { nationality: { contains: t, mode: "insensitive" as const } },
    { projectName: { contains: t, mode: "insensitive" as const } },
    { source: { contains: t, mode: "insensitive" as const } },
  ]);
  return { OR: ors };
}

// ── active-agent roster ──────────────────────────────────────────────────────

export type DistAgent = { id: string; name: string; team: string | null };

/** Active users eligible to receive DUBAI buyers: Dubai-team AGENT/MANAGER PLUS
 *  admins (any team — admins can hold any market's buyers). India/Gurgaon-team +
 *  HR/non-sales users are EXCLUDED (this is the Dubai module). `team` may further
 *  narrow within the allowed set (the daily cron's optional team scope) but can
 *  never widen it beyond Dubai-assignable. */
export async function activeAgents(team?: string | null): Promise<DistAgent[]> {
  const rows = await prisma.user.findMany({
    where: {
      active: true,
      hrOnly: false,
      OR: [
        { team: "Dubai", role: { in: ["AGENT", "MANAGER"] } },
        { role: "ADMIN" },
      ],
    },
    select: { id: true, name: true, team: true },
    orderBy: { name: "asc" },
  });
  // Optional extra team narrowing (cron scope). Only ever narrows within the
  // Dubai-assignable set already selected above.
  return team ? rows.filter((r) => r.team === team) : rows;
}

// ── plan types ───────────────────────────────────────────────────────────────

export type AgentPlanRow = { agentId: string; agentName: string; buyerIds: string[]; count: number };
export type DistributionPlan = {
  rows: AgentPlanRow[];      // per-agent assignment plan (only agents that got ≥1)
  totalAssigned: number;     // Σ count
  poolAvailable: number;     // how many pool buyers existed at plan time
  shortfall: number;         // requested but unfulfilled (pool smaller than ask)
  note?: string;             // human explanation for the preview
};

/** Empty plan helper. */
function emptyPlan(poolAvailable: number, note: string): DistributionPlan {
  return { rows: [], totalAssigned: 0, poolAvailable, shortfall: 0, note };
}

// ── planners ─────────────────────────────────────────────────────────────────

/**
 * Plan: assign N pool buyers to ONE agent (oldest-first), optionally region-filtered.
 * Pure read — computes the buyer-id list without mutating.
 */
export async function planAssignN(
  agent: DistAgent,
  n: number,
  region?: string | null,
): Promise<DistributionPlan> {
  const extra = regionWhere(region);
  const available = await poolCount(extra);
  const want = Math.max(0, Math.floor(n));
  if (want === 0) return emptyPlan(available, "Nothing to assign (N = 0).");
  const buyers = await loadPool(want, extra);
  const buyerIds = buyers.map((b) => b.id);
  const shortfall = Math.max(0, want - buyerIds.length);
  const regionLabel = (region ?? "").trim() ? ` ${(region as string).trim()}` : "";
  return {
    rows: buyerIds.length ? [{ agentId: agent.id, agentName: agent.name, buyerIds, count: buyerIds.length }] : [],
    totalAssigned: buyerIds.length,
    poolAvailable: available,
    shortfall,
    note: `Assign ${buyerIds.length}${regionLabel} pool buyer${buyerIds.length === 1 ? "" : "s"} to ${agent.name}${shortfall ? ` (asked for ${want}, only ${buyerIds.length} in pool)` : ""}.`,
  };
}

/**
 * Plan: split the pool equally (round-robin) across the given agents, optionally
 * region-filtered, and optionally capped at `limit` total buyers (default = whole
 * eligible pool). Buyers are dealt oldest-first, agent by agent, so the spread is
 * even and deterministic.
 */
export async function planSplitEqually(
  agents: DistAgent[],
  opts?: { region?: string | null; limit?: number },
): Promise<DistributionPlan> {
  const extra = regionWhere(opts?.region);
  const available = await poolCount(extra);
  if (agents.length === 0) return emptyPlan(available, "No agents selected.");
  const cap = opts?.limit && opts.limit > 0 ? Math.min(opts.limit, available) : available;
  if (cap === 0) return emptyPlan(available, "The Admin Pool is empty — nothing to split.");
  const buyers = await loadPool(cap, extra);
  // Round-robin deal.
  const byAgent = new Map<string, string[]>();
  agents.forEach((a) => byAgent.set(a.id, []));
  buyers.forEach((b, i) => {
    const a = agents[i % agents.length];
    byAgent.get(a.id)!.push(b.id);
  });
  const rows: AgentPlanRow[] = agents
    .map((a) => ({ agentId: a.id, agentName: a.name, buyerIds: byAgent.get(a.id)!, count: byAgent.get(a.id)!.length }))
    .filter((r) => r.count > 0);
  const total = rows.reduce((s, r) => s + r.count, 0);
  const regionLabel = (opts?.region ?? "").trim() ? ` ${(opts!.region as string).trim()}` : "";
  return {
    rows,
    totalAssigned: total,
    poolAvailable: available,
    shortfall: 0,
    note: `Split ${total}${regionLabel} pool buyer${total === 1 ? "" : "s"} evenly across ${rows.length} agent${rows.length === 1 ? "" : "s"} (round-robin).`,
  };
}

// ── apply ────────────────────────────────────────────────────────────────────

export type ApplyResult = {
  ok: true;
  totalAssigned: number;
  perAgent: { agentId: string; agentName: string; assigned: number }[];
};

/**
 * Apply a plan: assign each buyer to its planned agent (each via assignBuyerInTx, so
 * a stint + BuyerActivity + ownership are written atomically), then notify each agent
 * ONCE with a summary. `assignedById` = the admin/manager (or null for the system cron).
 * Re-checks each buyer is still in the pool at apply time (defends against a buyer that
 * was assigned/converted between preview and confirm — it's silently skipped).
 * Returns per-agent applied counts (may be < planned if some became ineligible).
 */
export async function applyPlan(
  plan: DistributionPlan,
  assignedById: string | null,
  opts?: { reason?: string; silent?: boolean },
): Promise<ApplyResult> {
  const perAgent: { agentId: string; agentName: string; assigned: number }[] = [];
  let total = 0;

  for (const row of plan.rows) {
    let applied = 0;
    for (const buyerId of row.buyerIds) {
      // Re-verify the buyer is still an assignable pool buyer (no race).
      const fresh = await prisma.buyerRecord.findUnique({
        where: { id: buyerId },
        select: { poolStatus: true, ownerId: true, deletedAt: true },
      });
      if (!fresh || fresh.deletedAt || fresh.ownerId || fresh.poolStatus !== BUYER_POOL_STATUS.ADMIN_POOL) continue;
      await prisma.$transaction(async (tx) => {
        await assignBuyerInTx(tx, buyerId, row.agentId, assignedById);
      });
      applied++;
    }
    if (applied > 0) {
      perAgent.push({ agentId: row.agentId, agentName: row.agentName, assigned: applied });
      total += applied;
      // ONE summary notification per agent (avoids N pushes), unless silent.
      if (!opts?.silent) {
        await notify({
          userId: row.agentId,
          kind: "LEAD_ASSIGNED",
          severity: "INFO",
          title: applied === 1 ? `🏷️ A buyer was assigned to you` : `🏷️ ${applied} buyers assigned to you`,
          body: `${applied} buyer${applied === 1 ? "" : "s"} from the Admin Pool ${applied === 1 ? "is" : "are"} now yours in Dubai Buyer Data${opts?.reason ? ` — ${opts.reason}` : ""}.`,
          linkUrl: "/buyer-data",
        }).catch(() => null);
      }
    }
  }

  return { ok: true, totalAssigned: total, perAgent };
}

// ── currency/region label (for the preview UI) ───────────────────────────────

/** Infer a coarse region label for a single buyer (for preview display only). */
export function buyerRegionLabel(b: { nationality?: string | null; projectName?: string | null; source?: string | null }): string {
  const ccy = inferBuyerCurrency(b);
  if (ccy === "INR") return "India";
  if (ccy === "AED") return "Dubai / UAE";
  return "—";
}

// ── daily auto-distribution (cron) ───────────────────────────────────────────

export type DailyDistributeResult = {
  ran: boolean;            // false ⇒ skipped (toggle off / empty pool / no agents)
  reason?: string;         // why it skipped
  totalAssigned: number;
  perAgent: { agentId: string; agentName: string; assigned: number }[];
};

/**
 * The daily auto-distribution job: round-robin EVERY Admin-Pool buyer across the
 * active team (optionally scoped to one team). Idempotent + safe:
 *   • Reads the toggle (getBuyerAutoDistribute). When OFF → does nothing.
 *   • Only ADMIN_POOL, non-deleted buyers are eligible (poolableWhere) — already
 *     assigned/converted buyers are never touched, so re-running the same day only
 *     ever distributes the *remaining* pool (no double-assign).
 *   • assignedById = null (system). Each agent still gets ONE summary notification.
 * Returns a structured result for the cron-health row.
 *
 * `dryRun` plans without applying (used by the cron's ?dryRun=1 verification path).
 */
export async function runBuyerDailyDistribute(opts?: { dryRun?: boolean }): Promise<DailyDistributeResult> {
  const { getBuyerAutoDistribute } = await import("@/lib/settings");
  const cfg = await getBuyerAutoDistribute();
  if (!cfg.enabled) return { ran: false, reason: "toggle off", totalAssigned: 0, perAgent: [] };

  const team = cfg.team || null;
  const agents = await activeAgents(team);
  if (agents.length === 0) return { ran: false, reason: team ? `no active agents on team ${team}` : "no active agents", totalAssigned: 0, perAgent: [] };

  const available = await poolCount();
  if (available === 0) return { ran: false, reason: "empty pool", totalAssigned: 0, perAgent: [] };

  const plan = await planSplitEqually(agents);
  if (opts?.dryRun) {
    return {
      ran: true,
      reason: "dry-run",
      totalAssigned: plan.totalAssigned,
      perAgent: plan.rows.map((r) => ({ agentId: r.agentId, agentName: r.agentName, assigned: r.count })),
    };
  }

  const result = await applyPlan(plan, null, { reason: "Daily auto-distribution" });
  return { ran: true, totalAssigned: result.totalAssigned, perAgent: result.perAgent };
}
