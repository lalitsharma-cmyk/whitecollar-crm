"use client";
import { useState } from "react";
import LeadImportWizard from "./LeadImportWizard";

interface Agent { id: string; name: string; team: string | null; }

/**
 * Pre-assigned CSV/Excel import — admin uploads an agent's existing-client
 * list (e.g. "Mehak MIS.xlsx") and every row gets pre-assigned to that agent.
 * No round-robin. Status bumped to CONTACTED on intake.
 *
 * Now runs the shared Import-Mapping-Approval wizard (preview → confirm mapping
 * → data preview + dup flags → dup choice → report). The picked agent rides
 * along as `assignToUserId` on both the preview and the import request, so the
 * pre-assign behaviour is unchanged.
 */
export default function PreAssignedImporter({ agents }: { agents: Agent[] }) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");

  return (
    <div className="space-y-2">
      <div>
        <label className="text-xs font-semibold text-gray-600">Assign all rows to</label>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.team ?? "—"})</option>)}
        </select>
      </div>
      {/* defaultDupMode "skip" — pre-assigned MIS lists are existing clients; the
          common intent is to add the agent's NEW rows and not disturb existing
          leads. Admin can switch to merge/update in the wizard. */}
      <LeadImportWizard
        mode="csv"
        extraFields={agentId ? { assignToUserId: agentId } : {}}
        defaultDupMode="skip"
        compact
      />
    </div>
  );
}
