import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { format } from "date-fns";

export const dynamic = "force-dynamic";

// ─── Status chip colours (matches the rest of the CRM) ─────────────────────
const statusChip: Record<string, string> = {
  NEW:          "bg-blue-100   text-blue-800   dark:bg-blue-900/40   dark:text-blue-300",
  CONTACTED:    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
  QUALIFIED:    "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
  PROPOSAL:     "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
  NEGOTIATION:  "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300",
  CLOSED_WON:   "bg-green-100  text-green-800  dark:bg-green-900/40  dark:text-green-300",
  CLOSED_LOST:  "bg-red-100    text-red-800    dark:bg-red-900/40    dark:text-red-300",
  BOOKED:       "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  SITE_VISIT:   "bg-teal-100   text-teal-800   dark:bg-teal-900/40   dark:text-teal-300",
};

export default async function DedupPage() {
  await requireRole("ADMIN");

  // Step 1: get all leads with phones
  const allLeads = await prisma.lead.findMany({
    select: {
      id: true,
      name: true,
      phone: true,
      status: true,
      createdAt: true,
      owner: { select: { name: true } },
    },
    where: { phone: { not: null } },
    orderBy: { createdAt: "desc" },
  });

  // Step 2: group by normalized phone (digits only) in JS
  const phoneMap = new Map<string, typeof allLeads>();
  for (const lead of allLeads) {
    if (!lead.phone) continue;
    const normalized = lead.phone.replace(/\D/g, "");
    if (!normalized || normalized.length < 7) continue;
    if (!phoneMap.has(normalized)) phoneMap.set(normalized, []);
    phoneMap.get(normalized)!.push(lead);
  }

  // Step 3: filter to groups with >1 lead, most dupes first
  const dupeGroups = Array.from(phoneMap.entries())
    .filter(([, group]) => group.length > 1)
    .sort(([, a], [, b]) => b.length - a.length);

  const totalDupes = dupeGroups.reduce((sum, [, g]) => sum + g.length, 0);

  return (
    <div className="space-y-5 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href="/admin/audit"
          className="text-sm text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200"
        >
          ← Back
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold">🔍 Duplicate Leads</h1>
          {dupeGroups.length > 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
              {dupeGroups.length} phone number{dupeGroups.length !== 1 ? "s" : ""} have duplicate leads ({totalDupes} total duplicates)
            </p>
          ) : (
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-0.5">
              Scan of all leads with phone numbers
            </p>
          )}
        </div>
      </div>

      {/* Empty state */}
      {dupeGroups.length === 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-10 text-center text-sm text-gray-500 dark:text-slate-400">
          ✅ No duplicate phone numbers found
        </div>
      )}

      {/* Groups */}
      <div className="space-y-6">
        {dupeGroups.map(([normalized, leads]) => {
          // Mask: first 6 digits + ****
          const masked =
            normalized.length >= 6
              ? normalized.slice(0, 6) + "****"
              : normalized + "****";

          return (
            <div
              key={normalized}
              className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden"
            >
              {/* Group header */}
              <div className="flex items-center gap-3 px-4 py-3 bg-gray-50 dark:bg-slate-800/50 border-b border-gray-200 dark:border-slate-700">
                <span className="font-mono text-sm font-semibold text-gray-800 dark:text-slate-200">
                  📞 {masked}
                </span>
                <span className="text-xs text-gray-500 dark:text-slate-400">
                  {leads.length} leads
                </span>
              </div>

              {/* Leads table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 dark:text-slate-400 border-b border-gray-100 dark:border-slate-700/60">
                      <th className="px-4 py-2.5 font-medium">Name</th>
                      <th className="px-4 py-2.5 font-medium">Status</th>
                      <th className="px-4 py-2.5 font-medium">Created</th>
                      <th className="px-4 py-2.5 font-medium">Assigned To</th>
                      <th className="px-4 py-2.5 font-medium">Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead, idx) => {
                      const statusKey = String(lead.status);
                      const chipClass =
                        statusChip[statusKey] ??
                        "bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300";
                      const isNewer = idx > 0;

                      return (
                        <tr
                          key={lead.id}
                          className="border-b border-gray-100 dark:border-slate-700/60 last:border-0 hover:bg-gray-50 dark:hover:bg-slate-800/40"
                        >
                          {/* Name — link to lead detail */}
                          <td className="px-4 py-3">
                            <Link
                              href={`/leads/${lead.id}`}
                              className="font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                            >
                              {lead.name}
                            </Link>
                          </td>

                          {/* Status chip */}
                          <td className="px-4 py-3">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${chipClass}`}
                            >
                              {statusKey.replace(/_/g, " ")}
                            </span>
                          </td>

                          {/* Created date */}
                          <td className="px-4 py-3 text-gray-500 dark:text-slate-400 whitespace-nowrap text-xs">
                            {format(lead.createdAt, "dd MMM yyyy")}
                          </td>

                          {/* Assigned agent */}
                          <td className="px-4 py-3 text-gray-600 dark:text-slate-300 text-xs whitespace-nowrap">
                            {lead.owner?.name ?? (
                              <span className="text-gray-400 dark:text-slate-500">Unassigned</span>
                            )}
                          </td>

                          {/* "Newer" badge for potential duplicates */}
                          <td className="px-4 py-3">
                            {isNewer && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
                                Newer
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
