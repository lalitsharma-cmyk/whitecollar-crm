"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Check } from "lucide-react";
import { fmtMoney, type Currency } from "@/lib/money";

export interface SuggestedUnitDTO {
  id: string;
  code: string;
  configuration: string;
  carpetArea: number | null;
  floor: number | null;
  view: string | null;
  priceBase: number;
  score: number;
  project: {
    id: string;
    name: string;
    city: string;
    country: string;
    area: string | null;
    heroColor: string | null;
  };
}

export default function SuggestedUnitsCard({
  leadId,
  units,
  alreadyAddedUnitIds,
}: {
  leadId: string;
  units: SuggestedUnitDTO[];
  alreadyAddedUnitIds: string[];
}) {
  const router = useRouter();
  const [added, setAdded] = useState<Set<string>>(new Set(alreadyAddedUnitIds));
  const [busyId, setBusyId] = useState<string | null>(null);

  async function addInterested(unitId: string) {
    if (added.has(unitId) || busyId) return;
    setBusyId(unitId);
    try {
      const r = await fetch(`/api/leads/${leadId}/interested`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unitId, type: "COMPARE" }),
      });
      if (r.ok) {
        setAdded((prev) => new Set(prev).add(unitId));
        router.refresh();
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card p-5 border-l-4 border-[#c9a24b]">
      <div className="flex items-center justify-between mb-1">
        <div className="font-semibold flex items-center gap-2">
          <span className="ai-tag">MATCH</span>
          Suggested units
        </div>
        <span className="text-[10px] text-gray-500">best-fit by budget · config</span>
      </div>
      <div className="text-xs text-gray-500 mb-3">Top {units.length} from current inventory.</div>
      <div className="space-y-2">
        {units.map((u) => {
          const currency: Currency = u.project.country === "India" ? "INR" : "AED";
          const isAdded = added.has(u.id);
          const isBusy = busyId === u.id;
          return (
            <div key={u.id} className="border border-[#e5e7eb] rounded-lg p-2.5 text-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{u.project.name}</div>
                  <div className="text-xs text-gray-500 truncate">
                    {u.configuration} · {u.code}
                    {u.project.area ? ` · ${u.project.area}` : ""}
                  </div>
                  <div className="text-xs text-gray-700 mt-0.5 font-semibold">
                    {fmtMoney(u.priceBase, currency)}
                    {u.view && <span className="font-normal text-gray-500"> · {u.view}</span>}
                    {u.floor != null && <span className="font-normal text-gray-500"> · Fl {u.floor}</span>}
                  </div>
                </div>
                <button
                  onClick={() => addInterested(u.id)}
                  disabled={isAdded || isBusy}
                  className={`text-[10px] px-2 py-1 rounded-md font-semibold whitespace-nowrap flex items-center gap-1 ${
                    isAdded
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200 cursor-default"
                      : "bg-[#0b1a33] text-white hover:bg-[#1a2d50] disabled:opacity-50"
                  }`}
                  title={isAdded ? "Already in interested list" : "Add to interested properties"}
                >
                  {isAdded ? (
                    <>
                      <Check className="w-3 h-3" /> Added
                    </>
                  ) : (
                    <>
                      <Plus className="w-3 h-3" /> {isBusy ? "..." : "Add as interested"}
                    </>
                  )}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
