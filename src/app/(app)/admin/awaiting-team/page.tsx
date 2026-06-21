// Admin queue for leads that arrived without a team tag.
// Lalit's mandatory-team policy (2026-06): no lead auto-routes until an admin
// picks Dubai or India here. The reconciler is patched to skip null-team
// leads, and leadIngest emits a distinct "needs team assignment" notification.
//
// Role-gated to ADMIN + MANAGER (agents are redirected to /dashboard).
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { formatLeadName } from "@/lib/leadName";
import { redirect } from "next/navigation";
import Link from "next/link";
import { fmtIST12 } from "@/lib/datetime";
import { SUPPRESSED_STATUSES } from "@/lib/lead-statuses";
import AssignButtons from "./AssignButtons";

export const dynamic = "force-dynamic";

export default async function AwaitingTeamPage() {
  const me = await requireUser();
  if (me.role !== "ADMIN" && me.role !== "MANAGER") redirect("/dashboard");

  const leads = await prisma.lead.findMany({
    where: {
      deletedAt: null,
      forwardedTeam: null,
      currentStatus: { notIn: SUPPRESSED_STATUSES },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      id: true,
      name: true,
      phone: true,
      source: true,
      sourceDetail: true,
      createdAt: true,
    },
  });

  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Awaiting team assignment</h1>
        <p className="text-xs sm:text-sm text-gray-500 mt-1">
          These leads arrived without a team tag. Pick Dubai or India to start the round-robin.
        </p>
      </div>

      {leads.length === 0 ? (
        <div className="card p-8 text-center space-y-1">
          <div className="text-gray-700 font-medium">✅ Nothing waiting. Every recent lead has a team tag.</div>
          <div className="text-gray-400 text-xs">If you saw a notification about a lead needing assignment, it was already tagged — click the notification to open that lead directly.</div>
        </div>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-gray-500 border-b border-[#e5e7eb]">
              <tr>
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Phone</th>
                <th className="px-3 py-2 font-semibold">Source</th>
                <th className="px-3 py-2 font-semibold">Created</th>
                <th className="px-3 py-2 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((l) => (
                <tr key={l.id} className="border-b border-[#f1f3f7] last:border-0">
                  <td className="px-3 py-2">
                    <Link href={`/leads/${l.id}`} className="font-semibold text-[#0b1a33] hover:underline">
                      {formatLeadName(l.name)}
                    </Link>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-700">
                    {l.phone ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {l.source}
                    {l.sourceDetail && (
                      <span className="text-gray-400"> · {l.sourceDetail}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                    {fmtIST12(l.createdAt)} IST
                  </td>
                  <td className="px-3 py-2">
                    <AssignButtons leadId={l.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-[11px] text-gray-400 mt-2">
        Showing the {leads.length} most recent untagged leads (LOST leads excluded). New ones
        appear here as soon as intake records a lead without a team — the reconciler will not
        auto-route them.
      </div>
    </>
  );
}
