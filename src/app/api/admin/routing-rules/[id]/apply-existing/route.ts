// /api/admin/routing-rules/[id]/apply-existing — ADMIN-only.
//
// The OPT-IN "Apply this routing rule to existing matching leads" action (spec §9,
// Lalit 2026-07-17). Routing rules normally only steer NEW incoming leads at the
// intake choke points; this endpoint lets an admin ALSO sweep the existing backlog:
//
//   GET  → PREVIEW (read-only, mutates nothing): how many existing leads match the
//          rule's scope right now, their CURRENT ownership breakdown (incl.
//          "Unassigned"), and who the rule would hand them to.
//   POST { confirm: true } → APPLY: reassign every matching existing lead to the
//          rule's recipient using the SAME recipient-selection the live engine uses
//          (single / round-robin / weighted, leave-aware), stamp routing provenance,
//          and record ONE reversible OperationLog ("lead.transfer") so the whole
//          sweep can be undone from Admin → Operations in a single click.
//
// FAITHFUL REUSE (no engine edits):
//   • Matching set is built from parseScope(rule.scope) → a Prisma where that is the
//     DB twin of the engine's scopeMatches (budget via budgetWhereFragment).
//   • Recipient selection reuses pickRecipient(rule.id) — literally the same atomic,
//     leave-aware, counter-advancing picker applyRouting() calls in production, so a
//     swept lead lands exactly where a freshly-arriving one would.
//   • Reassignment goes through assignLeadTo() (Assignment history + notify + SLA +
//     attempt-cycle reset) and stamps routingMethod/routingSource/routingReason
//     identically to the intake path.
//
// SCOPE OF "EXISTING LEADS": the ACTIVE lead pipeline only — leadOrigin ACTIVE,
// not deleted, not rejected, WORKABLE (non-terminal) status. Cold/Revival and
// Master-Data records are staging repositories (never auto-routed) and are
// deliberately excluded, mirroring what the live intake path would legitimately own.
//
// GUARD RAILS: admin-only (requireRoutingAdmin); a deleted rule is refused; a
// non-live rule (scheduled/expired/disabled) is refused on APPLY (the engine's
// picker would decline anyway); and the affected set is HARD-CAPPED at MAX_APPLY to
// prevent a runaway mass-reassign — over the cap returns an error to narrow the rule.
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { audit, reqMeta } from "@/lib/audit";
import { Prisma, LeadSource } from "@prisma/client";
import { requireRoutingAdmin } from "../../shared";
import {
  parseScope,
  parseRecipients,
  pickRecipient,
  ruleIsLive,
  ROUTING_REASON_PREFIX,
  type RoutingScope,
  type RoutingStrategy,
} from "@/lib/leadRouting";
import { budgetWhereFragment, currencyForTeam, leadRoutingBudget } from "@/lib/budgetRouting";
import { ACTIVE_ORIGINS, WORKABLE_STATUS_OR } from "@/lib/leadScope";
import { snapshotLeads, logOperation } from "@/lib/operationLog";
import { assignLeadTo } from "@/lib/leadIngest";

// Sequential per-lead reassignment can take many seconds on a large sweep; the Vercel
// route default (10s) would clip it mid-loop and strand a partial, un-logged reassign.
export const maxDuration = 60;
// Hard ceiling on a single apply — above this we refuse and ask the admin to narrow
// the rule, so one click can never silently churn the whole database.
const MAX_APPLY = 2000;
// For the rare budget:"invalid" op (not expressible in SQL — filtered in JS), bound
// how many candidate rows we scan so the preview/apply stays memory-safe.
const INVALID_SCAN_CAP = 20000;

const insensitive = Prisma.QueryMode.insensitive;

type OwnerDistribution = { ownerId: string | null; ownerName: string; count: number };

async function loadRule(id: string) {
  return prisma.routingRule.findUnique({
    where: { id },
    include: { versions: { orderBy: { changedAt: "desc" }, take: 1, select: { action: true } } },
  });
}

const isDeleted = (rule: { versions: { action: string }[] }) => rule.versions[0]?.action === "deleted";

function normalizeStrategy(s: string): RoutingStrategy {
  return s === "single" || s === "weighted" ? s : "round_robin";
}

