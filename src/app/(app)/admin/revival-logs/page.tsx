import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { fmtIST12 } from "@/lib/datetime";

export const dynamic = "force-dynamic";

// Human-readable labels for ActivityType values.
const activityLabel: Record<string, string> = {
  CALL:             "📞 Call logged",
  WHATSAPP:         "💬 WhatsApp",
  EMAIL:            "✉️ Email",
  SITE_VISIT:       "🏗 Site visit",
  OFFICE_MEETING:   "🤝 Office meeting",
  VIRTUAL_MEETING:  "🖥 Virtual meeting",
  HOME_VISIT:       "🏠 Home visit",
  EXPO_MEETING:     "🎪 Expo meeting",
  COLD_TO_LEAD:     "🚀 Promoted to Lead",
  NOTE:             "📝 Note added",
  STATUS_CHANGE:    "🔄 Status changed",
  ASSIGNMENT:       "👤 Assigned",
  LEAD_CREATED:     "✨ Lead created",
  BROCHURE_SENT:    "📄 Brochure sent",
  PROJECT_DISCUSSED:"🏢 Project discussed",
  REMINDER_FIRED:   "⏰ Reminder",
  TASK:             "✅ Task",
  MEETING:          "🤝 Meeting",
};

export default async function RevivalLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireUser();
  if (me.role !== "ADMIN" && me.role !== "MANAGER") redirect("/cold-calls");

  const sp = await searchParams;
  const agentFilter = sp.agent ?? "all";

  // All agents who have ever touched a cold-data lead — for the filter dropdown
  const agents = await prisma.user.findMany({
    where: {
      role: { in: ["AGENT", "MANAGER", "ADMIN"] },
      active: true,
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // Activities on cold-data leads (leadOrigin = "COLD")
  const activities = await prisma.activity.findMany({
    where: {
      lead: { leadOrigin: "COLD" },
      ...(agentFilter !== "all" ? { userId: agentFilter } : {}),
    },
    include: {
      lead: { select: { id: true, name: true, phone: true, status: true } },
      user: { select: { name: true } },
    },
    orderBy: { completedAt: "desc" },
    take: 300,
  });

  // Summary counters
  const promotedTotal = activities.filter(a => a.type === "COLD_TO_LEAD").length;
  const callTotal = activities.filter(a => a.type === "CALL").length;
  const noteTotal = activities.filter(a => a.type === "NOTE").length;

  return (
    <div className="space-y-5 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">📋 Revival Engine — Activity Logs</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            All actions logged by agents on cold-data leads · most recent first
          </p>
        </div>
        <Link href="/cold-calls" className="btn btn-ghost text-sm">← Back to Revival Engine</Link>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-emerald-600">{promotedTotal}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Promotions (shown)</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{callTotal}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Calls logged</div>
        </div>
        <div className="card p-4 text-center">
          <div className="text-2xl font-bold text-amber-600">{noteTotal}</div>
          <div className="text-[11px] text-gray-500 mt-0.5">Notes added</div>
        </div>
      </div>

      {/* Agent filter */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold text-gray-600">Filter by agent:</span>
        <Link
          href="/admin/revival-logs"
          className={`chip text-[10px] ${agentFilter === "all" ? "chip-won" : "bg-gray-100 text-gray-600"}`}
        >
          All agents
        </Link>
        {agents.map(a => (
          <Link
            key={a.id}
            href={`/admin/revival-logs?agent=${a.id}`}
            className={`chip text-[10px] ${agentFilter === a.id ? "chip-won" : "bg-gray-100 text-gray-600"}`}
          >
            {a.name}
          </Link>
        ))}
      </div>

      {/* Activity table */}
      {activities.length === 0 ? (
        <div className="card p-8 text-center text-gray-500 text-sm">
          No activity logged on cold-data leads yet.
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[#e5e7eb] dark:border-slate-700 text-left text-xs font-semibold text-gray-500 bg-gray-50/80 dark:bg-slate-800/50">
                <th className="px-3 py-2.5 w-40">Date / Time</th>
                <th className="px-3 py-2.5 w-36">Agent</th>
                <th className="px-3 py-2.5 w-44">Action</th>
                <th className="px-3 py-2.5">Lead</th>
                <th className="px-3 py-2.5">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#f1f3f5] dark:divide-slate-800">
              {activities.map(a => (
                <tr key={a.id} className="hover:bg-gray-50/60 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="px-3 py-2.5 text-[11px] text-gray-500 whitespace-nowrap align-top">
                    {a.completedAt ? fmtIST12(a.completedAt) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-xs align-top">
                    {a.user?.name ?? <span className="text-gray-400 italic">System</span>}
                  </td>
                  <td className="px-3 py-2.5 text-xs align-top">
                    <span className={`${a.type === "COLD_TO_LEAD" ? "font-bold text-emerald-700" : ""}`}>
                      {activityLabel[a.type] ?? a.type}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    {a.lead ? (
                      <div>
                        <Link
                          href={`/leads/${a.lead.id}`}
                          className="font-semibold text-[#0b1a33] dark:text-white hover:underline text-xs"
                        >
                          {a.lead.name}
                        </Link>
                        {a.lead.phone && (
                          <div className="text-[10px] text-gray-400 font-mono">
                            ···{a.lead.phone.slice(-4)}
                          </div>
                        )}
                        <span className="chip chip-new text-[9px] mt-0.5">
                          {a.lead.status.replaceAll("_", " ")}
                        </span>
                      </div>
                    ) : (
                      <span className="text-gray-400 italic text-[11px]">Lead deleted</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[11px] text-gray-600 dark:text-slate-300 align-top max-w-[240px]">
                    {a.title && a.title !== a.type && (
                      <div className="truncate">{a.title}</div>
                    )}
                    {a.description && (
                      <div className="text-gray-500 truncate mt-0.5">{a.description}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-[11px] text-gray-400 text-center">
        Showing up to 300 most recent entries. Use agent filter to narrow down.
      </p>
    </div>
  );
}
