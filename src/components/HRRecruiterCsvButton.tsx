"use client";
import { Download } from "lucide-react";

export interface RecruiterRow {
  name: string;
  calls: number;
  added: number;
  sched: number;
  done: number;
  short: number;
  off: number;
  join: number;
}

const COLS: [string, keyof RecruiterRow][] = [
  ["Recruiter", "name"],
  ["Calls", "calls"],
  ["Added", "added"],
  ["Interviews Scheduled", "sched"],
  ["Interviews Done", "done"],
  ["Shortlisted", "short"],
  ["Offers", "off"],
  ["Joined", "join"],
];

function cell(v: string | number) {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Client-side CSV export of the recruiter-performance table (no extra API route).
export default function HRRecruiterCsvButton({ rows, period }: { rows: RecruiterRow[]; period: string }) {
  const download = () => {
    const header = COLS.map(c => c[0]).join(",");
    const body = rows.map(r => COLS.map(([, k]) => cell(r[k])).join(",")).join("\n");
    const csv = "﻿" + [header, body].filter(Boolean).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `recruiter-performance-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <button
      type="button"
      onClick={download}
      disabled={rows.length === 0}
      className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <Download className="w-3.5 h-3.5" />
      Export CSV
    </button>
  );
}
