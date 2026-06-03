import { prisma } from "@/lib/prisma";
import { LeadStatus, Potential } from "@prisma/client";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { leadScopeWhere } from "@/lib/leadScope";
import { format as fnsFormat } from "date-fns";

export const dynamic = "force-dynamic";

const statusChip: Record<LeadStatus, string> = {
  NEW: "chip-new",
  CONTACTED: "chip-warm",
  QUALIFIED: "chip-warm",
  SITE_VISIT: "chip-warm",
  NEGOTIATION: "chip-warm",
  EOI: "chip-warm",
  BOOKING_DONE: "chip-won",
  WON: "chip-won",
  LOST: "chip-lost",
};

const statusLabel: Record<LeadStatus, string> = {
  NEW: "New",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  SITE_VISIT: "Site Visit",
  NEGOTIATION: "Negotiation",
  EOI: "EOI",
  BOOKING_DONE: "Booking Done",
  WON: "Won",
  LOST: "Lost",
};

const potentialEmoji: Record<Potential, string> = {
  HIGH: "🔥",
  MEDIUM: "🌤",
  LOW: "❄",
  UNKNOWN: "—",
};

export default async function GoingColdPage() {
  const me = await requireUser();
  const scope = await leadScopeWhere(me);
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

  const leads = await prisma.lead.findMany({
    where: {
      ...scope,
      status: { in: [LeadStatus.CONTACTED, LeadStatus.QUALIFIED, LeadStatus.SITE_VISIT, LeadStatus.NEGOTIATION] },
      OR: [
        { lastTouchedAt: { lt: threeDaysAgo } },
        { lastTouchedAt: null },
      ],
    },
    orderBy: { lastTouchedAt: "asc" },
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      potential: true,
      lastTouchedAt: true,
      followupDate: true,
      forwardedTeam: true,
      owner: { select: { name: true } },
    },
  });

  const now = new Date();

  const rows = leads.map((lead) => ({
    ...lead,
    daysCold: lead.lastTouchedAt
      ? Math.floor((now.getTime() - lead.lastTouchedAt.getTime()) / 86400000)
      : null,
  }));

  return (
    <>
      {/* ── Page header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl sm:text-2xl font-bold">🧊 Going Cold</h1>
            {rows.length > 0 && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                {rows.length}
              </span>
            )}
          </div>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400 mt-0.5">
            In-progress leads with no activity for 3+ days
          </p>
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
            All leads are active — nothing going cold!
          </p>
          <p className="text-sm text-gray-500 dark:text-slate-400">
            Every in-progress lead has been touched in the last 3 days.
          </p>
          <Link href="/leads" className="btn btn-ghost text-xs mt-2">
            Back to Leads
          </Link>
        </div>
      ) : (
        <>
          {/* ── Mobile card layout (< md) ── */}
          <div className="md:hidden space-y-3">
            {rows.map((lead) => {
              const cold = lead.daysCold;
              const coldLabel = cold === null ? "Never touched" : `${cold} day${cold === 1 ? "" : "s"} cold`;
              const coldClass =
                cold === null || cold > 7
                  ? "text-red-600 dark:text-red-400"
                  : "text-amber-600 dark:text-amber-400";

              return (
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
                      className={`chip ${statusChip[lead.status]} flex-none text-[11px] px-2 py-0.5 rounded-full font-semibold`}
                    >
                      {statusLabel[lead.status]}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    {lead.potential && (
                      <span className="text-base leading-none" title={lead.potential}>
                        {potentialEmoji[lead.potential]}
                      </span>
                    )}
                    <span className={`font-semibold ${coldClass}`}>{coldLabel}</span>
                    <span className="text-gray-400 dark:text-slate-500">
                      Follow-up:{" "}
                      {lead.followupDate
                        ? fnsFormat(lead.followupDate, "dd MMM")
                        : <span className="text-gray-400 dark:text-slate-500 italic">None set</span>}
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
              );
            })}
          </div>

          {/* ── Desktop table layout (md+) ── */}
          <div className="hidden md:block overflow-x-auto rounded-xl border border-[#e5e7eb] dark:border-slate-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-slate-800 text-xs uppercase tracking-wider text-gray-500 dark:text-slate-400">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold">Lead</th>
                  <th className="px-4 py-3 text-left font-semibold">Status</th>
                  <th className="px-4 py-3 text-left font-semibold">Potential</th>
                  <th className="px-4 py-3 text-left font-semibold">Days Cold</th>
                  <th className="px-4 py-3 text-left font-semibold">Follow-up</th>
                  <th className="px-4 py-3 text-left font-semibold">Assigned To</th>
                  <th className="px-4 py-3 text-left font-semibold">Team</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e5e7eb] dark:divide-slate-700 bg-white dark:bg-slate-900">
                {rows.map((lead) => {
                  const cold = lead.daysCold;
                  const coldLabel =
                    cold === null ? "Never touched" : `${cold}d cold`;
                  const coldClass =
                    cold === null || cold > 7
                      ? "font-semibold text-red-600 dark:text-red-400"
                      : "font-semibold text-amber-600 dark:text-amber-400";

                  return (
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
                          className={`chip ${statusChip[lead.status]} text-[11px] px-2 py-0.5 rounded-full font-semibold`}
                        >
                          {statusLabel[lead.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-base">
                        {lead.potential ? (
                          potentialEmoji[lead.potential]
                        ) : (
                          <span className="text-gray-300 dark:text-slate-600 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={coldClass}>{coldLabel}</span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 dark:text-slate-300 text-xs">
                        {lead.followupDate ? (
                          fnsFormat(lead.followupDate, "dd MMM yyyy")
                        ) : (
                          <span className="text-gray-400 dark:text-slate-500 italic">None set</span>
                        )}
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
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
