"use client";
import { useState } from "react";
import Link from "next/link";
import LeadBulkActions from "./LeadBulkActions";

interface Row {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  source: string;
  statusName: string;
  srcChip: string;
  srcLabel: string;
  statusChip: string;
  aiScore: string | null;
  aiScoreValue: number | null;
  team: string | null;
  owner: { name: string; avatarColor: string } | null;
  budget: string | null;
  interest: string | null;
  lastTouched: string;
}

const aiChip = (s: string | null) => s === "HOT" ? "chip-hot" : s === "WARM" ? "chip-warm" : s === "COLD" ? "chip-cold" : "chip-lost";

export default function LeadsListClient({ leads, canBulk, agents }: { leads: Row[]; canBulk: boolean; agents: { id: string; name: string; team: string | null }[]; }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    if (selected.size === leads.length) setSelected(new Set());
    else setSelected(new Set(leads.map((l) => l.id)));
  }
  const allChecked = leads.length > 0 && selected.size === leads.length;

  return (
    <>
      <div className="card overflow-hidden">
        <table className="tbl">
          <thead>
            <tr>
              <th>{canBulk && <input type="checkbox" checked={allChecked} onChange={toggleAll} />}</th>
              <th>Lead</th>
              <th>Team</th>
              <th>Source</th>
              <th>Budget</th>
              <th>Stage</th>
              <th>AI</th>
              <th>Owner</th>
              <th>Last touch</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 && (
              <tr><td colSpan={10} className="text-center py-8 text-gray-500">No leads match these filters. Try clearing some.</td></tr>
            )}
            {leads.map((l) => {
              const teamChip = l.team === "India" ? "src-csv" : "src-wa";
              return (
                <tr key={l.id} className={selected.has(l.id) ? "bg-blue-50/50" : ""}>
                  <td>{canBulk && <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />}</td>
                  <td>
                    <Link href={`/leads/${l.id}`} className="font-semibold text-[#0b1a33] hover:underline">{l.name}</Link>
                    <div className="text-xs text-gray-500">{l.phone}{l.email ? ` · ${l.email}` : ""}</div>
                    {l.interest && <div className="text-[11px] text-gray-500">→ {l.interest}</div>}
                  </td>
                  <td>{l.team ? <span className={`chip ${teamChip}`}>{l.team}</span> : <span className="text-gray-400">—</span>}</td>
                  <td><span className={`chip ${l.srcChip}`}>{l.srcLabel}</span></td>
                  <td className="text-sm font-semibold">{l.budget ?? <span className="text-gray-400 font-normal">—</span>}</td>
                  <td><span className={`chip ${l.statusChip}`}>{l.statusName.replaceAll("_", " ")}</span></td>
                  <td>{l.aiScore ? <span className={`chip ${aiChip(l.aiScore)}`}>{l.aiScore} · {l.aiScoreValue}</span> : <span className="text-gray-400">—</span>}</td>
                  <td>{l.owner ? <div className={`avatar ${l.owner.avatarColor}`} title={l.owner.name}>{l.owner.name.split(" ").map(s => s[0]).slice(0, 2).join("")}</div> : <span className="text-gray-400">—</span>}</td>
                  <td className="text-xs text-gray-500">{l.lastTouched}</td>
                  <td>⋯</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {canBulk && <LeadBulkActions selectedIds={Array.from(selected)} agents={agents} onClear={() => setSelected(new Set())} />}
    </>
  );
}
