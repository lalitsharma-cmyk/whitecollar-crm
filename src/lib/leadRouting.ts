import "server-only";
// ─────────────────────────────────────────────────────────────────────────────
// ADMIN-CONTROLLED LEAD ROUTING SCHEDULER — the engine (Lalit 2026-07-17).
//
// Date-windowed routing rules that override the DEFAULT auto-assignment target
// WITHOUT touching ownership logic. The engine is consulted ONLY where the CRM
// auto-assigns today (real-time intake, reconciler orphan sweep, and — when a
// rule explicitly scopes them — converts/imports). Manual assignment paths never
// call it, so a human picking an owner ALWAYS wins.
//
// NO CRON: activation + expiry are intrinsic. A rule is "live" iff NOW is inside
// [startsAt, endsAt ?? ∞) and it is active/not-disabled — evaluated at assign
// time on every call. Nothing here may ever depend on a scheduled job (GitHub-
// Actions crons are intentionally disabled).
//
// PRIORITY MODEL (Lalit's spec): Manual > Date-based > Source-based > Team-based
// > Default. Manual wins structurally (manual paths never consult the engine).
// Among matching RULES the admin encodes Date > Source > Team via the numeric
// `priority` field — LOWER runs first. The UI suggests: date-window rules 10,
// source rules 50, team rules 90 (default 100). Ties break by newest createdAt.
//
// EMERGENCY PAUSE: the "routingPause" Setting ("true"/"false"). While paused,
// applyRouting() returns { paused: true } and every auto-assign caller must
// leave the lead UNASSIGNED ("all leads remain unassigned until manually
// distributed"). Manual assignment is unaffected by the pause.
//
// FAIL-OPEN: any engine error logs + returns null so the caller falls back to
// the existing default assignment — routing can never break lead creation.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from "@/lib/prisma";
import { getSetting, setSetting } from "@/lib/settings";
import { getOnLeaveAgentIds } from "@/lib/leave";
import { budgetMatches, parseBudgetCondition, type BudgetCondition, type BudgetState } from "@/lib/budgetRouting";
import type { Prisma } from "@prisma/client";

// ── Canonical vocabulary ─────────────────────────────────────────────────────

/** Where in the CRM a record is being auto-assigned from. */
export const ROUTING_MODULES = [
  "lead-intake",     // Website + API + Meta + email intake, quick-add w/o owner
  "master-convert",  // Master Data → active lead moves
  "buyer-convert",   // Buyer Data → lead conversions
  "revival-promote", // Revival/cold-data promotions to active lead
  "import",          // CSV / Google-Sheet bulk imports
] as const;
export type RoutingModule = (typeof ROUTING_MODULES)[number];

export const ROUTING_MODULE_LABELS: Record<RoutingModule, string> = {
  "lead-intake": "Website + API intake",
  "master-convert": "Master Data converts",
  "buyer-convert": "Buyer converts",
  "revival-promote": "Revival promotions",
  "import": "Imports",
};

export const ROUTING_STRATEGIES = ["single", "round_robin", "weighted"] as const;
export type RoutingStrategy = (typeof ROUTING_STRATEGIES)[number];

export const ROUTING_STRATEGY_LABELS: Record<RoutingStrategy, string> = {
  single: "Single",
  round_robin: "Round Robin",
  weighted: "Weighted %",
};

/** Every rule-applied Assignment.reason / Lead.routingReason starts with this —
 *  dashboards count "assigned by rule today" by this prefix. Do not change. */
export const ROUTING_REASON_PREFIX = "Rule: ";

/** Setting key for the global emergency pause ("true" = paused). Unset/"" =
 *  not paused (getSetting returns "" for unknown keys — safe default). */
export const ROUTING_PAUSE_KEY = "routingPause";

