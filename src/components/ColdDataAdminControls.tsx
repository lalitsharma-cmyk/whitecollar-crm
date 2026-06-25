"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Users, X } from "lucide-react";
import LeadImportWizard from "./LeadImportWizard";

interface Agent { id: string; name: string; team: string | null; }

/**
 * Admin/Manager bar above the Cold Data list:
 *  - Import CSV/Excel — runs the shared Import-Mapping-Approval wizard with the
 *    isColdCall=true preset (preview → confirm mapping → data preview + dup flags
 *    → dup choice → report). Every imported row is cold + left unassigned.
 *  - Bulk assign unassigned cold data to a chosen agent (round-robin
 *    within team also supported via a quick-pick)
 */
export default function ColdDataAdminControls({ agents }: { agents: Agent[] }) {
  const router = useRouter();
  const [showImport, setShowImport] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [assignTo, setAssignTo] = useState<string>(agents[0]?.id ?? "");
  const [assignTeam, setAssignTeam] = useState<"" | "Dubai" | "India">("");
  const [assignCount, setAssignCount] = useState(20);
  const [crossTeamWarn, setCrossTeamWarn] = useState<string | null>(null);

  async function doBulkAssign() {
    if (!assignTo || busy) return;
    setBusy(true); setMsg(null); setCrossTeamWarn(null);
    try {
      const r = await fetch("/api/cold-data/bulk-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: assignTo, team: assignTeam || undefined, count: assignCount }),
      });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error ?? "Assign failed"); return; }
      setMsg(`✓ Assigned ${j.assigned} cold-data rows to ${agents.find(a => a.id === assignTo)?.name}.`);
      if (j.crossTeamWarningMessage) {
        setCrossTeamWarn(j.crossTeamWarningMessage);
      }
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div className="flex flex-wrap gap-2 items-start">
      <button onClick={() => setShowImport(true)} className="btn btn-ghost text-xs"><Upload className="w-3 h-3" /> Import cold data</button>
      <button onClick={() => setShowAssign(true)} className="btn btn-primary text-xs"><Users className="w-3 h-3" /> Assign to agent</button>
      {msg && <div className={`text-[11px] mt-2 w-full ${msg.startsWith("✓") ? "text-emerald-700" : "text-red-700"}`}>{msg}</div>}
      {crossTeamWarn && <div className="text-[11px] mt-1 w-full text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">⚠️ {crossTeamWarn}</div>}

      {/* Import modal — shared mapping wizard, cold-data preset */}
      {showImport && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setShowImport(false)}>
          <div className="bg-white rounded-xl max-w-lg w-full p-5 shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-lg">Import cold-data batch</div>
              <button onClick={() => setShowImport(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-gray-600 mb-3">
              Upload an Excel (.xlsx) or CSV file, then review the column mapping and a data preview before importing.
              Every imported row is marked as cold data and left unassigned (assign them below afterwards).
            </p>
            {/* isColdCall=true rides along on preview + import. defaultDupMode
                "revival" — the Revival Engine exists to RE-ENGAGE leads that
                already exist, so an existing-lead match is PROCESSED (fill-if-empty
                merge + appended history + moved into Revival), never skipped. The
                admin can still pick Skip per-import. (Was "skip", which discarded
                every match → "Import 0 new leads".) */}
            <LeadImportWizard
              mode="csv"
              extraFields={{ isColdCall: "true" }}
              defaultDupMode="revival"
              compact
              onDone={() => router.refresh()}
            />
          </div>
        </div>
      )}

      {/* Assign modal */}
      {showAssign && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setShowAssign(false)}>
          <div className="bg-white rounded-xl max-w-md w-full p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-lg">Assign unassigned cold data</div>
              <button onClick={() => setShowAssign(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-600">Assign to</label>
                <select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.team ?? "—"})</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">Filter by team (optional)</label>
                <select value={assignTeam} onChange={(e) => setAssignTeam(e.target.value as "" | "Dubai" | "India")} className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
                  <option value="">Any team</option>
                  <option value="Dubai">Dubai Team</option>
                  <option value="India">India Team</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">How many rows to assign?</label>
                <input type="number" min="1" max="500" value={assignCount} onChange={(e) => setAssignCount(Number(e.target.value) || 0)} className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setShowAssign(false)} disabled={busy} className="btn btn-ghost text-sm">Cancel</button>
              <button onClick={doBulkAssign} disabled={busy || !assignTo} className="btn btn-primary text-sm">{busy ? "Assigning…" : `Assign ${assignCount}`}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
