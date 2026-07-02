// Per-user change report — "what did Tanuj change today / Mehak this week /
// Lalit this month". Reads the LeadFieldHistory audit trail. Admin/manager only.
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { normalizeTeam } from "@/lib/teamRouting";
import { redirect } from "next/navigation";
import Link from "next/link";
import { startOfDay, startOfWeek, startOfMonth } from "date-fns";
import { fmtIST12 } from "@/lib/datetime";
import { formatLeadName } from "@/lib/leadName";
import { canonicalAgentName } from "@/lib/agentName";

export const dynamic = "force-dynamic";

const FIELD_LABEL: Record<string, string> = {
  currentStatus: "Status", status: "Status", budgetMin: "Budget", budgetMax: "Budget (max)",
  budgetCurrency: "Currency", bantStatus: "BANT", ownerId: "Owner", followupDate: "Follow-up",
  source: "Source", leadOrigin: "Section", remarks: "Remarks", city: "City", country: "Country",
  configuration: "Config", needType: "Need", potential: "Potential",
};

export default async function ChangesReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  if (me.role !== "ADMIN" && me.role !== "MANAGER") redirect("/dashboard");
  // Team segregation: a MANAGER only sees changes on THEIR team's leads (and only
  // their team's users in the picker). Admin (managerTeam null) sees all.
  const managerTeam = me.role === "MANAGER" ? normalizeTeam(me.team) : null;
  const sp = await searchParams;
  const period = sp.period === "week" ? "week" : sp.period === "month" ? "month" : "today";
  const since = period === "week" ? startOfWeek(new Date(), { weekStartsOn: 1 }) : period === "month" ? startOfMonth(new Date()) : startOfDay(new Date());
  const periodLabel = period === "week" ? "This week" : period === "month" ? "This month" : "Today";

  const users = await prisma.user.findMany({ where: { active: true, hrOnly: false, role: { in: ["AGENT", "MANAGER", "ADMIN"] }, ...(managerTeam ? { team: managerTeam } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const userFilter = sp.user && sp.user !== "all" ? sp.user : null;

  const rows = await prisma.leadFieldHistory.findMany({
    // Manager: only changes on their own team's leads (segregation). Admin: all.
    where: { changedAt: { gte: since }, ...(userFilter ? { changedById: userFilter } : {}), ...(managerTeam ? { lead: { forwardedTeam: managerTeam } } : {}) },
    orderBy: { changedAt: "desc" },
    take: 500,
    include: { changedBy: { select: { name: true } }, lead: { select: { id: true, name: true } } },
  });

  const ownerIdVals = [...new Set(rows.filter((r) => r.field === "ownerId").flatMap((r) => [r.oldValue, r.newValue]).filter((v): v is string => !!v))];
  const ownerNameRows = ownerIdVals.length ? await prisma.user.findMany({ where: { id: { in: ownerIdVals } }, select: { id: true, name: true } }) : [];
  const ownerNames = Object.fromEntries(ownerNameRows.map((u) => [u.id, u.name]));
  const showVal = (field: string, v: string | null) => {
    if (!v) return "—";
    if (field === "ownerId") return ownerNames[v] ?? "Unassigned";
    if (field === "followupDate") { const d = new Date(v); if (!isNaN(d.getTime())) return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); }
    return v.length > 32 ? v.slice(0, 32) + "…" : v;
  };

  const byUser = new Map<string, number>();
  for (const r of rows) { const k = canonicalAgentName(r.changedBy?.name ?? "system"); byUser.set(k, (byUser.get(k) ?? 0) + 1); }
  const summary = [...byUser.entries()].sort((a, b) => b[1] - a[1]);

  const periodHref = (p: string) => { const q = new URLSearchParams(); if (userFilter) q.set("user", userFilter); if (p !== "today") q.set("period", p); const s = q.toString(); return `/reports/changes${s ? `?${s}` : ""}`; };

  return (
    <div className="space-y-4">
      <div>
        <Link href="/reports" className="text-xs text-gray-500 hover:underline">← Back to reports</Link>
        <h1 className="text-xl sm:text-2xl font-bold">📜 Change Report</h1>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">Field-level audit trail — who changed what, {periodLabel.toLowerCase()}. {rows.length} change{rows.length === 1 ? "" : "s"}{rows.length === 500 ? " (showing latest 500)" : ""}.</p>
      </div>

      <form method="GET" className="flex flex-wrap items-center gap-2 text-sm">
        <div className="seg">
          <Link href={periodHref("today")} className={period === "today" ? "on" : ""}>Today</Link>
          <Link href={periodHref("week")} className={period === "week" ? "on" : ""}>This week</Link>
          <Link href={periodHref("month")} className={period === "month" ? "on" : ""}>This month</Link>
        </div>
        <input type="hidden" name="period" value={period} />
        <select name="user" defaultValue={userFilter ?? "all"} className="border border-[#e5e7eb] dark:border-slate-600 dark:bg-slate-700 rounded-lg px-3 py-2">
          <option value="all">All users</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        <button type="submit" className="btn btn-primary">Apply</button>
      </form>

      {summary.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {summary.map(([name, n]) => (
            <span key={name} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 dark:bg-slate-700 dark:text-slate-200"><b>{name}</b> · {n}</span>
          ))}
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 dark:text-slate-400 border-b border-[#e5e7eb] dark:border-slate-600">
              <th className="px-3 py-2 font-semibold">When</th>
              <th className="px-3 py-2 font-semibold">User</th>
              <th className="px-3 py-2 font-semibold">Lead</th>
              <th className="px-3 py-2 font-semibold">Field</th>
              <th className="px-3 py-2 font-semibold">Change</th>
              <th className="px-3 py-2 font-semibold">Via</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No changes recorded {periodLabel.toLowerCase()}.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[#f1f5f9] dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/50">
                <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-slate-400 text-xs">{fmtIST12(r.changedAt)}</td>
                <td className="px-3 py-2 whitespace-nowrap font-medium dark:text-slate-200">{canonicalAgentName(r.changedBy?.name ?? "system")}</td>
                <td className="px-3 py-2"><Link href={`/leads/${r.lead.id}?back=/reports/changes`} className="text-[#0b1a33] dark:text-blue-300 hover:underline">{formatLeadName(r.lead.name)}</Link></td>
                <td className="px-3 py-2 whitespace-nowrap">{FIELD_LABEL[r.field] ?? r.field}</td>
                <td className="px-3 py-2 text-xs"><span className="text-gray-400">{showVal(r.field, r.oldValue)}</span> <span className="mx-1 text-gray-400">→</span> <span className="font-medium text-[#0b1a33] dark:text-blue-300">{showVal(r.field, r.newValue)}</span></td>
                <td className="px-3 py-2 text-[10px] text-gray-400">{r.source ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
