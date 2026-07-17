import "server-only";
// Shared guard + validation + serialization for the /api/admin/routing-rules
// route family. NOT a route file (no route.ts name) — Next ignores it.

import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import type { Prisma, RoutingRule } from "@prisma/client";
import {
  ROUTING_MODULES,
  ROUTING_STRATEGIES,
  type RoutingRecipient,
  type RoutingScope,
  type RoutingStrategy,
  computeRuleStatus,
} from "@/lib/leadRouting";
import { normalizeTeam } from "@/lib/teamRouting";
import { parseBudgetCondition, NUMERIC_BUDGET_OPS, type BudgetCondition } from "@/lib/budgetRouting";

// ── Admin-only guard (403 for any authenticated non-admin, incl. HR-only) ────
export async function requireRoutingAdmin(): Promise<
  | { me: Awaited<ReturnType<typeof requireUser>>; forbidden: null }
  | { me: null; forbidden: NextResponse }
> {
  const me = await requireUser(); // unauthenticated → redirect to /login (codebase standard)
  if (me.role !== "ADMIN" || me.hrOnly) {
    return { me: null, forbidden: NextResponse.json({ error: "Admin only." }, { status: 403 }) };
  }
  return { me, forbidden: null };
}

// ── Body validation ──────────────────────────────────────────────────────────

export interface ParsedRuleBody {
  name: string;
  priority: number;
  startsAt: Date;
  endsAt: Date | null;
  strategy: RoutingStrategy;
  scope: RoutingScope;
  recipients: RoutingRecipient[]; // weights validated; `assigned` NOT set here
}

const MAX_LIST = 100;

function cleanStrList(v: unknown, upper = false): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const e of v) {
    if (typeof e !== "string") continue;
    const s = e.trim().slice(0, 120);
    if (!s) continue;
    out.push(upper ? s.toUpperCase() : s);
    if (out.length >= MAX_LIST) break;
  }
  return [...new Set(out)];
}

/**
 * Validate a create/update payload. Returns { error } (message for a 400) or
 * the parsed rule. `partial` (PATCH) lets absent fields fall back to `existing`.
 */
