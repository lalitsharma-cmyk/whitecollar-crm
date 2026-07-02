import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { fmtIST12 } from "@/lib/datetime";
import { REJECT_REASONS, REJECT_REASON_VALUES, rejectReasonLabel } from "@/lib/reject-reasons";
import { formatLeadName } from "@/lib/leadName";

/**
 * /admin/rejected-leads — oversight view for leads agents have rejected.
 *
 * Agents don't see LOST leads in their default /leads view (handled in
 * leads/page.tsx). This page is the matching admin/manager dashboard so
 * leakage is visible: how many we lost, why, who rejected them.
 *
 * Access: ADMIN + MANAGER only (agents redirected to /dashboard).
 *
 * Filters: ?reason=<enum> narrows to a single rejection reason; the
 * dropdown at the top wires through plain GET params (no client component).
 *
 * Note on the `rejectedBy` link: schema has rejectedById (String) but no
 * Prisma relation, so we resolve the names with a single follow-up
 * user.findMany keyed by the distinct ids we just pulled.
 */
export const dynamic = "force-dynamic";

// Reason filter options + labels come from the SINGLE canonical list
// (reject-reasons.ts) so this oversight view always matches the reject modal —
// it now includes "Purchased Elsewhere" / "Booked Through Another Channel" and
// never the removed "Booked With Us". rejectReasonLabel() also resolves any
// legacy value still in the DB.
const REASONS: string[] = REJECT_REASONS.map((r) => r.value);
type Reason = string;