/**
 * Build the Prisma `where` for existing leads that match the rule's full scope —
 * the DB twin of the engine's scopeMatches(). Returns the base where plus flags for
 * the JS-only budget:"invalid" path.
 *
 * Base envelope (the "existing, workable, currently-assignable" universe):
 *   deletedAt: null · leadOrigin ∈ ACTIVE_ORIGINS · rejectedAt: null · WORKABLE status.
 * Categorical constraints (teams/markets/sources/projects/countries) are skipped when
 * scope.all === true — matching the engine, which enforces ONLY the budget under all.
 * Each constraint is its own AND element (its internal OR never collides with another).
 */
function buildScopeWhere(scope: RoutingScope): {
  where: Prisma.LeadWhereInput;
  needsInvalidFilter: boolean;
  expectedCurrency: "INR" | "AED" | null;
} {
  const and: Prisma.LeadWhereInput[] = [
    // WORKABLE = not terminal (null/blank/"FRESH" kept eligible). Same OR the
    // reporting surfaces use, so "matching" == what an intake would treat as active.
    { OR: [...WORKABLE_STATUS_OR] as Prisma.LeadWhereInput[] },
  ];

  // Currency for the budget comparison is implied by the rule's single team
  // (validator guarantees a numeric-budget rule targets exactly one team).
  const theRuleTeam = scope.teams && scope.teams.length === 1 ? scope.teams[0] : null;
  const expectedCurrency = currencyForTeam(theRuleTeam);

  if (scope.all !== true) {
    // teams → forwardedTeam ("India"/"Dubai", already normalized in the scope).
    if (scope.teams?.length) and.push({ forwardedTeam: { in: scope.teams } });

    // markets → Lead.market ("India"/"UAE"); case-insensitive to mirror the engine.
    if (scope.markets?.length) {
      and.push({ OR: scope.markets.map((m) => ({ market: { equals: m, mode: insensitive } })) });
    }

    // sources → LeadSource enum. The scope stores UPPERCASE enum KEYS; keep only the
    // ones that are real enum values (an unknown source can never match a real lead,
    // and passing a non-enum to Prisma would throw). `in: []` correctly matches none.
    if (scope.sources?.length) {
      const validSources = scope.sources.filter(
        (s): s is LeadSource => (Object.values(LeadSource) as string[]).includes(s),
      );
      and.push({ source: { in: validSources } });
    }

    // projects → the engine matches on sourceDetail; we ALSO catch the lead's
    // "Interested Properties" (LeadInterestedProject → Project.name). Case-insensitive.
    if (scope.projects?.length) {
      const projOr: Prisma.LeadWhereInput[] = [];
      for (const p of scope.projects) {
        projOr.push({ sourceDetail: { equals: p, mode: insensitive } });
        projOr.push({ interestedProjects: { some: { project: { name: { equals: p, mode: insensitive } } } } });
      }
      and.push({ OR: projOr });
    }

    // countries → Lead.country, case-insensitive.
    if (scope.countries?.length) {
      and.push({ OR: scope.countries.map((c) => ({ country: { equals: c, mode: insensitive } })) });
    }
  }

  // Budget is ALWAYS enforced (it survives all:true, exactly like scopeMatches).
  let needsInvalidFilter = false;
  if (scope.budget) {
    if (scope.budget.op === "invalid") {
      // budgetWhereFragment returns null for "invalid" — needs raw-text + currency
      // logic. Fetch candidates and filter in JS via leadRoutingBudget().state.
      needsInvalidFilter = true;
    } else {
      const frag = budgetWhereFragment(scope.budget, expectedCurrency);
      if (frag) and.push(frag as Prisma.LeadWhereInput);
    }
  }

  const where: Prisma.LeadWhereInput = {
    deletedAt: null,
    leadOrigin: { in: ACTIVE_ORIGINS },
    rejectedAt: null, // a rejected lead can't be (re)assigned — assignLeadTo would refuse
    AND: and,
  };
  return { where, needsInvalidFilter, expectedCurrency };
}

/** Resolve ownerId→name and shape the current-ownership distribution (null → "Unassigned"). */
async function labelDistribution(byOwner: Map<string | null, number>): Promise<OwnerDistribution[]> {
  const ids = [...byOwner.keys()].filter((k): k is string => !!k);
  const users = ids.length
    ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name] as const));
  return [...byOwner.entries()]
    .map(([ownerId, count]) => ({
      ownerId,
      ownerName: ownerId ? nameById.get(ownerId) ?? "Unknown" : "Unassigned",
      count,
    }))
    .sort((a, b) => b.count - a.count);
}