// ── Json shapes (scope / recipients) ─────────────────────────────────────────
// scope Json: every key optional; a NON-EMPTY array is a constraint the incoming
// record must satisfy; empty/missing keys are wildcards; {} or { all: true }
// matches every auto-assigned record.
export interface RoutingScope {
  all?: boolean;
  modules?: string[];   // RoutingModule values
  teams?: string[];     // "India" | "Dubai"
  markets?: string[];   // "India" | "UAE"
  sources?: string[];   // LeadSource enum keys (WEBSITE, FACEBOOK_ADS, …)
  projects?: string[];  // Project Master names (case-insensitive)
  countries?: string[]; // client country strings (case-insensitive)
  budget?: BudgetCondition; // { op, min?, max? } — currency implied by the single team
}

/** recipients Json: ordered array. `weight` only meaningful for "weighted"
 *  (percentages summing to 100). `assigned` = per-recipient applied count,
 *  kept INSIDE the Json and updated atomically with every pick. */
export interface RoutingRecipient {
  userId: string;
  weight?: number;
  assigned?: number;
}

/** The lead-ish input a choke point hands the matcher. Only `module` is
 *  required; null/undefined fields simply fail any constraint that needs them. */
export interface RoutingContext {
  module: RoutingModule;
  team?: string | null;    // forwardedTeam ("India" | "Dubai")
  /** The record's CURRENT owner, if any. When this resolves to an owner who is
   *  eligible for `team`, resolveAutoAssignOwner returns { kind: "preserved" } and
   *  routing never runs — a metadata correction must not steal a working owner
   *  (Lalit P0, 2026-07-23). */
  currentOwnerId?: string | null;
  market?: string | null;  // Lead.market ("India" | "UAE")
  source?: string | null;  // LeadSource enum key
  project?: string | null; // matched/inquired project name
  country?: string | null; // client country
  budget?: number | null;      // lead routing budget in its currency (budgetMin ?? budgetMax)
  budgetState?: BudgetState;   // available | blank | invalid (from leadRoutingBudget)
}

/** Minimal rule shape the pure matcher needs (matches the Prisma row). */
export interface RoutingRuleLike {
  id: string;
  name: string;
  active: boolean;
  priority: number;
  startsAt: Date;
  endsAt: Date | null;
  scope: Prisma.JsonValue;
  recipients: Prisma.JsonValue;
  strategy: string;
  rrCursor: number;
  assignedCount: number;
  disabledAt: Date | null;
  createdAt: Date;
}

export type RoutingDecision =
  | { paused: true }
  | {
      paused: false;
      ownerId: string;
      ownerName: string;
      ruleId: string;
      ruleName: string;
      /** e.g. `Rule: Diwali-week India → Round Robin (Yasir Khan)` */
      reason: string;
    };

// ── Tolerant Json parsing (a malformed rule must never crash intake) ─────────

function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim().length > 0).map((x) => x.trim());
}

export function parseScope(json: Prisma.JsonValue | null | undefined): RoutingScope {
  if (!json || typeof json !== "object" || Array.isArray(json)) return {};
  const o = json as Record<string, unknown>;
  const budget = parseBudgetCondition(o.budget) ?? undefined;
  return {
    all: o.all === true,
    modules: strArray(o.modules),
    teams: strArray(o.teams),
    markets: strArray(o.markets),
    sources: strArray(o.sources),
    projects: strArray(o.projects),
    countries: strArray(o.countries),
    ...(budget ? { budget } : {}),
  };
}

export function parseRecipients(json: Prisma.JsonValue | null | undefined): RoutingRecipient[] {
  if (!Array.isArray(json)) return [];
  const out: RoutingRecipient[] = [];
  for (const e of json) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue;
    const o = e as Record<string, unknown>;
    if (typeof o.userId !== "string" || !o.userId.trim()) continue;
    const weight = typeof o.weight === "number" && isFinite(o.weight) && o.weight > 0 ? o.weight : undefined;
    const assigned = typeof o.assigned === "number" && isFinite(o.assigned) && o.assigned >= 0 ? Math.floor(o.assigned) : 0;
    out.push({ userId: o.userId.trim(), weight, assigned });
  }
  return out;
}

