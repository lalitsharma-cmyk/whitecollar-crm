// Customer Identity Resolution Center (Phase E) — ADMIN-only.
// Surfaces UNLINKED duplicate groups (same mobile / same email) so an admin can
// link each into ONE virtual Customer. Records stay separate; linking is reversible.
// Agents never see this page (requireRole ADMIN redirects everyone else).
import { requireRole } from "@/lib/auth";
import { getUnlinkedCandidateGroups } from "@/lib/customer/candidates";
import { statusColor } from "@/lib/lead-statuses";
import { formatLeadName } from "@/lib/leadName";
import { fmtISTDate } from "@/lib/datetime";
import IdentityLinkButton from "@/components/IdentityLinkButton";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function IdentityResolutionPage() {
  await requireRole("ADMIN"); // admin-only — non-admins are redirected inside requireRole
  const groups = await getUnlinkedCandidateGroups(100);
  const totalLeads = groups.reduce((n, g) => n + g.leads.length, 0);

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">🪪 Customer Identity</h1>
          <p className="text-xs sm:text-sm text-gray-500">
            Same person across enquiries. Link a group into ONE customer — records stay separate, always reversible.
          </p>
        </div>
        {groups.length > 0 && (
          <div className="text-right">
            <div className="text-2xl font-extrabold text-[#0b1a33] dark:text-slate-100">{groups.length}</div>
            <div className="text-[10px] uppercase tracking-widest text-gray-500">groups · {totalLeads} records</div>
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <div className="card p-5 text-center text-gray-500">
          ✅ No unresolved duplicates. Every same-phone / same-email enquiry is already linked.
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={`${g.matchType}:${g.key}`} className="card p-4">
              <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    {g.matchType === "phone" ? "Same mobile" : "Same email"}
                  </span>
                  <span className="font-mono text-gray-600 dark:text-slate-300">{g.key}</span>
                  <span className="text-gray-400">· {g.leads.length} records</span>
                </div>
                <IdentityLinkButton leadIds={g.leads.map((l) => l.id)} count={g.leads.length} />
              </div>
              <div className="divide-y divide-[#e5e7eb] dark:divide-slate-700 rounded-lg border border-[#e5e7eb] dark:border-slate-700 overflow-hidden">
                {g.leads.map((l) => (
                  <div key={l.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-gray-50 dark:hover:bg-slate-800/40">
                    <Link href={`/leads/${l.id}`} className="font-medium truncate hover:underline">{formatLeadName(l.name)}</Link>
                    <div className="flex items-center gap-2 flex-none text-[10px] text-gray-500">
                      {l.currentStatus && <span className={`px-1.5 py-0.5 rounded ${statusColor(l.currentStatus)}`}>{l.currentStatus}</span>}
                      {l.forwardedTeam && <span>{l.forwardedTeam}</span>}
                      {l.ownerName && <span>· {l.ownerName}</span>}
                      <span>{fmtISTDate(l.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-gray-400">
        Candidates = unlinked leads sharing a mobile or email. Linking creates a virtual Customer (view at /customers/[id]); the enquiries are never merged or deleted and can be unlinked at any time.
      </p>
    </>
  );
}
