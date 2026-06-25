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
}

export default function RevivalLeadsListClient({
  leads, canBulk, canReassign, canSetStatus, canDelete, projectOptions, statusOptions,
  sourceOptions, meRole, showSource, searchParamsStr, agents, promoteMeta,
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
      extraRowAction={(row) => {
        const m = promoteMeta[row.id];
        if (!m || !m.canPromote) return null;
        return <RevivalRowPromote leadId={row.id} leadName={row.name} isOriginCold={m.isOriginCold} />;
      }}
    />
  );
}
