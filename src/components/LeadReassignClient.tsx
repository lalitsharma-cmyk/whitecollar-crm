"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Agent { id: string; name: string; role: string; team: string | null; }

interface Props {
  leadId: string;
  currentOwnerId: string | null;
  agents: Agent[];
}

/**
 * Lead reassign dropdown — extracted from LeadActionsClient header so it can
 * live on the RIGHT column of the lead detail page (per Lalit's layout ask:
 * "Reassignment move to Right side"). Same network call, same UX, just lives
 * in a dedicated card so admins/managers can find it without scrolling up to
 * the header action bar.
 */
export default function LeadReassignClient({ leadId, currentOwnerId, agents }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onReassign(userId: string) {
    if (!userId || userId === currentOwnerId) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (r.ok) router.refresh();
    } finally { setBusy(false); }
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
        onChange={(e) => onReassign(e.target.value)}
        className="w-full text-sm border border-[#e5e7eb] rounded-lg px-3 py-2 min-h-11 bg-white"
        aria-label="Reassign to agent"
      >
        <option value="">— pick agent —</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>{a.name} ({a.team ?? "—"})</option>
        ))}
      </select>
      {busy && <div className="text-xs text-gray-500 mt-1">Reassigning…</div>}
    </div>
  );
}