/** The rule's recipient display name(s) — who the rule would assign matching leads to. */
async function recipientDisplayName(
  rule: { recipients: Prisma.JsonValue; strategy: string },
): Promise<string> {
  const recipients = parseRecipients(rule.recipients);
  if (recipients.length === 0) return "—";
  const users = await prisma.user.findMany({
    where: { id: { in: recipients.map((r) => r.userId) } },
    select: { id: true, name: true },
  });
  const nameById = new Map(users.map((u) => [u.id, u.name] as const));
  const names = recipients.map((r) => nameById.get(r.userId) ?? "Unknown");
  return normalizeStrategy(rule.strategy) === "single" ? names[0] ?? "—" : names.join(", ");
}

// ── GET — preview (read-only) ────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRoutingAdmin();
  if (g.forbidden) return g.forbidden;
  const { id } = await params;

  const rule = await loadRule(id);
  if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  if (isDeleted(rule)) {
    return NextResponse.json({ error: "This rule was deleted — nothing to apply." }, { status: 400 });
  }

  const scope = parseScope(rule.scope);
  const { where, needsInvalidFilter, expectedCurrency } = buildScopeWhere(scope);
  const recipientName = await recipientDisplayName(rule);

  let count: number;
  let distribution: OwnerDistribution[];

  if (needsInvalidFilter) {
    const rows = await prisma.lead.findMany({
      where,
      take: INVALID_SCAN_CAP,
      select: { id: true, ownerId: true, budgetMin: true, budgetMax: true, budgetCurrency: true, budgetRaw: true },
    });
    const invalid = rows.filter((r) => leadRoutingBudget(r, expectedCurrency).state === "invalid");
    count = invalid.length;
    const byOwner = new Map<string | null, number>();
    for (const r of invalid) byOwner.set(r.ownerId, (byOwner.get(r.ownerId) ?? 0) + 1);
    distribution = await labelDistribution(byOwner);
  } else {
    const groups = await prisma.lead.groupBy({ by: ["ownerId"], where, _count: { _all: true } });
    const byOwner = new Map<string | null, number>(groups.map((gp) => [gp.ownerId, gp._count._all]));
    count = groups.reduce((s, gp) => s + gp._count._all, 0);
    distribution = await labelDistribution(byOwner);
  }

  const live = ruleIsLive(rule, new Date());
  return NextResponse.json({
    // ── contract the UI codes against ──
    count,
    distribution, // [{ ownerId, ownerName, count }] — CURRENT ownership, incl. "Unassigned"
    recipientName, // who the rule would assign matching leads to
    ruleName: rule.name,
    // ── advisory extras (safe to ignore) ──
    strategy: normalizeStrategy(rule.strategy),
    live, // false → APPLY will be refused until the rule is activated
    exceedsLimit: count > MAX_APPLY, // true → APPLY will be refused; narrow the rule
    maxApply: MAX_APPLY,
  });
}

