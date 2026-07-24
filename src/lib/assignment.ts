import "server-only";
import { prisma } from "@/lib/prisma";
import { Role, Prisma, type LeadSource } from "@prisma/client";
import { SUPPRESSED_STATUSES } from "@/lib/lead-statuses";
import { phoneCanonicalTail } from "@/lib/phoneCountry";
import { applyRouting, type RoutingContext } from "@/lib/leadRouting";
import { resolveActiveAssignee } from "@/lib/leave";
import { normalizeTeam } from "@/lib/teamRouting";

/**
 * Round-robin assignment: pick the active AGENT (or MANAGER) with the
 * fewest currently-owned, non-suppressed leads. Tie-break by oldest
 * assignment timestamp so everyone takes turns.
 */
export async function pickRoundRobinAgent(opts?: { team?: string; source?: LeadSource }) {
  const candidates = await prisma.user.findMany({
    where: {
      active: true,
      hrOnly: false,
      role: { in: [Role.AGENT, Role.MANAGER] },
      ...(opts?.team ? { team: opts.team } : {}),
    },
    include: {
      _count: {
        select: {
          ownedLeads: { where: { currentStatus: { notIn: SUPPRESSED_STATUSES } } },
        },
      },
      assignments: { orderBy: { assignedAt: "desc" }, take: 1 },
    },
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const d = a._count.ownedLeads - b._count.ownedLeads;
    if (d !== 0) return d;
    const at = a.assignments[0]?.assignedAt?.getTime() ?? 0;
    const bt = b.assignments[0]?.assignedAt?.getTime() ?? 0;
    return at - bt; // older assignment = next up
  });
  return candidates[0];
}

export function fingerprintFor(phone?: string | null, email?: string | null) {
  const p = (phone ?? "").replace(/\D/g, "");
  const e = (email ?? "").toLowerCase().trim();
  if (!p && !e) return null;
  return `${p}|${e}`;
}

/**
 * THE active-lead dedup match (D2 fix, Lalit 2026-07-15). A candidate matches an
 * existing lead when its **canonical phone-tail matches OR its email matches** —
 * as two INDEPENDENT signals, NOT the old single combined "phone|email"
 * fingerprint string. That string missed the exact bug it needed to catch: a lead
 * first stored with BOTH phone+email (fingerprint "919…|a@b.com") never matched a
 * re-import carrying ONLY the phone (fingerprint "919…|"), so a duplicate was
 * created. Matching phone OR email separately closes that gap.
 *
 * Returns a Prisma `OR` array (empty when the candidate has no usable key, in
 * which case the caller should treat it as "no duplicate — create"). The caller
 * ALWAYS ANDs `deletedAt: null` so only ACTIVE leads dedupe (a soft-deleted lead
 * must not swallow a re-import — the deleted-lead dedupe rule). Phone matching is
 * a trailing-tail `endsWith` (the SAME last-10 key dupKeysForRow uses), applied to
 * `phone` / `altPhone` (works for legacy rows pre-canonical-backfill) AND
 * `phoneCanonical` (clean post-backfill). Email is exact, case-insensitive, on
 * `email` / `altEmail`. This is the ONE normalization feeding lead dedup — the
 * incoming tail is computed via phoneCanonicalTail (the same canonical rule the
 * buyer importer's tail matching is consistent with).
 */
export function leadDedupOR(
  phone?: string | null,
  email?: string | null,
  altPhone?: string | null,
  altEmail?: string | null,
): Prisma.LeadWhereInput[] {
  const or: Prisma.LeadWhereInput[] = [];
  const tails = [phoneCanonicalTail(phone), phoneCanonicalTail(altPhone)].filter((t) => t.length >= 7);
  for (const t of [...new Set(tails)]) {
    or.push(
      { phone: { endsWith: t } },
      { altPhone: { endsWith: t } },
      { phoneCanonical: { endsWith: t } },
    );
  }
  const emails = [(email ?? "").toLowerCase().trim(), (altEmail ?? "").toLowerCase().trim()]
    .filter((e) => e.includes("@") && e.length >= 5);
  for (const e of [...new Set(emails)]) {
    or.push(
      { email: { equals: e, mode: "insensitive" } },
      { altEmail: { equals: e, mode: "insensitive" } },
    );
  }
  return or;
}

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN LEAD-ROUTING SCHEDULER choke point (Lalit 2026-07-17).
//
// resolveAutoAssignOwner() is THE routing-aware auto-assign resolver every
// AUTO-assignment path funnels through (real-time intake, reconciler orphan
// sweep, awaiting-team tagging, and — when a rule scopes them — converts and
// imports). Manual assignment paths must NEVER call this: a human picking an
// owner always wins over any rule.
//
// Resolution order:
//   1. PAUSED  — global "routingPause" Setting is on → { kind: "paused" }.
//                The caller must leave the record UNASSIGNED (do NOT fall back
//                to the default rule) — Lalit's emergency override: "all leads
//                remain unassigned until manually distributed".
//   2. RULE    — an admin-defined RoutingRule matched (date-window + scope,
//                priority-ordered) and yielded an eligible recipient →
//                { kind: "rule" }. Caller assigns to userId and stamps the
//                lead's routingMethod="rule" + routingReason=reason.
//   3. DEFAULT — no rule matched → { kind: "default" } carrying the EXISTING
//                business rule via resolveActiveAssignee (Dubai→Lalit ·
//                Tue-IST India→Yasir · else Tanuj, honoring leave-cover) —
//                byte-identical to today's behavior when zero rules exist.
//
// This function only DECIDES the target; the caller keeps its own gating
// (websiteAutoAssignEnabled, terminal-status skip, ownerId==null check) and its
// own assignLeadTo()/update writes, so nothing about HOW leads are assigned
// changes — only WHO, and only when an admin created a rule or hit pause.
// ─────────────────────────────────────────────────────────────────────────────