export async function parseRuleBody(
  body: Record<string, unknown>,
  opts: { existing?: RoutingRule | null },
): Promise<{ error: string } | { rule: ParsedRuleBody }> {
  const ex = opts.existing ?? null;

  // name
  const nameRaw = body.name !== undefined ? String(body.name ?? "").trim() : ex?.name ?? "";
  if (!nameRaw) return { error: "Rule name is required." };
  const name = nameRaw.slice(0, 120);

  // priority
  let priority = ex?.priority ?? 100;
  if (body.priority !== undefined) {
    const p = Number(body.priority);
    if (!Number.isInteger(p) || p < 1 || p > 9999) return { error: "Priority must be a whole number between 1 and 9999 (lower runs first)." };
    priority = p;
  }

  // window
  let startsAt: Date | null = ex?.startsAt ?? null;
  if (body.startsAt !== undefined) {
    const d = new Date(String(body.startsAt));
    if (isNaN(d.getTime())) return { error: "startsAt is not a valid date." };
    startsAt = d;
  }
  if (!startsAt) return { error: "startsAt is required." };

  let endsAt: Date | null = ex ? ex.endsAt : null;
  if (body.endsAt !== undefined) {
    if (body.endsAt === null || body.endsAt === "") {
      endsAt = null; // permanent
    } else {
      const d = new Date(String(body.endsAt));
      if (isNaN(d.getTime())) return { error: "endsAt is not a valid date." };
      endsAt = d;
    }
  }
  if (endsAt && endsAt.getTime() <= startsAt.getTime()) {
    return { error: "End of window must be after its start." };
  }

  // strategy
  let strategy: RoutingStrategy = (ex?.strategy as RoutingStrategy) ?? "round_robin";
  if (body.strategy !== undefined) {
    const s = String(body.strategy);
    if (!(ROUTING_STRATEGIES as readonly string[]).includes(s)) {
      return { error: `strategy must be one of: ${ROUTING_STRATEGIES.join(", ")}.` };
    }
    strategy = s as RoutingStrategy;
  }

  // scope
  let scope: RoutingScope;
  if (body.scope !== undefined) {
    const raw = body.scope;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "scope must be an object." };
    const o = raw as Record<string, unknown>;
    const modules = cleanStrList(o.modules);
    for (const m of modules) {
      if (!(ROUTING_MODULES as readonly string[]).includes(m)) {
        return { error: `Unknown module "${m}". Allowed: ${ROUTING_MODULES.join(", ")}.` };
      }
    }
    const teams: string[] = [];
    for (const t of cleanStrList(o.teams)) {
      const n = normalizeTeam(t);
      if (!n) return { error: `Unknown team "${t}" — use India or Dubai.` };
      if (!teams.includes(n)) teams.push(n);
    }
    // Budget condition (optional). Currency is implied by the team, so a budget
    // rule MUST target exactly ONE team — INR and AED are never compared.
    let budget: BudgetCondition | undefined;
    if (o.budget != null && !(typeof o.budget === "object" && Object.keys(o.budget as object).length === 0)) {
      const parsed = parseBudgetCondition(o.budget);
      if (!parsed) return { error: "Invalid budget condition (check the operator and amounts)." };
      if (NUMERIC_BUDGET_OPS.includes(parsed.op)) {
        if (teams.length !== 1) return { error: "A budget-amount rule must target exactly one team (India or Dubai) so the currency is unambiguous." };
        if (parsed.min == null || parsed.min < 0) return { error: "Budget amount must be a non-negative number." };
        if (parsed.op === "between" && (parsed.max == null || parsed.max < parsed.min)) {
          return { error: "For a Between rule, Maximum must be ≥ Minimum." };
        }
      }
      budget = parsed;
    }
    scope = {
      ...(o.all === true ? { all: true } : {}),
      ...(modules.length ? { modules } : {}),
      ...(teams.length ? { teams } : {}),
      ...(cleanStrList(o.markets).length ? { markets: cleanStrList(o.markets) } : {}),
      ...(cleanStrList(o.sources, true).length ? { sources: cleanStrList(o.sources, true) } : {}),
      ...(cleanStrList(o.projects).length ? { projects: cleanStrList(o.projects) } : {}),
      ...(cleanStrList(o.countries).length ? { countries: cleanStrList(o.countries) } : {}),
      ...(budget ? { budget } : {}),
    };
  } else if (ex) {
    scope = (ex.scope ?? {}) as unknown as RoutingScope;
  } else {
    scope = {};
  }

  // recipients
  let recipients: RoutingRecipient[];
  if (body.recipients !== undefined) {
    if (!Array.isArray(body.recipients) || body.recipients.length === 0) {
      return { error: "At least one recipient is required." };
    }
    if (body.recipients.length > 50) return { error: "Maximum 50 recipients per rule." };
    const seen = new Set<string>();
    recipients = [];
    for (const e of body.recipients) {
      if (!e || typeof e !== "object") return { error: "Each recipient must be { userId, weight? }." };
      const o = e as Record<string, unknown>;
      const userId = String(o.userId ?? "").trim();
      if (!userId) return { error: "Each recipient needs a userId." };
      if (seen.has(userId)) continue; // silently dedupe
      seen.add(userId);
      let weight: number | undefined;
      if (o.weight !== undefined && o.weight !== null && o.weight !== "") {
        const w = Number(o.weight);
        if (!isFinite(w) || w <= 0) return { error: "Recipient weights must be positive numbers." };
        weight = w;
      }
      recipients.push({ userId, ...(weight !== undefined ? { weight } : {}) });
    }
    // Recipients must be real, active, non-HR sales-side users.
    const users = await prisma.user.findMany({
      where: { id: { in: recipients.map((r) => r.userId) }, active: true, hrOnly: false },
      select: { id: true },
    });
    const ok = new Set(users.map((u) => u.id));
    const missing = recipients.filter((r) => !ok.has(r.userId));
    if (missing.length > 0) {
      return { error: `${missing.length} recipient(s) are not valid active CRM users.` };
    }
  } else if (ex) {
    recipients = (Array.isArray(ex.recipients) ? ex.recipients : []) as unknown as RoutingRecipient[];
    if (recipients.length === 0) return { error: "At least one recipient is required." };
  } else {
    return { error: "At least one recipient is required." };
  }

  // weighted → percentages must sum to 100 (the "Percentage" strategy is
  // weighted with weights summing to 100).
  if (strategy === "weighted") {
    const sum = recipients.reduce((s, r) => s + (r.weight ?? 0), 0);
    if (recipients.some((r) => !r.weight || r.weight <= 0)) {
      return { error: "Weighted strategy: every recipient needs a % weight." };
    }
    if (Math.abs(sum - 100) > 0.01) {
      return { error: `Weighted strategy: weights must sum to 100 (currently ${sum}).` };
    }
  }
  if (strategy === "single" && recipients.length > 1) {
    return { error: "Single strategy takes exactly one recipient — switch to Round Robin or Weighted for multiple." };
  }

  return {
    rule: { name, priority, startsAt, endsAt, strategy, scope, recipients },
  };
}

