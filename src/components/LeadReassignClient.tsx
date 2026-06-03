"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Agent { id: string; name: string; role: string; team: string | null; }

interface Props {
  leadId: string;
  currentOwnerId: string | null;
  agents: Agent[];
  leadTeam?: string | null;
}

/**
 * Lead reassign dropdown — extracted from LeadActionsClient header so it can
 * live on the RIGHT column of the lead detail page (per Lalit's layout ask:
 * "Reassignment move to Right side"). Same network call, same UX, just lives
 * in a dedicated card so admins/managers can find it without scrolling up to
 * the header action bar.
 */
export default function LeadReassignClient({ leadId, currentOwnerId, agents, leadTeam }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [crossTeamWarn, setCrossTeamWarn] = useState<string | null>(null);
  const [selectedAgentTeam, setSelectedAgentTeam] = useState<string | null>(null);

  async function onReassign(userId: string) {
    if (!userId || userId === currentOwnerId) return;
    setBusy(true);
    setCrossTeamWarn(null);
    try {
      const r = await fetch(`/api/leads/${leadId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (r.ok) {
        const j = await r.json().catch(() => ({}));
        if (j.crossTeamWarning) {
          setCrossTeamWarn(j.crossTeamWarning);
        }
        router.refresh();
      }
    } finally { setBusy(false); }
  }

  function onSelect(userId: string) {
    const agent = agents.find((a) => a.id === userId) ?? null;
    setSelectedAgentTeam(agent?.team ?? null);
    onReassign(userId);
  }

  return (
    <div className="card p-4">
      <div className="font-semibold mb-2 text-sm flex items-center gap-2">
        🔁 Reassign lead
        <span className="text-[10px] text-gray-400 font-normal">(admin / manager)</span>
      </div>
      <select
        defaultValue={currentOwnerId ?? ""}
        disabled={busy}
        onChange={(e) => onSelect(e.target.value)}
        className="w-full text-sm border border-[#e5e7eb] rounded-lg px-3 py-2 min-h-11 bg-white"
        aria-label="Reassign to agent"
      >
        <option value="">— pick agent —</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>{a.name} ({a.team ?? "—"})</option>
        ))}
      </select>
      {selectedAgentTeam && leadTeam && selectedAgentTeam !== leadTeam && (
        <div className="mt-2 text-xs p-2 rounded-lg bg-amber-50 border border-amber-300 text-amber-800">
          ⚠️ Cross-team reassign: this lead is tagged as <b>{leadTeam}</b> but you&apos;re assigning to a <b>{selectedAgentTeam}</b> team agent. The lead&apos;s team tag will remain unchanged — update it manually if needed.
        </div>
      )}
      {busy && <div className="text-xs text-gray-500 mt-1">Reassigning…</div>}
      {crossTeamWarn && (
        <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          ⚠️ {crossTeamWarn}
        </div>
      )}
    </div>
  );
}
