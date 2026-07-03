import { NextResponse, type NextRequest } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { audit, reqMeta } from "@/lib/audit";
import {
  planAssignN,
  planSplitEqually,
  applyPlan,
  activeAgents,
  type DistAgent,
  type DistributionPlan,
} from "@/lib/buyerDistribution";

// ── AI Buyer Distribution — rule-based, preview → confirm ────────────────────
// ADMIN/MANAGER only. NO LLM: a deterministic planner mirrors the safe
// /admin/assistant pattern. Two phases on one endpoint:
//   POST { phase:"preview", mode, ... }  → returns the plan (counts per agent),
//                                           NOTHING is mutated.
//   POST { phase:"apply",  mode, ... }   → re-plans + applies (assign + stint +
//                                           BuyerActivity + per-agent notify).
// Modes:
//   • assignN       { agentId, n, region? }            — N pool buyers → one agent.
//   • splitEqually  { agentIds[], region?, limit? }    — round-robin the pool.
//   • byRegion      { agentId, region }                — region pool → one agent
//                                                        (assignN with n = whole region pool).
// A MANAGER may only target agents inside their org subtree (validated below).

type Mode = "assignN" | "splitEqually" | "byRegion";

async function buildPlan(
  mode: Mode,
  body: Record<string, unknown>,
  roster: DistAgent[],
  market: string,
): Promise<{ plan: DistributionPlan; targetAgentIds: string[]; error?: string }> {
  const byId = new Map(roster.map((a) => [a.id, a]));

  if (mode === "assignN" || mode === "byRegion") {
    const agentId = String(body.agentId ?? "").trim();
    const agent = byId.get(agentId);
    if (!agent) return { plan: null as never, targetAgentIds: [], error: "Pick a valid agent." };
    const region = body.region != null ? String(body.region) : null;
    // byRegion = "send all <region> pool buyers to <agent>" → N = whole region pool.
    let n: number;
    if (mode === "byRegion") {
      const { poolCount, regionWhere } = await import("@/lib/buyerDistribution");
      n = await poolCount(market, regionWhere(region));
    } else {
      n = Math.max(0, Math.floor(Number(body.n) || 0));
    }
    const plan = await planAssignN(agent, n, region, market);
    return { plan, targetAgentIds: [agentId] };
  }

  if (mode === "splitEqually") {
    const rawIds: unknown[] = Array.isArray(body.agentIds) ? body.agentIds : [];
    const ids = Array.from(new Set(rawIds.map((x) => String(x).trim()).filter(Boolean)));
    const agentsList = ids.map((id) => byId.get(id)).filter((a): a is DistAgent => !!a);
    if (agentsList.length === 0) return { plan: null as never, targetAgentIds: [], error: "Pick at least one valid agent to split across." };
    const region = body.region != null ? String(body.region) : null;
    const limit = body.limit != null ? Math.max(0, Math.floor(Number(body.limit) || 0)) : undefined;
    const plan = await planSplitEqually(agentsList, { region, limit, market });
    return { plan, targetAgentIds: agentsList.map((a) => a.id) };
  }

  return { plan: null as never, targetAgentIds: [], error: "Unknown distribution mode." };
}

export async function POST(req: NextRequest) {
  const me = await requireRole("ADMIN", "MANAGER");
  const body = await req.json().catch(() => ({}));
  const phase = String(body.phase ?? "preview").trim();
  const mode = String(body.mode ?? "").trim() as Mode;

  // MARKET-AWARE (both-markets): distribute the Dubai OR India pool. The actor must
  // have access to that market — a Dubai user can't distribute India buyers + vice-versa.
  const market = body.market === "India" ? "India" : "Dubai";
  const { canAccessBuyerMarket } = await import("@/lib/buyerScope");
  if (!canAccessBuyerMarket({ role: me.role, team: me.team }, market)) {
    return NextResponse.json({ ok: false, error: `You don't have access to ${market} Buyer Data.` }, { status: 403 });
  }

  // Roster the actor may assign to — this MARKET's team + admins. MANAGER → their
  // subtree only; ADMIN → all of the market's active agents.
  let roster: DistAgent[];
  if (me.role === "MANAGER") {
    const { visibleBuyerOwnerIds } = await import("@/lib/buyerScope");
    const allowed = await visibleBuyerOwnerIds({ id: me.id, role: me.role, team: me.team });
    const all = await activeAgents(market);
    roster = allowed === null ? all : all.filter((a) => allowed.includes(a.id));
  } else {
    roster = await activeAgents(market);
  }

  const { plan, targetAgentIds, error } = await buildPlan(mode, body, roster, market);
  if (error || !plan) return NextResponse.json({ ok: false, error: error ?? "Could not build a plan." }, { status: 400 });

  // Resolve agent names for the preview rows (already in plan.rows).
  if (phase === "preview") {
    return NextResponse.json({ ok: true, phase: "preview", mode, plan });
  }

  if (phase === "apply") {
    const result = await applyPlan(plan, me.id, { reason: `Distributed by ${me.name}`, market });
    await audit({
      userId: me.id, action: "buyer.distribute", entity: "BuyerRecord",
      meta: { market, mode, totalAssigned: result.totalAssigned, perAgent: result.perAgent, targetAgentIds },
      request: reqMeta(req),
    });
    return NextResponse.json({ phase: "apply", mode, ...result });
  }

  return NextResponse.json({ ok: false, error: "phase must be preview or apply." }, { status: 400 });
}

// Read the daily auto-distribution toggle state + this market's pool size (for the panel).
export async function GET(req: NextRequest) {
  await requireRole("ADMIN", "MANAGER");
  const market = new URL(req.url).searchParams.get("market") === "India" ? "India" : "Dubai";
  const { getBuyerAutoDistribute } = await import("@/lib/settings");
  const cfg = await getBuyerAutoDistribute();
  const { poolCount } = await import("@/lib/buyerDistribution");
  const pool = await poolCount(market);
  return NextResponse.json({ ok: true, autoDistribute: cfg, poolAvailable: pool });
}