/**
 * Merge new recipients with the existing rule's per-recipient `assigned`
 * counters so an edit never resets the distribution history. New userIds start
 * at 0; removed userIds drop (their history stays in the version snapshots).
 */
export function carryAssignedCounts(
  next: RoutingRecipient[],
  existing: Prisma.JsonValue | null | undefined,
): RoutingRecipient[] {
  const prev = new Map<string, number>();
  if (Array.isArray(existing)) {
    for (const e of existing) {
      if (e && typeof e === "object" && !Array.isArray(e)) {
        const o = e as Record<string, unknown>;
        if (typeof o.userId === "string" && typeof o.assigned === "number") {
          prev.set(o.userId, Math.max(0, Math.floor(o.assigned)));
        }
      }
    }
  }
  return next.map((r) => ({ ...r, assigned: prev.get(r.userId) ?? 0 }));
}

// ── Version audit + serialization ────────────────────────────────────────────

export type RuleVersionAction = "created" | "updated" | "disabled" | "enabled" | "deleted";

/** Full rule state as a Json snapshot (what the history drawer shows/reverts from). */
export function snapshotRule(rule: RoutingRule): Prisma.InputJsonValue {
  return {
    id: rule.id,
    name: rule.name,
    active: rule.active,
    priority: rule.priority,
    startsAt: rule.startsAt.toISOString(),
    endsAt: rule.endsAt ? rule.endsAt.toISOString() : null,
    scope: rule.scope as Prisma.InputJsonValue,
    recipients: rule.recipients as Prisma.InputJsonValue,
    strategy: rule.strategy,
    rrCursor: rule.rrCursor,
    assignedCount: rule.assignedCount,
    disabledAt: rule.disabledAt ? rule.disabledAt.toISOString() : null,
    createdById: rule.createdById,
    updatedById: rule.updatedById,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  };
}

/** EVERY mutation writes a RoutingRuleVersion row (action + full snapshot + actor). */
export async function writeRuleVersion(
  tx: Prisma.TransactionClient,
  rule: RoutingRule,
  action: RuleVersionAction,
  actorId: string,
): Promise<void> {
  await tx.routingRuleVersion.create({
    data: { ruleId: rule.id, action, snapshot: snapshotRule(rule), changedById: actorId },
  });
}

/** Wire shape the list API / page hand the client (dates as ISO strings). */
export function serializeRule(
  rule: RoutingRule & { createdBy?: { name: string } | null; versions?: { action: string }[] },
  now: Date = new Date(),
) {
  const deleted = rule.versions?.[0]?.action === "deleted";
  return {
    id: rule.id,
    name: rule.name,
    active: rule.active,
    priority: rule.priority,
    startsAt: rule.startsAt.toISOString(),
    endsAt: rule.endsAt ? rule.endsAt.toISOString() : null,
    scope: (rule.scope ?? {}) as unknown as RoutingScope,
    recipients: (Array.isArray(rule.recipients) ? rule.recipients : []) as unknown as RoutingRecipient[],
    strategy: rule.strategy,
    assignedCount: rule.assignedCount,
    disabledAt: rule.disabledAt ? rule.disabledAt.toISOString() : null,
    createdAt: rule.createdAt.toISOString(),
    createdByName: rule.createdBy?.name ?? null,
    deleted,
    status: computeRuleStatus(rule, { now, deleted }),
  };
}

export type SerializedRule = ReturnType<typeof serializeRule>;
