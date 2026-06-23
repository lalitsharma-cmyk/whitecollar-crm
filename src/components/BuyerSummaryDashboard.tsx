import type { BuyerSummary } from "@/lib/buyerPerformance";

// ─────────────────────────────────────────────────────────────────────────
// Admin summary dashboard — the top-of-report pool-health strip. Pipeline-wide
// counts (point-in-time, like the lead report's "active book"): Total · Assigned ·
// Unassigned (Admin Pool) · Converted · Rejected · Returned To Pool · Active.
// All exclude soft-deleted buyers. Pure server render of the BuyerSummary.
// ─────────────────────────────────────────────────────────────────────────

function num(n: number): string {
  return n.toLocaleString("en-IN");
}

const CARDS: Array<{
  key: keyof BuyerSummary;
  label: string;
  hint: string;
  accent: string;
}> = [
  { key: "total", label: "Total Buyer Records", hint: "All live records", accent: "border-slate-400 text-slate-800" },
  { key: "assigned", label: "Assigned", hint: "Currently being worked", accent: "border-blue-500 text-blue-800" },
  { key: "unassigned", label: "Unassigned (Admin Pool)", hint: "Sitting in the pool", accent: "border-gray-400 text-gray-700" },
  { key: "converted", label: "Converted To Leads", hint: "Became real leads", accent: "border-emerald-500 text-emerald-800" },
  { key: "rejected", label: "Rejected By Agents", hint: "Terminal reject", accent: "border-rose-500 text-rose-800" },
  { key: "returnedToPool", label: "Returned To Admin Pool", hint: "Back in the pool", accent: "border-amber-500 text-amber-800" },
  { key: "active", label: "Active Buyer Records", hint: "Assigned, not closed", accent: "border-indigo-500 text-indigo-800" },
];

export default function BuyerSummaryDashboard({ summary }: { summary: BuyerSummary }) {
  return (
    <div>
      <h2 className="text-sm font-bold text-gray-700 mb-2">Admin summary — buyer pool health</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-2">
        {CARDS.map((c) => (
          <div key={c.key} className={`card p-3 border-l-4 ${c.accent.split(" ")[0]}`}>
            <div className={`text-xl font-extrabold ${c.accent.split(" ")[1]}`}>{num(summary[c.key])}</div>
            <div className="text-[10px] text-gray-600 mt-0.5 leading-tight font-medium">{c.label}</div>
            <div className="text-[9px] text-gray-400 leading-tight">{c.hint}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
