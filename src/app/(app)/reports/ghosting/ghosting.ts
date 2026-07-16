// ─────────────────────────────────────────────────────────────────────────────
// 👻 Ghosting Report — shared builder (report page + dashboard metric card).
//
// BUSINESS RULE (Lalit 2026-07-16/17): Normal Leads ONLY (active pipeline —
// never Master Data / Buyer / Revival). A lead whose CURRENT owner logged
// ≥ threshold call attempts (Setting "ghostingThreshold", default 10) with
// ZERO meaningful connects gets `ghostingAt` stamped by the call-attempt
// engine. 👻 is a SECONDARY tag — it never replaces currentStatus, and the
// engine clears it on transfer or a meaningful connect.
//
// DISPLAY-ELIGIBILITY GUARD — re-checked at READ time (statuses can change
// after the stamp). A lead is shown/counted as Ghosting ONLY if:
//   ghostingAt != null
//   AND ownerId != null                    (no current owner → not ghosting)
//   AND currentStatus ∉ TERMINAL_STATUSES  (closed/lost leads aren't ghosting)
//   AND currentStatus ∉ CLOSING_STATUSES   (engaged meeting/visit/booked aren't)
// "Follow Up" stays ghosting-eligible (Lalit's explicit example); null/blank
// statuses stay eligible too (fresh, unstatused leads CAN ghost).
//
// COUNT == RECORDS, by construction (the lead-intake contract): every number
// is computed with the SAME where its drill target applies. Drills open
//   /leads?ghost=1&followup=all&seg=all [+ &owner= / &team= / &source=]
// (followup=all: else /leads narrows to Today+Overdue · seg=all: else an ADMIN
// lands on "My Leads"). The /leads page's ghost=1 parse must mirror
// ghostingDisplayWhere() below — its base envelope (leadScopeWhere +
// isColdCall:false + leadOrigin notIn COLD_ORIGINS + the workable-status OR)
// is byte-mirrored here from leads/page.tsx.
// ─────────────────────────────────────────────────────────────────────────────
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { COLD_ORIGINS, WORKABLE_STATUS_OR, leadScopeWhere, type ScopedUser } from "@/lib/leadScope";
import { TERMINAL_STATUSES, CLOSING_STATUSES, CLOSED_OUTCOME_STATUSES } from "@/lib/lead-statuses";
import { effectiveSource } from "@/lib/sourceLabel";

// ── The guard, in where-clause form ──────────────────────────────────────────

/** Statuses that BLOCK the 👻 display: terminal outcomes + engaged/closing. */
export const GHOSTING_BLOCKED_STATUSES: string[] = [
  ...new Set([...TERMINAL_STATUSES, ...CLOSING_STATUSES]),
];

/** Status leg of the guard. SQL `NOT IN` evaluates to NULL (not true) for rows
 *  whose currentStatus IS NULL, so null/blank must be OR'd back in — fresh,
 *  unstatused leads CAN ghost. */
export const GHOSTING_STATUS_OR: Prisma.LeadWhereInput[] = [
  { currentStatus: null },
  { currentStatus: "" },
  { currentStatus: { notIn: GHOSTING_BLOCKED_STATUSES } },
];

/**
 * Display-eligible 👻 where: role scope (leadScopeWhere(me) — deletedAt:null +
 * admin-all / manager-team / agent-own) + the /leads working-view envelope +
 * the read-time guard. The /leads `ghost=1` parse must produce EXACTLY this
 * set for the params our drills carry, so count == records.
 *
 * ownerId lives under AND — an AGENT scope pins its own top-level
 * `ownerId: me.id`, which a top-level `ownerId: { not: null }` would clobber.
 */
export function ghostingDisplayWhere(scope: Prisma.LeadWhereInput): Prisma.LeadWhereInput {
  const existingAnd = Array.isArray(scope.AND) ? scope.AND : scope.AND ? [scope.AND] : [];
  return {
    ...scope,
    isColdCall: false,
    leadOrigin: { notIn: COLD_ORIGINS },
    ghostingAt: { not: null },
    AND: [
      ...existingAnd,
      { ownerId: { not: null } },
      { OR: WORKABLE_STATUS_OR },   // /leads workable envelope (byte-mirror)
      { OR: GHOSTING_STATUS_OR },   // read-time guard (adds the CLOSING block)
    ],
  };
}

/** EVER-ghosted where — HISTORICAL, no display guard: every scoped normal lead
 *  still carrying the stamp, any status, owned or not. Denominator of the
 *  conversion rate. NOTE: the engine clears ghostingAt on transfer / meaningful
 *  connect, so a lead that recovered via a connect BEFORE closing is not
 *  counted here — the report labels this honestly. */
export function everGhostedWhere(scope: Prisma.LeadWhereInput): Prisma.LeadWhereInput {
  return {
    ...scope,
    isColdCall: false,
    leadOrigin: { notIn: COLD_ORIGINS },
    ghostingAt: { not: null },
  };
}

// ── Drill URL (the param contract, in one place) ─────────────────────────────

/** /leads drill for a 👻 number. Always carries ghost=1 + followup=all + seg=all
 *  (see header). Dimension params mirror the /leads filter fields exactly:
 *  owner → ownerId, team → forwardedTeam, source → sourceRaw (verbatim). */
export function ghostingDrill(extra?: { owner?: string; team?: string; source?: string }): string {
  const u = new URLSearchParams();
  u.set("ghost", "1");
  u.set("followup", "all");
  u.set("seg", "all");
  if (extra?.owner) u.set("owner", extra.owner);
  if (extra?.team) u.set("team", extra.team);
  if (extra?.source) u.set("source", extra.source);
  return `/leads?${u.toString()}`;
}