function truncate(s: string | null, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

export default async function RejectedLeadsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireUser();
  // ADMIN + MANAGER only — agents bounce to dashboard.
  if (me.role !== "ADMIN" && me.role !== "MANAGER") {
    redirect("/dashboard");
  }

  const sp = await searchParams;
  const reasonFilter: Reason | null =
    sp.reason && REJECT_REASON_VALUES.has(sp.reason) ? sp.reason : null;

  // Base predicate — only rows that went through the structured reject flow.
  // rejectedAt is set by the reject API route — no status dependency needed.
  const baseWhere = {
    rejectedAt: { not: null },
    rejectionReason: { not: null },
  };

  const where = reasonFilter ? { ...baseWhere, rejectionReason: reasonFilter } : baseWhere;

  // Pull the rejected-lead list + the breakdown counts in parallel. The
  // breakdown ignores the reason filter (it'd just zero out the others).
  const [leads, breakdown] = await Promise.all([
    prisma.lead.findMany({
      where,
      orderBy: { rejectedAt: "desc" },
      include: { owner: true },
      take: 200,
    }),
    prisma.lead.groupBy({
      by: ["rejectionReason"],
      where: baseWhere,
      _count: { _all: true },
    }),
  ]);

  // Resolve rejecter names — schema has no rejectedBy relation, so do a
  // single batched lookup keyed by the distinct ids we just pulled.
  const rejecterIds = Array.from(
    new Set(leads.map((l) => l.rejectedById).filter((v): v is string => !!v)),
  );
  const rejecters = rejecterIds.length
    ? await prisma.user.findMany({
        where: { id: { in: rejecterIds } },
        select: { id: true, name: true },
      })
    : [];
  const rejecterById = new Map(rejecters.map((u) => [u.id, u.name]));

  // Normalize the breakdown into a stable order keyed off REASONS, so the
  // summary tiles render the same way every visit even if counts shift.
  const countByReason = new Map<string, number>();
  for (const row of breakdown) {
    if (row.rejectionReason) countByReason.set(row.rejectionReason, row._count._all);
  }
  const totalRejected = Array.from(countByReason.values()).reduce((a, b) => a + b, 0);

  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">❌ Rejected leads</h1>
        <p className="text-xs sm:text-sm text-gray-500">
          Agents&apos; rejections — visible only to admin + managers. Shows the most recent 200.
        </p>
      </div>

      {/* Reason breakdown — clickable tiles double as the reason filter so
          managers can pivot from "what's the breakdown" to "show me the
          fund-issue rejections" in one tap. */}
      <div className="card p-3">
        <div className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">
          Reason breakdown ({totalRejected} total)
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/rejected-leads"
            className={`chip ${!reasonFilter ? "chip-warm" : "chip-lost"}`}
          >
            All · {totalRejected}
          </Link>
          {REASONS.map((r) => {
            const n = countByReason.get(r) ?? 0;
            const active = reasonFilter === r;
            return (
              <Link
                key={r}
                href={`/admin/rejected-leads?reason=${r}`}
                className={`chip ${active ? "chip-warm" : "chip-lost"}`}
              >
                {rejectReasonLabel(r)} · {n}
              </Link>
            );
          })}
        </div>
      </div>

      {/* Reason filter dropdown — same effect as the chips above, but a
          dropdown is easier on mobile where the chip row would wrap. */}
      <form method="GET" action="/admin/rejected-leads" className="flex items-center gap-2">
        <label htmlFor="reason-filter" className="text-xs font-semibold text-gray-600">
          Filter by reason:
        </label>
        <select
          id="reason-filter"
          name="reason"
          defaultValue={reasonFilter ?? ""}
          className="border border-[#e5e7eb] rounded-lg px-3 py-2 text-sm bg-white"
        >
          <option value="">All reasons</option>
          {REASONS.map((r) => (
            <option key={r} value={r}>{rejectReasonLabel(r)}</option>
          ))}
        </select>
        <button type="submit" className="btn btn-ghost">Apply</button>
        {reasonFilter && (
          <Link href="/admin/rejected-leads" className="text-xs text-gray-500 hover:text-gray-800">
            Clear
          </Link>
        )}
      </form>

      {/* Results table — wide on desktop, falls back to a card list on mobile. */}
      {leads.length === 0 ? (
        <div className="card p-5 text-center text-gray-500 text-sm">
          No rejected leads {reasonFilter ? `for reason "${rejectReasonLabel(reasonFilter)}"` : "yet"}.
        </div>
      ) : (
        <>
          {/* DESKTOP table */}
          <div className="hidden lg:block card p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-widest text-gray-500 border-b">
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Phone</th>
                  <th className="px-3 py-2">Original owner</th>
                  <th className="px-3 py-2">Rejected by</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Reason</th>
                  <th className="px-3 py-2">Note</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id} className="border-b last:border-b-0 hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <Link href={`/leads/${l.id}`} className="text-blue-700 hover:underline font-medium">
                        {formatLeadName(l.name)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-gray-700 font-mono text-xs">{l.phone ?? "—"}</td>
                    <td className="px-3 py-2 text-gray-700">{l.owner?.name ?? "(unassigned)"}</td>
                    <td className="px-3 py-2 text-gray-700">
                      {l.rejectedById ? (rejecterById.get(l.rejectedById) ?? "(unknown)") : "—"}
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-xs whitespace-nowrap">
                      {l.rejectedAt ? fmtIST12(l.rejectedAt) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className="chip chip-lost">
                        {l.rejectionReason ? rejectReasonLabel(l.rejectionReason) : "—"}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-gray-600 text-xs max-w-xs" title={l.rejectionNote ?? ""}>
                      {truncate(l.rejectionNote, 80)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* MOBILE card list */}
          <div className="lg:hidden space-y-2">
            {leads.map((l) => (
              <div key={l.id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/leads/${l.id}`} className="text-blue-700 hover:underline font-medium text-sm">
                    {formatLeadName(l.name)}
                  </Link>
                  <span className="chip chip-lost text-[10px]">
                    {l.rejectionReason ? rejectReasonLabel(l.rejectionReason) : "—"}
                  </span>
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  📞 {l.phone ?? "—"} · 👤 owner: {l.owner?.name ?? "(unassigned)"}
                </div>
                <div className="text-xs text-gray-600 mt-1">
                  Rejected by {l.rejectedById ? (rejecterById.get(l.rejectedById) ?? "(unknown)") : "—"}
                  {l.rejectedAt && <> · {fmtIST12(l.rejectedAt)}</>}
                </div>
                {l.rejectionNote && (
                  <div className="text-xs text-gray-600 mt-1 italic" title={l.rejectionNote}>
                    “{truncate(l.rejectionNote, 120)}”
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
