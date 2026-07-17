"use client";

// RevivalLeadsListClient — a THIN client wrapper that mounts the shared
// <LeadsListClient> for the Revival Engine (/cold-calls).
//
// WHY THIS WRAPPER EXISTS
//   The /cold-calls page is a Server Component, and LeadsListClient's
//   `extraRowAction` is a render FUNCTION — functions can't cross the
//   server→client boundary. So the server page passes only SERIALIZABLE data
//   (the rows + a per-row promote-eligibility map), and this client component
//   defines the actual extraRowAction closure here, on the client, where it can
//   render <RevivalRowPromote/>. LeadsListClient itself stays fully generic — it
//   never learns about Revival; it just calls the function it's handed.
//
// Everything else is a pass-through: the grid, columns, header filters, sorting,
// pagination, status badges, bulk toolbar and the Call/WA/Complete/Snooze/
// Escalate/Reject row actions are 100% the same component /leads renders.

import LeadsListClient, { type Row } from "./LeadsListClient";
import RevivalRowPromote from "./RevivalRowPromote";

export interface RevivalPromoteMeta {
  /** Whether the viewer may promote this row (admin/manager, or the owner). */
  canPromote: boolean;
  /** leadOrigin COLD/REVIVAL → /promote; legacy isColdCall-only → /promote-cold. */
  isOriginCold: boolean;
}

/** Attempt-cycle chip data (Revival auto-return engine — lib/callAttempts.ts).
 *  Serializable, computed server-side on /cold-calls the same way promoteMeta is. */
export interface RevivalAttemptMeta {
  /** Row has a current owner (attempts are owner-specific). */
  owned: boolean;
  /** Unsuccessful call attempts by the CURRENT owner (resets on reassignment). */
  attemptCount: number;
  /** revivalMaxAttempts Setting — the SAME threshold the auto-return fires on. */
  threshold: number;
  /** returnedToPoolAt != null — the record was auto-returned to the Admin queue. */
  returned: boolean;
  /** revivalCycle (1 = first ownership; +1 on every auto-return). */
  cycle: number;
}

/** 📞 n/T attempts chip (owned rows) / ↩︎ Returned badge (unowned, auto-returned).
 *  Mirrors the Dubai Buyer Data attempts presentation (BuyerListClient table cell +
 *  BuyerAdminPanel tones): hidden at 0 attempts, gray below T-1, amber at T-1
 *  ("nearing" — one unsuccessful call from auto-return), red at ≥T. */
function RevivalAttemptChip({ meta }: { meta: RevivalAttemptMeta }) {
  const t = meta.threshold;
  if (meta.owned) {
    // Show the counter on EVERY owned row — including 0/T (Lalit 2026-07-17: the
    // attempt count must always be visible on Revival, not hidden at zero).
    const tone = meta.attemptCount >= t
      ? "border-red-300 bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300 dark:border-red-700"
      : meta.attemptCount >= t - 1
        ? "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-700"
        : "border-gray-200 bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700";
    const title = meta.attemptCount >= t
      ? `${meta.attemptCount}/${t} call attempts by the current owner — at the auto-return threshold`
      : meta.attemptCount === t - 1
        ? `${meta.attemptCount}/${t} call attempts — one unanswered call from auto-return to the Admin Revival queue`
        : `${meta.attemptCount}/${t} call attempts by the current owner — auto-returns to Admin at ${t} with no connect`;
    return (
      <span title={title}
        className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold tabular-nums whitespace-nowrap ${tone}`}>
        📞 {meta.attemptCount}/{t}
      </span>
    );
  }
  if (meta.returned) {
    return (
      <span title={`Auto-returned to the Admin Revival queue (${t} unanswered attempts, no connect) — revival cycle ${meta.cycle}. Reassigning starts a fresh cycle.`}
        className="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 text-blue-700 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-700">
        ↩︎ Returned (cycle {meta.cycle})
      </span>
    );
  }
  return null;
}

interface Props {
  leads: Row[];
  canBulk: boolean;
  canReassign: boolean;
  canSetStatus: boolean;
  canDelete: boolean;
  projectOptions: string[];
  statusOptions: string[];
  sourceOptions: string[];
  meRole: string;
  showSource: boolean;
  searchParamsStr: string;
  agents: { id: string; name: string; team: string | null }[];
  /** id → promote eligibility + origin. Drives the extra Promote row action. */
  promoteMeta: Record<string, RevivalPromoteMeta>;
  /** id → attempt-cycle chip data (📞 n/T · ↩︎ Returned). Optional/additive. */
  attemptMeta?: Record<string, RevivalAttemptMeta>;
}

export default function RevivalLeadsListClient({
  leads, canBulk, canReassign, canSetStatus, canDelete, projectOptions, statusOptions,
  sourceOptions, meRole, showSource, searchParamsStr, agents, promoteMeta, attemptMeta,
}: Props) {
  return (
    <LeadsListClient
      canBulk={canBulk}
      canReassign={canReassign}
      canSetStatus={canSetStatus}
      canDelete={canDelete}
      projectOptions={projectOptions}
      statusOptions={statusOptions}
      sourceOptions={sourceOptions}
      meRole={meRole}
      showSource={showSource}
      view="table"
      searchParamsStr={searchParamsStr}
      detailBasePath="/revival-engine/cold-data"
      listBasePath="/cold-calls"
      agents={agents}
      leads={leads}
      // 📞 attempt chip now rides the Status cell (always visible) instead of the
      // far-right Actions column, where it was easy to miss (Lalit 2026-07-17).
      statusCellExtra={(row) => {
        const a = attemptMeta?.[row.id];
        return a ? <RevivalAttemptChip meta={a} /> : null;
      }}
      extraRowAction={(row) => {
        const m = promoteMeta[row.id];
        const promote = m && m.canPromote
          ? <RevivalRowPromote leadId={row.id} leadName={row.name} isOriginCold={m.isOriginCold} />
          : null;
        return promote;
      }}
    />
  );
}
