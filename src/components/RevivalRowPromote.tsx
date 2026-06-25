"use client";

// RevivalRowPromote — the Revival Engine's per-row "Promote to Lead" action,
// rendered inside the shared LeadsListClient grid via its extraRowAction hook.
//
// It simply delegates to the EXISTING promote buttons (no new endpoint, no new
// logic): a leadOrigin COLD/REVIVAL row promotes through OriginColdPromoteButton
// (PATCH /api/leads/:id/promote → leadOrigin ACTIVE), while a legacy isColdCall-
// only row promotes through ColdDataPromoteButton (POST /api/leads/:id/promote-cold
// → isColdCall=false + COLD_TO_LEAD activity). This is the SAME origin split the
// old RevivalEngineListClient used, so Revival keeps its promote capability 1:1.

import OriginColdPromoteButton from "./OriginColdPromoteButton";
import ColdDataPromoteButton from "./ColdDataPromoteButton";

export default function RevivalRowPromote({
  leadId,
  leadName,
  isOriginCold,
}: {
  leadId: string;
  leadName: string;
  isOriginCold: boolean;
}) {
  return (
    <div className="flex-none" onClick={(e) => e.stopPropagation()}>
      {isOriginCold
        ? <OriginColdPromoteButton leadId={leadId} leadName={leadName} compact />
        : <ColdDataPromoteButton   leadId={leadId} leadName={leadName} compact />}
    </div>
  );
}