// ── Pure matching (unit-testable, no IO) ─────────────────────────────────────

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Case-insensitive "value ∈ constraint list". Empty constraint = wildcard. */
function inList(constraint: string[] | undefined, value: string | null | undefined): boolean {
  if (!constraint || constraint.length === 0) return true; // no constraint
  const v = norm(value);
  if (!v) return false; // constrained, but the record carries no value → no match
  return constraint.some((c) => norm(c) === v);
}

/** True when NOW is inside the rule's live window and it isn't disabled. */
export function ruleIsLive(rule: Pick<RoutingRuleLike, "active" | "disabledAt" | "startsAt" | "endsAt">, now: Date = new Date()): boolean {
  if (!rule.active || rule.disabledAt) return false;
  if (rule.startsAt.getTime() > now.getTime()) return false;         // scheduled, not yet live
  if (rule.endsAt && now.getTime() >= rule.endsAt.getTime()) return false; // expired
  return true;
}

/** Every NON-EMPTY scope constraint must match. `{ all: true }` / `{}` match all.
 *  NOTE: a budget condition is ALWAYS enforced even under `all:true` — "all leads
 *  with budget below ₹1Cr" is a valid rule; `all` only skips the categorical
 *  constraints. */
export function scopeMatches(scope: RoutingScope, ctx: RoutingContext): boolean {
  // Budget is checked first (it's the only constraint that survives `all:true`).
  if (scope.budget && !budgetMatches(scope.budget, {
    value: ctx.budget ?? null,
    state: ctx.budgetState ?? (ctx.budget != null ? "available" : "blank"),
  })) return false;
  if (scope.all === true) return true;
  if (!inList(scope.modules, ctx.module)) return false;
  if (!inList(scope.teams, ctx.team)) return false;
  if (!inList(scope.markets, ctx.market)) return false;
  if (!inList(scope.sources, ctx.source)) return false;
  if (!inList(scope.projects, ctx.project)) return false;
  if (!inList(scope.countries, ctx.country)) return false;
  return true;
}

/** Rule specificity = how many scope dimensions it constrains. Used as a tiebreak
 *  so, at EQUAL admin priority, a "budget + source + date" rule beats a bare
 *  "budget" rule (spec §6 "most specific rule first"). Date-window presence is
 *  supplied by the caller since it's not on the scope Json. */
export function scopeSpecificity(scope: RoutingScope, hasDateWindow = false): number {
  let n = 0;
  if (scope.budget) n++;
  if (scope.sources && scope.sources.length) n++;
  if (scope.projects && scope.projects.length) n++;
  if (scope.countries && scope.countries.length) n++;
  if (scope.modules && scope.modules.length) n++;
  if (scope.markets && scope.markets.length) n++;
  if (scope.teams && scope.teams.length) n++;
  if (hasDateWindow) n++;
  return n;
}

/**
 * THE matcher. Filters `rules` to live + scope-matching, then picks the winner:
 * priority ASC (lower runs first), tie → newest createdAt. Returns null when no
 * rule matches (caller falls back to the default assignment logic).
 *
 * Date > Source > Team is encoded BY THE ADMIN via the priority numbers (the UI
 * suggests 10 / 50 / 90) — the engine itself is deliberately mechanical.
 */
export function matchRoutingRule<T extends RoutingRuleLike>(
  ctx: RoutingContext,
  rules: T[],
  now: Date = new Date(),
): T | null {
  const live = rules.filter((r) => ruleIsLive(r, now) && scopeMatches(parseScope(r.scope), ctx));
  if (live.length === 0) return null;
  // priority ASC → then MORE-SPECIFIC first (a budget+source+date rule beats a
  // bare budget rule at the same priority) → then newest.
  live.sort((a, b) =>
    (a.priority - b.priority) ||
    (scopeSpecificity(parseScope(b.scope), !!b.endsAt) - scopeSpecificity(parseScope(a.scope), !!a.endsAt)) ||
    (b.createdAt.getTime() - a.createdAt.getTime()));
  return live[0];
}

// ── Rule display status (list API / page / widget share this) ────────────────

export type RuleStatus = "Active" | "Scheduled" | "Expired" | "Disabled" | "Deleted";