// ── POST — apply (confirm:true) ──────────────────────────────────────────────
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const g = await requireRoutingAdmin();
  if (g.forbidden) return g.forbidden;
  const me = g.me;
  const { id } = await params;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.confirm !== true) {
    return NextResponse.json({ error: "Set { confirm: true } to apply this rule to existing leads." }, { status: 400 });
  }

  const rule = await loadRule(id);
  if (!rule) return NextResponse.json({ error: "Rule not found" }, { status: 404 });
  if (isDeleted(rule)) {
    return NextResponse.json({ error: "This rule was deleted — nothing to apply." }, { status: 400 });
  }

  const now = new Date();
  // A non-live rule's picker declines every lead (pickRecipient re-checks ruleIsLive),
  // which would silently reassign nothing. Refuse up-front with a clear message so the
  // preview (which still shows the scope) and the apply never disagree.
  if (!ruleIsLive(rule, now)) {
    return NextResponse.json(
      { error: "This rule is not currently active (scheduled, expired, or disabled). Activate it before applying to existing leads." },
      { status: 400 },
    );
  }

  const scope = parseScope(rule.scope);
  const { where, needsInvalidFilter, expectedCurrency } = buildScopeWhere(scope);

  // Resolve the matching set (id + current ownerId), enforcing the hard cap.
  let matching: { id: string; ownerId: string | null }[];
  if (needsInvalidFilter) {
    const rows = await prisma.lead.findMany({
      where,
      take: INVALID_SCAN_CAP,
      select: { id: true, ownerId: true, budgetMin: true, budgetMax: true, budgetCurrency: true, budgetRaw: true },
    });
    matching = rows
      .filter((r) => leadRoutingBudget(r, expectedCurrency).state === "invalid")
      .map((r) => ({ id: r.id, ownerId: r.ownerId }));
  } else {
    // take MAX_APPLY+1 so we can detect (and refuse) an over-cap set in one query.
    matching = await prisma.lead.findMany({ where, take: MAX_APPLY + 1, select: { id: true, ownerId: true } });
  }

  if (matching.length > MAX_APPLY) {
    return NextResponse.json(
      { error: `This rule matches more than ${MAX_APPLY} existing leads. Narrow its scope (team, source, budget, dates) before applying.` },
      { status: 400 },
    );
  }
  if (matching.length === 0) {
    return NextResponse.json({ reassigned: 0, skipped: 0, operationLogId: null });
  }

  // Snapshot the FULL candidate set BEFORE any mutation — this is the revert source.
  // We filter it down to the actually-reassigned ids when writing the OperationLog.
  const beforeSnaps = await snapshotLeads(prisma, matching.map((m) => m.id));

  // Write the reversible OperationLog BEFORE the loop, over the FULL candidate set.
  // This route reassigns leads one-by-one; if the platform kills it mid-loop, the
  // already-committed mutations must STILL be undoable. Reverting the full snapshot
  // restores every candidate to its prior owner — moved leads get reverted, unreached
  // leads are already at that owner (a no-op). We trim it to the moved leads after.
  const preOp = await logOperation(prisma, {
    operation: "lead.transfer", entityType: "Lead", module: "Routing",
    summary: `Routing rule "${rule.name}" applying to up to ${matching.length} existing lead(s)…`,
    affectedIds: matching.map((m) => m.id),
    beforeState: beforeSnaps,
    afterState: { ruleId: rule.id, ruleName: rule.name, appliedToExisting: true },
    createdById: me.id,
  });

  const reason = `${ROUTING_REASON_PREFIX}${rule.name} (apply to existing)`;
  const reassignedIds: string[] = [];
  let skipped = 0;

  for (const lead of matching) {
    try {
      // Reuse the engine's atomic, leave-aware, strategy-honoring picker — the SAME
      // call applyRouting() makes for a live lead. Advances the rule's rrCursor /
      // per-recipient counters exactly as a real routed lead would.
      const pick = await pickRecipient(rule.id, now);
      if (!pick) {
        // No eligible recipient right now (single target on leave / everyone on leave).
        skipped++;
        continue;
      }
      if (pick.userId === lead.ownerId) {
        // Already owned by the target the rule chose → no-op.
        skipped++;
        continue;
      }
      // Canonical assignment: Assignment history + owner notification + SLA + attempt-
      // cycle reset (same chokepoint every assign path uses).
      await assignLeadTo(lead.id, pick.userId, reason);
      // Stamp routing provenance identically to the live intake path.
      await prisma.lead.update({
        where: { id: lead.id },
        data: { routingMethod: "rule", routingSource: `routing_rule:${rule.id}`, routingReason: reason },
      });
      reassignedIds.push(lead.id);
    } catch (err) {
      // One bad lead (e.g. a race that rejected it mid-sweep) must not abort the batch.
      console.error("[apply-existing] reassign failed for lead", lead.id, err);
      skipped++;
    }
  }

  // Trim the pre-written OperationLog to the leads ACTUALLY reassigned. If this update
  // is itself what got cut off, the full-candidate log written above stays correctly
  // revertable (unchanged leads revert to a no-op). If nothing moved, drop the log.
  let operationLogId: string | null = preOp.id;
  if (reassignedIds.length === 0) {
    await prisma.operationLog.delete({ where: { id: preOp.id } }).catch(() => {});
    operationLogId = null;
  } else {
    const reassignedSet = new Set(reassignedIds);
    await prisma.operationLog.update({
      where: { id: preOp.id },
      data: {
        summary: `Routing rule "${rule.name}" applied to ${reassignedIds.length} existing lead(s)`,
        affectedCount: reassignedIds.length,
        affectedIds: reassignedIds,
        beforeState: beforeSnaps.filter((s) => reassignedSet.has(String(s.id))) as Prisma.InputJsonValue,
      },
    }).catch(() => {});
  }

  await audit({
    userId: me.id,
    action: "routing.rule.apply_existing",
    entity: "RoutingRule",
    entityId: rule.id,
    meta: { matched: matching.length, reassigned: reassignedIds.length, skipped, operationLogId },
    request: reqMeta(req),
  });

  return NextResponse.json({ reassigned: reassignedIds.length, skipped, operationLogId });
}
