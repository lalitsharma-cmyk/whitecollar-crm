"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

interface Agent { id: string; name: string; team: string | null; }

/**
 * Pre-assigned CSV/Excel import — admin uploads an agent's existing-client
 * list (e.g. "Mehak MIS.xlsx") and every row gets pre-assigned to that agent.
 * No round-robin. Status bumped to CONTACTED on intake.
 */
export default function PreAssignedImporter({ agents }: { agents: Agent[] }) {
  const router = useRouter();
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function upload() {
    if (!file || !agentId || busy) return;
    setBusy(true); setMsg(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("assignToUserId", agentId);
      const r = await fetch("/api/intake/csv", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error ?? "Failed"); return; }
      const agentName = agents.find(a => a.id === agentId)?.name ?? "agent";
      setMsg(`✓ Created ${j.created ?? 0} new + skipped ${j.deduped ?? 0} duplicates — all assigned to ${agentName}.`);
      setFile(null);
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div className="space-y-2">
      <div>
        <label className="text-xs font-semibold text-gray-600">Assign all rows to</label>
        <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="w-full mt-1 border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm">
          {agents.map((a) => <option key={a.id} value={a.id}>{a.name} ({a.team ?? "—"})</option>)}
        </select>
      </div>
      <div>
        <input type="file" accept=".csv,.xlsx,.xlsm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm w-full" />
        {file && <div className="text-[10px] text-gray-600 mt-1">Selected: {file.name} ({(file.size/1024).toFixed(0)}kb)</div>}
      </div>
      <button onClick={upload} disabled={!file || !agentId || busy} className="btn btn-primary text-xs w-full justify-center">
        {busy ? "Uploading…" : "Import + pre-assign"}
      </button>
      {msg && <div className={`text-[11px] ${msg.startsWith("✓") ? "text-emerald-700" : "text-red-700"}`}>{msg}</div>}
    </div>
  );
}
