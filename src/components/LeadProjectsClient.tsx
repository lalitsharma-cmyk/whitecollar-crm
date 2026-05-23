"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Plus } from "lucide-react";

interface Project { id: string; name: string; city: string; }
interface Discussion {
  projectId: string;
  status: "DISCUSSED" | "SHORTLISTED" | "SITE_VISITED" | "RULED_OUT";
  project: { name: string; city: string };
  discussedAt: string;
}

const statusChip: Record<string, string> = {
  DISCUSSED:    "src",
  SHORTLISTED:  "chip-warm",
  SITE_VISITED: "chip-won",
  RULED_OUT:    "chip-lost",
};

export default function LeadProjectsClient({ leadId, initial, allProjects }: { leadId: string; initial: Discussion[]; allProjects: Project[]; }) {
  const router = useRouter();
  const [items, setItems] = useState(initial);
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState("");
  const [busy, setBusy] = useState(false);

  const remaining = allProjects.filter((p) => !items.some((it) => it.projectId === p.id));

  async function addProject() {
    if (!picked) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/discuss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: picked, status: "DISCUSSED" }),
      });
      if (r.ok) router.refresh();
      setPicking(false); setPicked("");
    } finally { setBusy(false); }
  }
  async function removeProject(projectId: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/discuss`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      if (r.ok) {
        setItems((arr) => arr.filter((it) => it.projectId !== projectId));
        router.refresh();
      }
    } finally { setBusy(false); }
  }
  async function changeStatus(projectId: string, status: string) {
    setBusy(true);
    try {
      await fetch(`/api/leads/${leadId}/discuss`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, status }),
      });
      router.refresh();
    } finally { setBusy(false); }
  }

  return (
    <div>
      <div className="font-semibold mb-2">Projects discussed</div>
      {items.length === 0 && <div className="text-sm text-gray-500 mb-2">None yet — add a project once it's mentioned.</div>}
      <div className="space-y-2">
        {items.map((it) => (
          <div key={it.projectId} className="flex items-center gap-2 p-2 border border-[#e5e7eb] rounded-lg text-sm">
            <div className="flex-1">
              <div className="font-semibold">{it.project.name}</div>
              <div className="text-xs text-gray-500">{it.project.city}</div>
            </div>
            <select value={it.status} onChange={(e) => changeStatus(it.projectId, e.target.value)} disabled={busy}
              className={`chip ${statusChip[it.status]} border-0 outline-none text-[10px]`}>
              <option value="DISCUSSED">Discussed</option>
              <option value="SHORTLISTED">Shortlisted</option>
              <option value="SITE_VISITED">Site visited</option>
              <option value="RULED_OUT">Ruled out</option>
            </select>
            <button onClick={() => removeProject(it.projectId)} disabled={busy} className="text-gray-400 hover:text-red-500"><X className="w-4 h-4" /></button>
          </div>
        ))}
      </div>
      {!picking && remaining.length > 0 && (
        <button onClick={() => setPicking(true)} className="text-xs text-[#0b1a33] font-semibold mt-3 flex items-center gap-1"><Plus className="w-3 h-3" /> Add project</button>
      )}
      {picking && (
        <div className="mt-3 flex items-center gap-2">
          <select value={picked} onChange={(e) => setPicked(e.target.value)} className="flex-1 border border-[#e5e7eb] rounded-lg px-2 py-1 text-sm">
            <option value="">— pick a project —</option>
            {remaining.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.city})</option>)}
          </select>
          <button onClick={addProject} disabled={!picked || busy} className="btn btn-primary text-xs">Add</button>
          <button onClick={() => { setPicking(false); setPicked(""); }} className="text-xs text-gray-500">Cancel</button>
        </div>
      )}
    </div>
  );
}