export type AutoAssignResolution =
  | { kind: "paused"; userId: null; reason: string }
  | { kind: "preserved"; userId: null; ownerId: string; reason: string }
  | { kind: "rule"; userId: string; ruleId: string; ruleName: string; reason: string }
  | { kind: "default"; userId: string | null };

/**
 * PERMANENT ROUTING PRINCIPLE (Lalit P0, 2026-07-23):
 *   "Routing fills an ownership GAP; it does not override a valid existing owner
 *    merely because team metadata was added or corrected later."
 *
 * Answers the question nothing in this codebase could answer before: is this
 * record's CURRENT owner a valid holder for this team? Eligible when the owner is
 * active, not HR-only, and either on that team OR an ADMIN/HQ user (Lalit
 * legitimately owns both Dubai and India leads — sweeping an admin's book on a team
 * tag would be the same bug wearing a different hat).
 *
 * Team is compared through normalizeTeam on BOTH sides: User.team is a free-text
 * String? column, so "india" / " India" / "UAE" must never read as a different team
 * (the stale-name-comparison trap that made an owner invisible to their own team).
 */
export async function ownerIsEligibleForTeam(
  ownerId: string | null | undefined,
  team: string | null | undefined,
): Promise<{ eligible: boolean; reason: string }> {
  if (!ownerId) return { eligible: false, reason: "no current owner — routing fills the gap" };
  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { id: true, name: true, team: true, active: true, hrOnly: true, role: true },
  });
  if (!owner) return { eligible: false, reason: "owner record not found" };
  if (!owner.active) return { eligible: false, reason: `${owner.name} is deactivated/offboarded` };
  if (owner.hrOnly) return { eligible: false, reason: `${owner.name} is HR-only` };
  if (owner.role === Role.ADMIN || (owner.team ?? "").trim().toUpperCase() === "HQ") {
    return { eligible: true, reason: `${owner.name} is an admin/HQ owner — assignment preserved` };
  }
  const ownerTeam = normalizeTeam(owner.team ?? undefined);
  const wantTeam = normalizeTeam(team ?? undefined);
  if (wantTeam && ownerTeam && ownerTeam === wantTeam) {
    return { eligible: true, reason: `${owner.name} is already on the ${wantTeam} team — assignment preserved` };
  }
  return { eligible: false, reason: `${owner.name} (${owner.team ?? "no team"}) is not on ${wantTeam ?? "the selected team"}` };
}

export async function resolveAutoAssignOwner(
  ctx: RoutingContext,
  now: Date = new Date(),
): Promise<AutoAssignResolution> {
  // ── 0. AN EXISTING VALID OWNER WINS (Lalit P0, 2026-07-23) ──────────────────
  // Deliberately BEFORE applyRouting: pickRecipient() commits the round-robin
  // cursor + per-recipient counters inside its OWN transaction and only then
  // returns, so a caller that discards the pick afterwards has still burned a
  // slot. Deciding here is the only place a preserved assignment costs nothing —
  // no pointer advance, no Assignment row, no notification.
  if (ctx.currentOwnerId) {
    const check = await ownerIsEligibleForTeam(ctx.currentOwnerId, ctx.team ?? null);
    if (check.eligible) {
      return { kind: "preserved", userId: null, ownerId: ctx.currentOwnerId, reason: check.reason };
    }
  }
  const routed = await applyRouting(ctx, now); // fail-open: errors → null inside
  if (routed) {
    if (routed.paused) {
      return {
        kind: "paused",
        userId: null,
        reason: "Automatic assignment is paused by admin — lead left unassigned for manual distribution",
      };
    }
    return {
      kind: "rule",
      userId: routed.ownerId,
      ruleId: routed.ruleId,
      ruleName: routed.ruleName,
      reason: routed.reason,
    };
  }
  // No rule → the EXISTING fixed team rule + leave-cover, unchanged.
  const fallback = await resolveActiveAssignee(ctx.team ?? null, now);
  return { kind: "default", userId: fallback };
}