export function computeRuleStatus(
  rule: Pick<RoutingRuleLike, "active" | "disabledAt" | "startsAt" | "endsAt">,
  opts?: { now?: Date; deleted?: boolean },
): RuleStatus {
  const now = opts?.now ?? new Date();
  if (opts?.deleted) return "Deleted";
  if (!rule.active || rule.disabledAt) return "Disabled";
  if (rule.startsAt.getTime() > now.getTime()) return "Scheduled";
  if (rule.endsAt && now.getTime() >= rule.endsAt.getTime()) return "Expired";
  return "Active";
}

// ── Global pause ─────────────────────────────────────────────────────────────

/** True while the admin emergency override is on. Read at assign time on every
 *  call — flipping the setting takes effect on the very next lead. */
export async function isRoutingPaused(): Promise<boolean> {
  const raw = await getSetting(ROUTING_PAUSE_KEY);
  return raw.toLowerCase() === "true"; // unset/"" → not paused
}

export async function setRoutingPaused(paused: boolean): Promise<void> {
  await setSetting(ROUTING_PAUSE_KEY, paused ? "true" : "false");
}

// ── DB helpers ───────────────────────────────────────────────────────────────

/** Rules that could possibly be live right now (window + active). Uses the
 *  @@index([active, startsAt]). Zero rules defined → empty array, one cheap query. */
export async function loadCandidateRules(now: Date = new Date()) {
  return prisma.routingRule.findMany({
    where: {
      active: true,
      disabledAt: null,
      startsAt: { lte: now },
      OR: [{ endsAt: null }, { endsAt: { gt: now } }],
    },
  });
}

/**
 * Atomically pick a recipient from `rule` honoring its strategy, skipping
 * recipients who are inactive / HR-only / on leave today (the existing
 * `agentsOnLeave` mechanism — same one leave-cover uses).
 *
 * RACE-SAFETY: the whole read-pick-write runs in ONE interactive transaction
 * that first takes a row lock (SELECT … FOR UPDATE) on the rule, so two leads
 * arriving simultaneously can never read the same rrCursor or clobber each
 * other's per-recipient counts. Counters updated on success:
 *   • rule.assignedCount += 1
 *   • rule.rrCursor += 1 (round_robin only)
 *   • recipients[i].assigned += 1 (inside the recipients Json)
 *
 * Strategies:
 *   single      → recipients[0] only; ineligible → null (caller falls back).
 *   round_robin → cursor % eligible.length over ELIGIBLE recipients in array
 *                 order (an on-leave recipient is skipped; the wheel advances).
 *   weighted    → deterministic weight-deficit: pick the eligible recipient with
 *                 the largest (weight/totalWeight − assigned/totalAssigned).
 *                 Percentages are weights summing to 100. Ties → higher weight,
 *                 then array order.
 *
 * Returns null when no eligible recipient exists (rule mis-configured or
 * everyone on leave) — the caller then uses the default assignment logic.
 */
