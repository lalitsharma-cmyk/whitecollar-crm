"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, Users, X } from "lucide-react";

interface Agent { id: string; name: string; team: string | null; }

/**
 * Admin/Manager bar above the Cold Data list:
 *  - Import CSV/Excel — uploads file with isColdCall=true preset
 *  - Bulk assign unassigned cold data to a chosen agent (round-robin
 *    within team also supported via a quick-pick)
 */
export default function ColdDataAdminControls({ agents }: { agents: Agent[] }) {
  const router = useRouter();
  const [showImport, setShowImport] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [assignTo, setAssignTo] = useState<string>(agents[0]?.id ?? "");
  const [assignTeam, setAssignTeam] = useState<"" | "Dubai" | "India">("");
  const [assignCount, setAssignCount] = useState(20);
  const [crossTeamWarn, setCrossTeamWarn] = useState<string | null>(null);

  async function doImport() {
    if (!file || busy) return;
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("isColdCall", "true");
      const r = await fetch("/api/intake/csv", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error ?? "Import failed"); return; }
      setMsg(`✓ Imported ${j.created ?? 0} new + skipped ${j.deduped ?? 0} duplicates. Now assign them below.`);
      setFile(null);
      router.refresh();
    } finally { setBusy(false); }
  }

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

      {/* Import modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => !busy && setShowImport(false)}>
          <div className="bg-white rounded-xl max-w-md w-full p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <div className="font-semibold text-lg">Import cold-data batch</div>
              <button onClick={() => setShowImport(false)} className="text-gray-400 hover:text-gray-700"><X className="w-5 h-5" /></button>
            </div>
            <p className="text-xs text-gray-600 mb-3">
              Upload an Excel (.xlsx) or CSV file. Columns we auto-detect:
              <code className="text-[10px] block mt-1 bg-gray-50 p-2 rounded">name, phone, email, city, configuration, budget, source, whoIsClient, alreadyBought, alreadyBoughtBy</code>
              Every imported row is marked as cold data and left unassigned.
            </p>
            <label className="block cursor-pointer">
              <input
                type="file"
                accept=".csv,.xlsx,.xlsm"
                className="sr-only"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <span className="flex items-center justify-center gap-2 w-full rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-600 hover:border-blue-400 hover:bg-blue-50 transition-colors">
                <Upload className="w-4 h-4 flex-shrink-0" />
                {file ? file.name : "Choose file (CSV or Excel)…"}
              </span>
            </label>
            {file && <div className="text-[11px] mt-1 text-gray-500">{(file.size/1024).toFixed(0)} KB selected</div>}
            <div className="flex gap-2 mt-4 justify-end">
              <button onClick={() => setShowImport(false)} disabled={busy} className="btn btn-ghost text-sm">Cancel</button>
              <button onClick={doImport} disabled={busy || !file} className="btn btn-primary text-sm">{busy ? "Uploading…" : "Import"}</button>
            </div>
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
