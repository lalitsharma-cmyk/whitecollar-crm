"use client";
import { useState } from "react";
import Link from "next/link";
import { Phone, MessageCircle } from "lucide-react";
import LeadBulkActions from "./LeadBulkActions";
import { telLink, whatsappLink } from "@/lib/phone";

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

export default function LeadsListClient({ leads, canBulk, agents, showSource = true }: { leads: Row[]; canBulk: boolean; agents: { id: string; name: string; team: string | null }[]; showSource?: boolean; }) {
  // showSource = false → hide the source column + chip from agents.
  // Lalit's policy: agents shouldn't see where each lead came from (avoids them
  // cherry-picking high-converting sources or gaming the round-robin pool).
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
      {/* MOBILE: card list */}
      <div className="lg:hidden space-y-2">
        {leads.length === 0 && <div className="card p-6 text-center text-gray-500 text-sm">No leads match these filters.</div>}
        {leads.map((l) => {
          const teamChip = l.team === "India" ? "src-csv" : "src-wa";
          return (
            <div key={l.id} className="card p-3 active:bg-amber-50">
              <div className="flex items-start gap-2">
                {canBulk && (
                  <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} className="mt-1" />
                )}
                <Link href={`/leads/${l.id}`} className="flex-1 min-w-0 block">
                  <div className="flex items-center justify-between gap-1">
                    <div className="font-bold text-sm truncate">{l.name}</div>
                    {l.aiScore && <span className={`chip ${aiChip(l.aiScore)} text-[9px] flex-none`}>{l.aiScore}</span>}
                  </div>
                  {/* Phone gets its own line — email moved to lead detail page only.
                      Lalit asked: "no need to show email id here" and "number should
                      be shown under number field". */}
                  {l.phone && (
                    <div className="text-[11px] text-gray-600 truncate mt-0.5">📞 {l.phone}</div>
                  )}
                  <div className="flex items-center gap-1 mt-1 flex-wrap">
                    <span className={`chip ${l.statusChip} text-[9px]`}>{l.statusName.replaceAll("_", " ")}</span>
                    {showSource && <span className={`chip ${l.srcChip} text-[9px]`}>{l.srcLabel}</span>}
                    {l.team && <span className={`chip ${teamChip} text-[9px]`}>{l.team}</span>}
                  </div>
                  <div className="flex items-center justify-between mt-1.5 text-[11px]">
                    <span className="font-semibold">{l.budget ?? "—"}</span>
                    <span className="text-gray-500">
                      {l.owner ? <span className={`avatar ${l.owner.avatarColor} inline-flex w-5 h-5 text-[9px] mr-1`}>{l.owner.name.split(" ").map(s=>s[0]).slice(0,2).join("")}</span> : "—"}
                      · {l.lastTouched}
                    </span>
                  </div>
                  {l.interest && <div className="text-[10px] text-gray-500 mt-1 truncate">→ {l.interest}</div>}
                </Link>
                {/* Direct-action icons on the right edge of each mobile lead
                    card. One-tap call or WhatsApp without having to drill into
                    the lead detail page. Lalit's ask: "Mobile call, whatsapp
                    icon". stopPropagation isn't needed — these are siblings of
                    the Link now, not nested inside it. */}
                {l.phone && (
                  <div className="flex flex-col gap-1.5 flex-none">
                    <a
                      href={telLink(l.phone) || "#"}
                      aria-label={`Call ${l.name}`}
                      className="w-10 h-10 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-sm active:bg-emerald-700"
                    >
                      <Phone className="w-4 h-4" />
                    </a>
                    <a
                      href={whatsappLink(l.phone) || "#"}
                      target="_blank" rel="noopener noreferrer"
                      aria-label={`WhatsApp ${l.name}`}
                      className="w-10 h-10 rounded-full bg-[#25D366] text-white flex items-center justify-center shadow-sm active:bg-[#1ea953]"
                    >
                      <MessageCircle className="w-4 h-4" />
                    </a>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* DESKTOP: full table */}
      <div className="hidden lg:block card overflow-hidden">
        <table className="tbl">
          <thead>
            <tr>
              <th>{canBulk && <input type="checkbox" checked={allChecked} onChange={toggleAll} />}</th>
              <th>Lead</th>
              <th>Team</th>
              {showSource && <th>Source</th>}
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
              <tr><td colSpan={showSource ? 10 : 9} className="text-center py-8 text-gray-500">No leads match these filters. Try clearing some.</td></tr>
            )}
            {leads.map((l) => {
              const teamChip = l.team === "India" ? "src-csv" : "src-wa";
              return (
                <tr key={l.id} className={selected.has(l.id) ? "bg-blue-50/50" : ""}>
                  <td>{canBulk && <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggle(l.id)} />}</td>
                  <td>
                    <Link href={`/leads/${l.id}`} className="font-semibold text-[#0b1a33] hover:underline">{l.name}</Link>
                    {/* Phone on its own line (no email). Email is on the lead detail page only. */}
                    {l.phone && <div className="text-xs text-gray-500">📞 {l.phone}</div>}
                    {l.interest && <div className="text-[11px] text-gray-500">→ {l.interest}</div>}
                  </td>
                  <td>{l.team ? <span className={`chip ${teamChip}`}>{l.team}</span> : <span className="text-gray-400">—</span>}</td>
                  {showSource && <td><span className={`chip ${l.srcChip}`}>{l.srcLabel}</span></td>}
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
