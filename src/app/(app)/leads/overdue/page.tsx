import { prisma } from "@/lib/prisma";
import { Potential } from "@prisma/client";
import { SUPPRESSED_STATUSES, statusColor } from "@/lib/lead-statuses";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { leadScopeWhere } from "@/lib/leadScope";

export const dynamic = "force-dynamic";

// Status colors and labels use statusColor() from lead-statuses.ts — no stage mapping.

const potentialEmoji: Record<Potential, string> = {
  HIGH: "🔥",
  MEDIUM: "🌤",
  LOW: "❄",
  UNKNOWN: "—",
};

export default async function OverduePage() {
  const me = await requireUser();
  const scope = await leadScopeWhere(me);
  const now = new Date();

  const leads = await prisma.lead.findMany({
    where: {
      ...scope,
      followupDate: { lt: now },
      currentStatus: { notIn: SUPPRESSED_STATUSES },
    },
    orderBy: { followupDate: "asc" },
    select: {
      id: true,
      name: true,
      phone: true,
      currentStatus: true,
      potential: true,
      followupDate: true,
      forwardedTeam: true,
      owner: { select: { name: true } },
    },
  });

  const rows = leads.map((lead) => ({
    ...lead,
    daysOverdue: lead.followupDate
      ? Math.floor((now.getTime() - lead.followupDate.getTime()) / 86400000)
      : 0,
  }));

  return (
    <>
      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-bold">⚠️ Overdue Follow-ups</h1>
          {rows.length > 0 && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
              {rows.length}
            </span>
          )}
        </div>
        <Link href="/leads" className="btn btn-ghost text-xs">
          ← Back to Leads
        </Link>
      </div>

      {/* ── Empty state ── */}
      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <span className="text-5xl">✅</span>
          <p className="text-lg font-semibold text-gray-700 dark:text-slate-200">
            No overdue follow-ups — great work!
          </p>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            All follow-up dates are either in the future or have been cleared.
          </p>
          <Link href="/leads" className="btn btn-ghost text-xs mt-2">
            Back to Leads
          </Link>
        </div>
      ) : (
        <>
          {/* ── Mobile card layout (< md) ── */}
          <div className="md:hidden space-y-3">
            {rows.map((lead) => (
              <div
                key={lead.id}
                className="bg-white dark:bg-slate-800 rounded-xl border border-[#e5e7eb] dark:border-slate-700 p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="font-semibold text-[#0b1a33] dark:text-slate-100 hover:underline truncate block"
                    >
                      {lead.name}
                    </Link>
                    {lead.phone && (
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
                        {lead.phone}
                      </p>
                    )}
                  </div>
                  <span
                    className={`chip ${statusColor(lead.currentStatus)} flex-none text-[11px] px-2 py-0.5 rounded-full font-semibold`}
                  >
                    {lead.currentStatus ?? "—"}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {lead.potential && (
                    <span className="text-base leading-none" title={lead.potential}>
                      {potentialEmoji[lead.potential]}
                    </span>
                  )}
                  <span className="font-semibold text-red-600 dark:text-red-400">
                    {lead.daysOverdue === 0
                      ? "Due today"
                      : `${lead.daysOverdue} day${lead.daysOverdue === 1 ? "" : "s"} overdue`}
                  </span>
                  {lead.owner && (
                    <span className="text-gray-500 dark:text-slate-400 ml-auto">
                      {lead.owner.name}
                    </span>
                  )}
                  {lead.forwardedTeam && (
                    <span className="text-gray-400 dark:text-slate-500">
                      · {lead.forwardedTeam}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── Desktop table layout (md+) ── */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-[#e5e7eb] dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800 text-xs uppercase tracking-wider text-gray-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Lead</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Potential</th>
                  <th className="px-4 py-3 text-left font-semibold">Overdue</th>
                  <th className="px-4 py-3 text-left font-semibold">Assigned To</th>
                  <th className="px-4 py-3 text-left font-semibold">Team</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e7eb] dark:divide-slate-700 bg-white dark:bg-slate-900">
                {rows.map((lead) => (
                  <tr
                    key={lead.id}
                    className="hover:bg-gray-50 dark:hover:bg-slate-800/60 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="font-medium text-[#0b1a33] dark:text-slate-100 hover:underline"
                      >
                        {lead.name}
                      </Link>
                      {lead.phone && (
                        <p className="text-xs text-gray-400 dark:text-slate-500 mt-0.5">
                          {lead.phone}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`chip ${statusColor(lead.currentStatus)} text-[11px] px-2 py-0.5 rounded-full font-semibold`}
                      >
                        {lead.currentStatus ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-base">
                      {lead.potential ? potentialEmoji[lead.potential] : (
                        <span className="text-gray-300 dark:text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-semibold text-red-600 dark:text-red-400">
                        {lead.daysOverdue === 0
                          ? "Due today"
                          : `${lead.daysOverdue}d overdue`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                      {lead.owner?.name ?? (
                        <span className="text-gray-400 dark:text-slate-500 text-xs italic">
                          Unassigned
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-slate-400 text-xs">
                      {lead.forwardedTeam ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
