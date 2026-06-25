import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { leadScopeWhere } from "@/lib/leadScope";
import { TERMINAL_STATUSES, statusColor, leadCategory } from "@/lib/lead-statuses";
import { formatLeadName } from "@/lib/leadName";
import { lastMeaningfulRemark } from "@/lib/needSnapshot";
import { formatDistanceToNow, format as fnsFormat } from "date-fns";
import Link from "next/link";

export const dynamic = "force-dynamic";

// ─────────────────────────────────────────────────────────────────────────────
// REVISIT QUEUE (Release 1 — view + separation, NOT a convert button)
//
// A lead in a TERMINAL status (booked/sold/leased OR lost/rejected) that STILL
// carries a follow-up date is a "Revisit": the agent rejected/closed it but left a
// future touchpoint to revisit. Under the Jun26 rules these leads NO LONGER appear
// on the Active Follow-up Board (Action List) — they would pollute the working
// board. This page is where they surface instead: a read-only, permission-scoped
// triage list.
//
// HOW A LEAD RETURNS TO ACTIVE (this release): an admin changes its status off the
// terminal value via the EXISTING inline status editor on the lead detail page
// (already logged in the Smart Timeline / Change History). There is intentionally
// NO new "Convert to Active" button and NO new timeline event type in this release
// — that is a confirmed fast-follow.
//
// SCOPE: reuses leadScopeWhere(me) so agents see only their own revisits, managers
// their team's, admins all — identical to every other lead list. deletedAt:null is
// baked into leadScopeWhere, so recycled leads never appear.
// ─────────────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 100;

export default async function RevisitQueuePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireUser();
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const skip = (page - 1) * PAGE_SIZE;

  // Permission scope — the ONLY filter. leadScopeWhere encodes ADMIN→all,
  // MANAGER→own team, AGENT→own leads, and always applies deletedAt:null.
  const scope = await leadScopeWhere(me);

  // The Revisit set: terminal/rejected status AND a follow-up still scheduled.
  // followupDate:{ not: null } makes this exactly the complement of the Active
  // Board's terminal-exclusion — every rejected-with-followup lead lands here.
  const where = {
    ...scope,
    currentStatus: { in: TERMINAL_STATUSES },
    followupDate: { not: null as null },
  };

  const [rows, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      // Soonest follow-up first — the next revisit due rises to the top.
      orderBy: { followupDate: "asc" },
      skip,
      take: PAGE_SIZE,
      select: {
        id: true,
        name: true,
        phone: true,
        currentStatus: true,
        forwardedTeam: true,
        followupDate: true,
        lastTouchedAt: true,
        remarks: true,
        owner: { select: { name: true } },
      },
    }),
    prisma.lead.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
          🕗 Revisit Queue
        </h1>
        <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400 mt-1 max-w-3xl">
          Rejected / closed leads that still carry a follow-up date — a{" "}
          <b>Revisit</b>. These are kept OFF the Active Follow-up Board (Action List)
          so they don&apos;t crowd today&apos;s work. To return one to active, open the
          lead and change its status off the terminal value (an admin action) — it
          rejoins the board automatically.
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span className="chip src">{total} revisit{total === 1 ? "" : "s"}</span>
        <span className="text-xs text-gray-400 dark:text-slate-500">
          {me.role === "AGENT"
            ? "Your leads only"
            : me.role === "MANAGER"
              ? "Your team"
              : "All teams"}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="card p-6 text-sm text-gray-500 dark:text-slate-400 italic">
          No revisits — no rejected or closed lead currently carries a follow-up date.
        </div>
      ) : (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                <th className="px-3 py-2 font-semibold">Name</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Follow-up</th>
                <th className="px-3 py-2 font-semibold">Owner</th>
                <th className="px-3 py-2 font-semibold">Team</th>
                <th className="px-3 py-2 font-semibold">Last activity</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => {
                const remark = lastMeaningfulRemark(l.remarks);
                const cat = leadCategory(l.currentStatus); // CLOSED | LOST
                return (
                  <tr
                    key={l.id}
                    className="border-b border-gray-100 dark:border-slate-800 hover:bg-gray-50 dark:hover:bg-slate-800/50 align-top"
                  >
                    <td className="px-3 py-2">
                      <Link href={`/leads/${l.id}`} className="font-bold text-[#0b1a33] dark:text-blue-300 hover:underline">
                        {formatLeadName(l.name)}
                      </Link>
                      {l.phone && <div className="text-xs text-gray-500 dark:text-slate-400">{l.phone}</div>}
                      {remark && (
                        <div className="text-xs text-gray-500 dark:text-slate-400 line-clamp-1 max-w-[280px] mt-0.5">{remark}</div>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`chip ${statusColor(l.currentStatus)}`}>{l.currentStatus ?? "—"}</span>
                      <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-0.5">{cat === "CLOSED" ? "Closed" : "Rejected"}</div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {l.followupDate
                        ? fnsFormat(l.followupDate, "dd MMM yyyy")
                        : "—"}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{l.owner?.name ?? <span className="text-gray-400">Unassigned</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {l.forwardedTeam
                        ? <span className={`chip ${l.forwardedTeam === "India" ? "src-csv" : "src-wa"}`}>{l.forwardedTeam}</span>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap text-xs text-gray-500 dark:text-slate-400">
                      {l.lastTouchedAt ? formatDistanceToNow(l.lastTouchedAt, { addSuffix: true }) : "never"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          {page > 1 && (
            <Link href={`/revisit-queue?page=${page - 1}`} className="btn btn-ghost">← Prev</Link>
          )}
          <span className="text-gray-500 dark:text-slate-400">Page {page} of {totalPages}</span>
          {page < totalPages && (
            <Link href={`/revisit-queue?page=${page + 1}`} className="btn btn-ghost">Next →</Link>
          )}
        </div>
      )}
    </div>
  );
}