export async function pickRecipient(
  ruleId: string,
  now: Date = new Date(),
): Promise<{ userId: string; userName: string; strategy: RoutingStrategy } | null> {
  const onLeave = await getOnLeaveAgentIds(now);

  return prisma.$transaction(async (tx) => {
    // Row lock — serializes concurrent picks on the same rule.
    await tx.$queryRaw`SELECT "id" FROM "RoutingRule" WHERE "id" = ${ruleId} FOR UPDATE`;

    const rule = await tx.routingRule.findUnique({ where: { id: ruleId } });
    if (!rule || !ruleIsLive(rule, now)) return null;

    const recipients = parseRecipients(rule.recipients);
    if (recipients.length === 0) return null;

    // Eligibility: real, active, non-HR users not on leave today.
    const users = await tx.user.findMany({
      where: { id: { in: recipients.map((r) => r.userId) }, active: true, hrOnly: false },
      select: { id: true, name: true },
    });
    const usable = new Map(users.map((u) => [u.id, u] as const));
    const eligible = recipients.filter((r) => usable.has(r.userId) && !onLeave.has(r.userId));

    const strategy: RoutingStrategy =
      rule.strategy === "single" || rule.strategy === "weighted" ? rule.strategy : "round_robin";

    let chosen: RoutingRecipient | null = null;
    let nextCursor = rule.rrCursor;

    if (strategy === "single") {
      // Spec: single = the FIRST listed recipient; on leave/inactive → fall
      // through to default logic (no silent substitute).
      const first = recipients[0];
      chosen = first && usable.has(first.userId) && !onLeave.has(first.userId) ? first : null;
    } else if (strategy === "weighted") {
      if (eligible.length > 0) {
        const weightOf = (r: RoutingRecipient) => (r.weight && r.weight > 0 ? r.weight : 1);
        const totalW = eligible.reduce((s, r) => s + weightOf(r), 0);
        const totalA = eligible.reduce((s, r) => s + (r.assigned ?? 0), 0);
        let bestDeficit = -Infinity;
        let bestWeight = -Infinity;
        for (const r of eligible) {
          const w = weightOf(r) / totalW;
          const share = totalA > 0 ? (r.assigned ?? 0) / totalA : 0;
          const deficit = w - share;
          if (deficit > bestDeficit + 1e-9 || (Math.abs(deficit - bestDeficit) <= 1e-9 && w > bestWeight + 1e-9)) {
            bestDeficit = deficit;
            bestWeight = w;
            chosen = r;
          }
        }
      }
    } else {
      // round_robin — cursor walks the ELIGIBLE list so on-leave members are
      // skipped and the wheel still advances one step per applied lead.
      if (eligible.length > 0) {
        chosen = eligible[((rule.rrCursor % eligible.length) + eligible.length) % eligible.length];
        nextCursor = rule.rrCursor + 1;
      }
    }

    if (!chosen) return null;
    const chosenId = chosen.userId;

    const updatedRecipients = recipients.map((r) =>
      r.userId === chosenId ? { ...r, assigned: (r.assigned ?? 0) + 1 } : r,
    );
    await tx.routingRule.update({
      where: { id: rule.id },
      data: {
        rrCursor: nextCursor,
        assignedCount: { increment: 1 },
        recipients: updatedRecipients as unknown as Prisma.InputJsonValue,
      },
    });

    return { userId: chosenId, userName: usable.get(chosenId)!.name, strategy };
  });
}

// ── The one-call entry point for choke points ────────────────────────────────

/**
 * applyRouting — consult pause + rules for one auto-assign event.
 *
 *   { paused: true }                    → leave the record UNASSIGNED (emergency
 *                                         override; do NOT fall back to default).
 *   { paused: false, ownerId, reason…}  → assign to ownerId; stamp
 *                                         routingMethod="rule" + reason.
 *   null                                → no rule matched (or no eligible
 *                                         recipient / engine error) → caller runs
 *                                         its EXISTING default logic unchanged.
 *
 * With ZERO rules defined and the pause off this is: one Setting read + one
 * indexed empty findMany → null. The caller's default path then behaves exactly
 * as today.
 */
export async function applyRouting(ctx: RoutingContext, now: Date = new Date()): Promise<RoutingDecision | null> {
  try {
    if (await isRoutingPaused()) return { paused: true };

    const rules = await loadCandidateRules(now);
    if (rules.length === 0) return null;

    const rule = matchRoutingRule(ctx, rules, now);
    if (!rule) return null;

    const pick = await pickRecipient(rule.id, now);
    if (!pick) return null; // no eligible recipient → default logic

    return {
      paused: false,
      ownerId: pick.userId,
      ownerName: pick.userName,
      ruleId: rule.id,
      ruleName: rule.name,
      reason: `${ROUTING_REASON_PREFIX}${rule.name} → ${ROUTING_STRATEGY_LABELS[pick.strategy]} (${pick.userName})`,
    };
  } catch (err) {
    // FAIL-OPEN: routing must never block or break lead creation/assignment.
    console.error("[leadRouting] applyRouting failed — falling back to default assignment", err);
    return null;
  }
}