// sourceRaw containing a comma can't round-trip (?source= is comma-split by
// /leads) — such a row's drill opens the unfiltered list instead (honest
// superset, same convention as the lead-intake report).
const sourceLinkable = (key: string) => key !== "" && !key.includes(",");

// ── Report shape ─────────────────────────────────────────────────────────────

export interface GhostingReport {
  /** Effective threshold (Setting "ghostingThreshold", default 10). */
  threshold: number;
  total: { n: number; href: string };
  /** Average Lead.attemptCount over the display-eligible set (null when 0). */
  avgAttempts: number | null;
  byAgent: { ownerId: string; name: string; n: number; avgAttempts: number; href: string }[];
  byTeam: { key: string; label: string; n: number; href: string; note?: string }[];
  /** Hidden for AGENTs by the page (mirrors the /leads source-privacy gate). */
  bySource: { key: string; label: string; n: number; href: string; note?: string }[];
  /** Of ALL leads that ever ghosted (ghostingAt != null, NO display guard),
   *  how many now sit in a CLOSED_OUTCOME status. */
  conversion: { everGhosted: number; closed: number; pct: number | null };
}

// ── The builder ──────────────────────────────────────────────────────────────

export async function buildGhostingReport(me: ScopedUser): Promise<GhostingReport> {
  const scope = await leadScopeWhere(me);
  const displayWhere = ghostingDisplayWhere(scope);
  const everWhere = everGhostedWhere(scope);

  const [rows, everGhosted, everClosed, thresholdRow] = await Promise.all([
    // ONE bounded row fetch feeds every table — Total, by-Agent, by-Team and
    // by-Source all partition the same set, so they reconcile by construction.
    prisma.lead.findMany({
      where: displayWhere,
      select: {
        ownerId: true,
        owner: { select: { name: true } },
        forwardedTeam: true,
        sourceRaw: true,
        source: true,
        attemptCount: true,
      },
    }),
    prisma.lead.count({ where: everWhere }),
    prisma.lead.count({ where: { ...everWhere, currentStatus: { in: CLOSED_OUTCOME_STATUSES } } }),
    prisma.setting.findUnique({ where: { key: "ghostingThreshold" } }).catch(() => null),
  ]);

  const parsed = parseInt(thresholdRow?.value ?? "", 10);
  const threshold = Number.isFinite(parsed) && parsed > 0 ? parsed : 10;

  // ── Aggregate (single pass) ────────────────────────────────────────────────
  const byAgentMap = new Map<string, { name: string; n: number; attempts: number }>();
  const byTeamMap = new Map<string, number>();
  const bySourceMap = new Map<string, number>();
  let attemptsSum = 0;

  for (const r of rows) {
    attemptsSum += r.attemptCount;
    const aid = r.ownerId ?? "__none__"; // guard pins ownerId != null; defensive key
    const a = byAgentMap.get(aid) ?? { name: r.owner?.name ?? "(unknown)", n: 0, attempts: 0 };
    a.n++;
    a.attempts += r.attemptCount;
    byAgentMap.set(aid, a);

    // Unclassified-data directive: team-less leads are their OWN visible
    // bucket, never folded into Dubai/India.
    const t = r.forwardedTeam === "Dubai" || r.forwardedTeam === "India" ? r.forwardedTeam : "";
    byTeamMap.set(t, (byTeamMap.get(t) ?? 0) + 1);

    const s = (r.sourceRaw ?? "").trim();
    bySourceMap.set(s, (bySourceMap.get(s) ?? 0) + 1);
  }

  const byAgent = [...byAgentMap.entries()]
    .map(([ownerId, v]) => ({
      ownerId,
      name: v.name,
      n: v.n,
      avgAttempts: v.n ? v.attempts / v.n : 0,
      href: ghostingDrill({ owner: ownerId }),
    }))
    .sort((x, y) => y.n - x.n);

  const byTeam = [...byTeamMap.entries()]
    .map(([key, n]) => ({
      key,
      label: key === "" ? "Unclassified (no team)" : `${key} team`,
      n,
      // No ?team= value exists for team-less leads — the link opens the list
      // WITHOUT a team filter (an honest superset), never a fake filter.
      href: key === "" ? ghostingDrill() : ghostingDrill({ team: key }),
      note: key === ""
        ? "awaiting team classification — opens the full ghosting list (superset)"
        : undefined,
    }))
    .sort((x, y) => y.n - x.n);

  const bySource = [...bySourceMap.entries()]
    .map(([key, n]) => ({
      key,
      // Blank sourceRaw = its OWN visible bucket (unclassified-data directive).
      label: key === "" ? "Unclassified (no source)" : effectiveSource(key, null),
      n,
      href: sourceLinkable(key) ? ghostingDrill({ source: key }) : ghostingDrill(),
      note: key === ""
        ? "no ‘blank source’ filter exists on /leads — opens the full ghosting list (superset)"
        : !sourceLinkable(key)
          ? "source value contains a comma — ?source= would split it; opens the full ghosting list (superset)"
          : undefined,
    }))
    .sort((x, y) => y.n - x.n);

  return {
    threshold,
    total: { n: rows.length, href: ghostingDrill() },
    avgAttempts: rows.length ? attemptsSum / rows.length : null,
    byAgent,
    byTeam,
    bySource,
    conversion: {
      everGhosted,
      closed: everClosed,
      pct: everGhosted > 0 ? (everClosed / everGhosted) * 100 : null,
    },
  };
}
