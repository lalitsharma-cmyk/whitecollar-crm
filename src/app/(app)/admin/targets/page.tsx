import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { TargetMetric } from "@prisma/client";
import TargetsEditor from "@/components/TargetsEditor";

export const dynamic = "force-dynamic";

// Tracks the metrics shown on the daily report. Order matches the agent's
// manual sheet so this page reads top-to-bottom the same way.
const METRICS: { key: TargetMetric; label: string; helper: string }[] = [
  { key: TargetMetric.CALLS,            label: "Total calls / day",         helper: "dial attempts (connected + missed)" },
  { key: TargetMetric.CONNECTED_CALLS,  label: "Connecting calls / day",    helper: "outcome = CONNECTED" },
  { key: TargetMetric.VIRTUAL_MEETINGS, label: "Virtual meetings / day",    helper: "completed video calls" },
  { key: TargetMetric.F2F_MEETINGS,     label: "F2F meetings / day",        helper: "office + site + home, completed" },
  { key: TargetMetric.FRESH_CLIENTS,    label: "Fresh clients / day",       helper: "cold-data rows promoted to active lead" },
  { key: TargetMetric.DEALS_CLOSED,     label: "Deals closed / day",        helper: "leads marked WON" },
  { key: TargetMetric.REVENUE_AED,      label: "Sales value AED / day",     helper: "Dubai team — sum of WON budgets" },
  { key: TargetMetric.REVENUE_INR,      label: "Sales value INR / day",     helper: "India team — sum of WON budgets" },
];

export default async function AdminTargetsPage() {
  await requireRole("ADMIN");
  const [users, allTargets] = await Promise.all([
    prisma.user.findMany({ where: { active: true, hrOnly: false, role: { in: ["AGENT", "MANAGER"] } }, orderBy: [{ team: "asc" }, { name: "asc" }] }),
    prisma.target.findMany({ where: { period: "DAILY" }, orderBy: { startDate: "desc" } }),
  ]);

  // Build a lookup: userId → metric → latest value
  const map = new Map<string, Map<TargetMetric, number>>();
  for (const t of allTargets) {
    if (!t.userId) continue;
    if (!map.has(t.userId)) map.set(t.userId, new Map());
    const inner = map.get(t.userId)!;
    if (!inner.has(t.metric)) inner.set(t.metric, t.value);
  }

  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">🎯 Daily Targets</h1>
        <p className="text-xs sm:text-sm text-gray-500">
          Per-agent daily targets used by the Daily Report (Achieved vs Target vs Pending).
          Values apply from the next page load — they don't change historical reports.
        </p>
      </div>

      <div className="card overflow-x-auto">
        <table className="tbl min-w-[820px]">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white z-10">Agent</th>
              {METRICS.map((m) => (
                <th key={m.key} className="text-center text-[10px]" title={m.helper}>{m.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u) => {
              const userTargets = map.get(u.id) ?? new Map();
              return (
                <tr key={u.id}>
                  <td className="sticky left-0 bg-white z-10">
                    <div className="font-semibold">{u.name}</div>
                    <div className="text-[10px] text-gray-500">{u.team ?? "—"} · {u.role}</div>
                  </td>
                  {METRICS.map((m) => (
                    <td key={m.key} className="text-center">
                      <TargetsEditor userId={u.id} metric={m.key} initial={userTargets.get(m.key) ?? 0} />
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card p-4 text-xs text-gray-600">
        <b>💡 Tip:</b> Use 0 for "not tracked" — that metric won't show a % on the daily report.
        Set <b>REVENUE_AED</b> for Dubai agents and <b>REVENUE_INR</b> for India agents only.
      </div>
    </>
  );
}
