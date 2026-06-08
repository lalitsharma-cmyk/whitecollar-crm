"use client";
import { useState } from "react";
import Link from "next/link";
import HRFollowUpActions from "@/components/HRFollowUpActions";

export interface FU {
  id: string; candidateId: string; candidateName: string; phone: string | null;
  type: string; dueAt: string; notes: string | null;
}
function fmt(s: string) { return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }
function fmtDateTime(s: string) { const d = new Date(s); return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }); }

export default function HRFollowUpTabs({ today, overdue, upcoming }: { today: FU[]; overdue: FU[]; upcoming: FU[] }) {
  const [tab, setTab] = useState<"today" | "overdue" | "upcoming">(overdue.length > 0 ? "overdue" : "today");
  const lists = { today, overdue, upcoming };
  const list = lists[tab];
  const tabs: [typeof tab, string, number][] = [["today", "Today", today.length], ["overdue", "Overdue", overdue.length], ["upcoming", "Upcoming", upcoming.length]];

  return (
    <div className="bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-700 overflow-hidden">
      <div className="flex border-b border-gray-100 dark:border-slate-800">
        {tabs.map(([k, label, n]) => (
          <button key={k} type="button" onClick={() => setTab(k)}
            className={`flex-1 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition ${tab === k ? "border-[#1a2e4a] text-[#1a2e4a] dark:border-blue-400 dark:text-blue-400" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
            {label} {n > 0 && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${k === "overdue" ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-600"}`}>{n}</span>}
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-gray-400">No {tab} follow-ups.</div>
      ) : (
        <div className="divide-y divide-gray-100 dark:divide-slate-800">
          {list.map(fu => {
            const overdueRow = tab !== "upcoming" && new Date(fu.dueAt) < new Date();
            return (
              <div key={fu.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <Link href={`/hr/candidates/${fu.candidateId}`} className="text-sm font-semibold text-gray-800 dark:text-slate-100 hover:underline">{fu.candidateName}</Link>
                  <div className="text-[11px] text-gray-500">
                    <span className="font-medium text-gray-700 dark:text-slate-300">{fmt(fu.type)}</span>
                    <span className={overdueRow ? "text-red-600 font-semibold ml-1.5" : "text-amber-600 ml-1.5"}>{overdueRow ? "⚠ " : "📅 "}{fmtDateTime(fu.dueAt)}</span>
                    {fu.notes && <span className="text-gray-400 ml-1">· {fu.notes}</span>}
                  </div>
                </div>
                <HRFollowUpActions followUpId={fu.id} candidateId={fu.candidateId} phone={fu.phone} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
