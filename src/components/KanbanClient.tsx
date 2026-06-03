"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StageDurationBadge from "@/components/StageDurationBadge";

// Types — match the server component's select
interface KanbanLead {
  id: string;
  name: string;
  phone: string | null;
  status: string;
  potential: string | null;
  followupDate: string | null;
  forwardedTeam: string | null;
  updatedAt: string;
  owner: { name: string } | null;
}

interface Props {
  grouped: Record<string, KanbanLead[]>;
  stages: string[];
  stageLabel: Record<string, string>;
  stageColor: Record<string, string>;
}

function PotentialBadge({ potential }: { potential: string | null }) {
  if (potential === "HIGH") return <span title="High potential">🔥</span>;
  if (potential === "MEDIUM") return <span title="Medium potential">🌤</span>;
  if (potential === "LOW") return <span title="Low potential">❄</span>;
  return null;
}

function KanbanCard({
  lead,
  stages,
  stageLabel,
}: {
  lead: KanbanLead;
  stages: string[];
  stageLabel: Record<string, string>;
}) {
  const router = useRouter();
  const [moving, setMoving] = useState(false);

  async function handleMove(newStage: string) {
    if (!newStage || newStage === lead.status) return;
    setMoving(true);
    try {
      await fetch(`/api/leads/${lead.id}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStage }),
      });
      router.refresh();
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="bg-white dark:bg-slate-800 shadow-sm rounded-lg p-3 space-y-1.5 border border-gray-100 dark:border-slate-700">
      {/* Name + potential */}
      <div className="flex items-start gap-1">
        <Link
          href={`/leads/${lead.id}`}
          className="font-semibold text-sm text-[#0b1a33] dark:text-slate-100 hover:underline leading-tight flex-1 min-w-0 truncate"
        >
          {lead.name}
        </Link>
        <PotentialBadge potential={lead.potential} />
      </div>

      {/* Stage duration */}
      <StageDurationBadge since={lead.updatedAt} />

      {/* Follow-up date */}
      {lead.followupDate && (
        <p className="text-[11px] text-gray-400 dark:text-slate-500">
          📅 {lead.followupDate}
        </p>
      )}

      {/* Owner */}
      {lead.owner && (
        <p className="text-[11px] text-gray-400 dark:text-slate-500 truncate">
          👤 {lead.owner.name}
        </p>
      )}

      {/* Move stage selector */}
      <select
        disabled={moving}
        defaultValue=""
        onChange={(e) => {
          handleMove(e.target.value);
          // Reset to placeholder after triggering
          e.target.value = "";
        }}
        className="w-full text-[11px] border border-gray-200 dark:border-slate-600 rounded px-1.5 py-1 bg-gray-50 dark:bg-slate-700 text-gray-600 dark:text-slate-300 cursor-pointer disabled:opacity-50"
      >
        <option value="" disabled>
          {moving ? "Moving…" : "Move to →"}
        </option>
        {stages
          .filter((s) => s !== lead.status)
          .map((s) => (
            <option key={s} value={s}>
              {stageLabel[s] ?? s}
            </option>
          ))}
      </select>
    </div>
  );
}

export default function KanbanClient({ grouped, stages, stageLabel, stageColor }: Props) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-4 -mx-3 px-3 lg:mx-0 lg:px-0">
      {stages.map((stage) => {
        const cards = grouped[stage] ?? [];
        const colColor = stageColor[stage] ?? "bg-gray-100";
        return (
          <div
            key={stage}
            className={`flex-none w-[240px] rounded-xl ${colColor} dark:bg-slate-800/50 flex flex-col`}
          >
            {/* Column header */}
            <div className="px-3 pt-3 pb-2 flex items-center justify-between">
              <span className="text-xs font-bold text-gray-700 dark:text-slate-200 uppercase tracking-wide">
                {stageLabel[stage] ?? stage}
              </span>
              <span className="text-[11px] font-semibold bg-white dark:bg-slate-700 text-gray-500 dark:text-slate-400 rounded-full px-2 py-0.5 shadow-sm">
                {cards.length}
              </span>
            </div>

            {/* Cards */}
            <div className="flex-1 px-2 pb-3 space-y-2 overflow-y-auto max-h-[calc(100vh-14rem)]">
              {cards.length === 0 ? (
                <p className="text-[11px] text-gray-400 dark:text-slate-500 text-center py-4">
                  No leads
                </p>
              ) : (
                cards.map((lead) => (
                  <KanbanCard
                    key={lead.id}
                    lead={lead}
                    stages={stages}
                    stageLabel={stageLabel}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
