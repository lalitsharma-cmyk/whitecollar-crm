import { prisma } from "@/lib/prisma";
import { Potential } from "@prisma/client";
import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import { requireUser } from "@/lib/auth";
import { leadScopeWhere } from "@/lib/leadScope";
import ReactivateButton from "@/components/ReactivateButton";

export const dynamic = "force-dynamic";

const potentialEmoji: Record<Potential, string> = {
  HIGH: "🔥",
  MEDIUM: "🌤",
  LOW: "❄",
  UNKNOWN: "—",
};

export default async function ArchivedLeadsPage() {
  const me = await requireUser();
  const scope = await leadScopeWhere(me);

  const leads = await prisma.lead.findMany({
    where: { ...scope, rejectedAt: { not: null } },
    orderBy: { updatedAt: "desc" },
    take: 200,
    select: {
      id: true,
      name: true,
      phone: true,
      potential: true,
      updatedAt: true,
      createdAt: true,
      forwardedTeam: true,
      originalSheetStatus: true,
      source: true,
      owner: { select: { name: true } },
    },
  });

  const canReactivate = me.role === "ADMIN" || me.role === "MANAGER";

  return (
    <>
      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl sm:text-2xl font-bold">🗄️ Archived Leads</h1>
          {leads.length > 0 && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300">
              {leads.length}
            </span>
          )}
        </div>
        <Link href="/leads" className="btn btn-ghost text-xs">
          ← Back to Leads
        </Link>
      </div>

      {/* ── Empty state ── */}
      {leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
          <span className="text-5xl">🗄️</span>
          <p className="text-lg font-semibold text-gray-700 dark:text-slate-200">
            No archived leads
          </p>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Leads marked as Lost will appear here.
          </p>
          <Link href="/leads" className="btn btn-ghost text-xs mt-2">
            Back to Leads
          </Link>
        </div>
      ) : (
        <>
          {/* ── Mobile card layout (< md) ── */}
          <div className="md:hidden space-y-3">
            {leads.map((lead) => (
              <div
                key={lead.id}
                className="bg-white dark:bg-slate-800 rounded-xl border border-[#e5e7eb] dark:border-slate-700 p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link
                      href={`/leads/${lead.id}?back=/leads/archived`}
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
                  {lead.potential && (
                    <span
                      className="text-lg leading-none flex-none"
                      title={lead.potential}
                    >
                      {potentialEmoji[lead.potential]}
                    </span>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                  {lead.forwardedTeam && (
                    <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 font-semibold text-[11px]">
                      {lead.forwardedTeam}
                    </span>
                  )}
                  <span className="text-gray-500 dark:text-slate-400">
                    {formatDistanceToNow(lead.updatedAt, { addSuffix: true })}
                  </span>
                  {lead.originalSheetStatus && (
                    <span className="text-gray-400 dark:text-slate-500 italic text-[11px]">
                      {lead.originalSheetStatus}
                    </span>
                  )}
                  {lead.owner && (
                    <span className="text-gray-500 dark:text-slate-400 ml-auto">
                      {lead.owner.name}
                    </span>
                  )}
                </div>

                {canReactivate && (
                  <div className="mt-3">
                    <ReactivateButton leadId={lead.id} />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* ── Desktop table layout (md+) ── */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-[#e5e7eb] dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800 text-xs uppercase tracking-wider text-gray-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Lead</th>
                  <th className="px-4 py-3 text-left font-semibold">Potential</th>
                  <th className="px-4 py-3 text-left font-semibold">Team</th>
                  <th className="px-4 py-3 text-left font-semibold">Last Updated</th>
                  <th className="px-4 py-3 text-left font-semibold">Sheet Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Assigned To</th>
                  {canReactivate && (
                    <th className="px-4 py-3 text-left font-semibold">Action</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e7eb] dark:divide-slate-700 bg-white dark:bg-slate-900">
                {leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className="hover:bg-gray-50 dark:hover:bg-slate-800/60 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/leads/${lead.id}?back=/leads/archived`}
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
                    <td className="px-4 py-3 text-base">
                      {lead.potential ? (
                        <span title={lead.potential}>
                          {potentialEmoji[lead.potential]}
                        </span>
                      ) : (
                        <span className="text-gray-300 dark:text-slate-600 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {lead.forwardedTeam ? (
                        <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300 font-semibold text-[11px]">
                          {lead.forwardedTeam}
                        </span>
                      ) : (
                        <span className="text-gray-400 dark:text-slate-500 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-slate-400 text-xs">
                      {formatDistanceToNow(lead.updatedAt, { addSuffix: true })}
                    </td>
                    <td className="px-4 py-3 text-gray-500 dark:text-slate-400 text-xs italic">
                      {lead.originalSheetStatus ?? (
                        <span className="not-italic text-gray-300 dark:text-slate-600">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-slate-300">
                      {lead.owner?.name ?? (
                        <span className="text-gray-400 dark:text-slate-500 text-xs italic">
                          Unassigned
                        </span>
                      )}
                    </td>
                    {canReactivate && (
                      <td className="px-4 py-3">
                        <ReactivateButton leadId={lead.id} />
                      </td>
                    )}
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
