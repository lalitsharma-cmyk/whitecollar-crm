import "server-only";
import { prisma } from "@/lib/prisma";
import { Role, Prisma, type LeadSource } from "@prisma/client";
import { SUPPRESSED_STATUSES } from "@/lib/lead-statuses";
import { phoneCanonicalTail } from "@/lib/phoneCountry";
import { applyRouting, type RoutingContext } from "@/lib/leadRouting";
import { resolveActiveAssignee } from "@/lib/leave";

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
  | { kind: "rule"; userId: string; ruleId: string; ruleName: string; reason: string }
  | { kind: "default"; userId: string | null };

export async function resolveAutoAssignOwner(
  ctx: RoutingContext,
  now: Date = new Date(),
): Promise<AutoAssignResolution> {
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
