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
          // Mobile-friendly row: stacks vertically on small screens so the project
          // name + status chip + delete don't get squashed together (the old single-row
          // layout broke on phones — name truncated, chip+x overlapped).
          <div key={it.projectId} className="flex flex-col sm:flex-row sm:items-center gap-2 p-2.5 border border-[#e5e7eb] rounded-lg text-sm">
            <div className="flex-1 min-w-0">
              <div className="font-semibold truncate">{it.project.name}</div>
              <div className="text-xs text-gray-500 truncate">{it.project.city}</div>
            </div>
            <div className="flex items-center gap-2 flex-none">
              <select
                value={it.status}
                onChange={(e) => changeStatus(it.projectId, e.target.value)}
                disabled={busy}
                className={`chip ${statusChip[it.status]} border-0 outline-none text-[10px] flex-1 sm:flex-none min-h-9 sm:min-h-0`}
              >
                <option value="DISCUSSED">Discussed</option>
                <option value="SHORTLISTED">Shortlisted</option>
                <option value="SITE_VISITED">Site visited</option>
                <option value="RULED_OUT">Ruled out</option>
              </select>
              <button
                onClick={() => removeProject(it.projectId)}
                disabled={busy}
                aria-label="Remove project"
                className="text-gray-400 hover:text-red-500 p-2 -m-2 flex-none min-w-11 min-h-11 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
      {!picking && remaining.length > 0 && (
        <button
          onClick={() => setPicking(true)}
          className="text-sm text-[#0b1a33] font-semibold mt-3 flex items-center gap-1.5 min-h-11 px-1"
        >
          <Plus className="w-4 h-4" /> Add project
        </button>
      )}
      {picking && (
        // Mobile-friendly picker: full-width select on its own row, then Add/Cancel
        // side-by-side beneath. Previously the three controls were forced into one
        // row and the picker got clipped off-screen on phones.
        <div className="mt-3 flex flex-col gap-2">
          <select
            value={picked}
            onChange={(e) => setPicked(e.target.value)}
            className="w-full border border-[#e5e7eb] rounded-lg px-3 py-2.5 text-sm min-h-11"
            autoFocus
          >
            <option value="">— pick a project —</option>
            {remaining.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.city})</option>)}
          </select>
          <div className="flex gap-2">
            <button
              onClick={addProject}
              disabled={!picked || busy}
              className="btn btn-primary text-sm flex-1 justify-center min-h-11"
            >
              {busy ? "Adding…" : "Add"}
            </button>
            <button
              onClick={() => { setPicking(false); setPicked(""); }}
              className="btn btn-ghost text-sm flex-1 justify-center min-h-11"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
