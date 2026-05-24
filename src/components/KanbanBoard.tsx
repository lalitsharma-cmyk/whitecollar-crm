"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { fmtMoney, fmtMoneyDual } from "@/lib/money";

interface Card {
  id: string;
  name: string;
  configuration: string | null;
  budgetMin: number | null;
  budgetCurrency: string;
  ownerName: string | null;
  ownerAvatar: string | null;
  team: string | null;
  aiScore: "HOT" | "WARM" | "COLD" | null;
  aiScoreValue: number | null;
  projectName: string | null;
}

interface Stage { key: string; label: string; }

interface Props {
  stages: Stage[];
  leadsByStage: Record<string, Card[]>;
  agents: { id: string; name: string }[];
}

const aiClass = (s: string | null) => s === "HOT" ? "chip-hot" : s === "WARM" ? "chip-warm" : "chip-cold";
const initialsOf = (n: string) => n.split(" ").map(s => s[0]).slice(0, 2).join("");

export default function KanbanBoard({ stages, leadsByStage, agents }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [hoverStage, setHoverStage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function update(key: string, value: string) {
    const p = new URLSearchParams(sp);
    if (value) p.set(key, value); else p.delete(key);
    router.replace(`${pathname}?${p.toString()}`);
  }

  async function onDrop(stageKey: string, e: React.DragEvent) {
    e.preventDefault();
    setHoverStage(null);
    const leadId = e.dataTransfer.getData("text/lead-id");
    const fromStage = e.dataTransfer.getData("text/from-stage");
    if (!leadId || fromStage === stageKey) return;
    setBusy(true);
    try {
      const r = await fetch(`/api/leads/${leadId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: stageKey }),
      });
      if (r.ok) router.refresh();
    } finally { setBusy(false); }
  }

  // Totals
  const allLeads = Object.values(leadsByStage).flat();
  const aedOpen = allLeads.filter(l => l.budgetCurrency === "AED" && ["QUALIFIED","SITE_VISIT","NEGOTIATION"].includes(stages.find(s => leadsByStage[s.key].includes(l))?.key ?? "")).reduce((s,l) => s + (l.budgetMin ?? 0), 0);
  const inrOpen = allLeads.filter(l => l.budgetCurrency === "INR" && ["QUALIFIED","SITE_VISIT","NEGOTIATION"].includes(stages.find(s => leadsByStage[s.key].includes(l))?.key ?? "")).reduce((s,l) => s + (l.budgetMin ?? 0), 0);

  return (
    <>
      {/* Filter bar */}
      <div className="card p-3 flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-gray-500 mr-1">Filter:</span>
        <select value={sp.get("team") ?? ""} onChange={(e) => update("team", e.target.value)} className="border border-[#e5e7eb] rounded-lg px-3 py-1.5 text-sm">
          <option value="">All teams</option>
          <option value="Dubai">Dubai</option>
          <option value="India">India</option>
        </select>
        <select value={sp.get("owner") ?? ""} onChange={(e) => update("owner", e.target.value)} className="border border-[#e5e7eb] rounded-lg px-3 py-1.5 text-sm">
          <option value="">All owners</option>
          <option value="unassigned">⚠ Unassigned</option>
          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <select value={sp.get("ai") ?? ""} onChange={(e) => update("ai", e.target.value)} className="border border-[#e5e7eb] rounded-lg px-3 py-1.5 text-sm">
          <option value="">AI: any</option>
          <option value="HOT">🔥 Hot</option>
          <option value="WARM">☀ Warm</option>
          <option value="COLD">🧊 Cold</option>
        </select>
        <span className="text-xs text-gray-500 ml-auto">Open value: {fmtMoneyDual({ aed: aedOpen, inr: inrOpen })}</span>
      </div>

      <div className="overflow-x-auto -mx-3 lg:mx-0 px-3 lg:px-0"><div className="grid grid-cols-6 gap-3 min-w-[1080px] lg:min-w-0">
        {stages.map((stage) => {
          const items = leadsByStage[stage.key] ?? [];
          const aedSum = items.filter(l => l.budgetCurrency === "AED").reduce((s,l) => s + (l.budgetMin ?? 0), 0);
          const inrSum = items.filter(l => l.budgetCurrency === "INR").reduce((s,l) => s + (l.budgetMin ?? 0), 0);
          const isHover = hoverStage === stage.key;
          return (
            <div
              key={stage.key}
              className={`col transition-colors ${isHover ? "bg-amber-50 ring-2 ring-[#c9a24b]" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setHoverStage(stage.key); }}
              onDragLeave={() => setHoverStage(null)}
              onDrop={(e) => onDrop(stage.key, e)}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="font-semibold text-sm">{stage.label} <span className="text-gray-500 font-normal">· {items.length}</span></div>
                <span className="text-[10px] text-gray-500">{(aedSum + inrSum) > 0 ? fmtMoneyDual({ aed: aedSum, inr: inrSum }) : "—"}</span>
              </div>
              {items.slice(0, 25).map((l) => (
                <div
                  key={l.id}
                  draggable={!busy}
                  onDragStart={(e) => {
                    e.dataTransfer.setData("text/lead-id", l.id);
                    e.dataTransfer.setData("text/from-stage", stage.key);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  className="kanban-card group cursor-grab active:cursor-grabbing"
                >
                  <Link href={`/leads/${l.id}`} className="block">
                    <div className="font-semibold text-sm truncate">{l.name}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {l.projectName ? l.projectName : l.configuration ?? "—"}
                      {l.budgetMin ? ` · ${fmtMoney(l.budgetMin, l.budgetCurrency)}` : ""}
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      {l.aiScore ? <span className={`chip ${aiClass(l.aiScore)}`}>{l.aiScore} · {l.aiScoreValue}</span> : <span className="text-[10px] text-gray-400">no score</span>}
                      {l.ownerName && <div className={`avatar ${l.ownerAvatar ?? "bg-slate-500"}`} title={l.ownerName}>{initialsOf(l.ownerName)}</div>}
                    </div>
                  </Link>
                </div>
              ))}
              {items.length > 25 && <div className="kanban-card text-xs text-gray-500">+ {items.length - 25} more…</div>}
              {items.length === 0 && <div className="text-xs text-gray-400 text-center py-6">Drop a card here</div>}
            </div>
          );
        })}
      </div></div>
    </>
  );
}
