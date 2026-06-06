import { prisma } from "@/lib/prisma";
import { Potential } from "@prisma/client";
import { ACTIVE_PURSUIT_STATUSES, statusColor } from "@/lib/lead-statuses";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { leadScopeWhere } from "@/lib/leadScope";
import InboxClient, { type InboxRow } from "@/components/InboxClient";

export const dynamic = "force-dynamic";

// Status colors and labels now use statusColor() from lead-statuses.ts — no stage mapping.

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
  const canDelete = me.role === "ADMIN" || me.role === "MANAGER";

  const leads = await prisma.lead.findMany({
    where: {
      ...scope,
      currentStatus: { in: ACTIVE_PURSUIT_STATUSES },
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
      email: true,
      status: true,
      currentStatus: true,
      potential: true,
      lastTouchedAt: true,
      followupDate: true,
      forwardedTeam: true,
      owner: { select: { name: true } },
    },
  });

  const now = new Date();

  const rows: InboxRow[] = leads.map((lead) => ({
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    status: lead.status,
    // Show currentStatus (Excel/MIS) as the primary label; fall back to internal stage label
    statusChip: statusColor(lead.currentStatus),
    statusLabel: lead.currentStatus ?? "—",
    potential: lead.potential,
    potentialEmoji: lead.potential ? potentialEmoji[lead.potential] : "—",
    daysCold: lead.lastTouchedAt
      ? Math.floor((now.getTime() - lead.lastTouchedAt.getTime()) / 86400000)
      : null,
    followupDate: lead.followupDate,
    ownerName: lead.owner?.name ?? null,
    forwardedTeam: lead.forwardedTeam,
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
        <InboxClient rows={rows} canDelete={canDelete} />
      )}
    </>
  );
}
