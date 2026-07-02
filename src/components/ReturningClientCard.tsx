// Unified Lead Detail (Phase E / WS-J J5) — the "Returning Client" card.
// Surfaces the CORE unified-profile rule on the lead detail: "whatever data
// exists anywhere for the SAME client is visible everywhere." Renders the merged
// cross-module picture (other enquiries by the same client + union summary) that
// the read-only, scope-safe resolver getReturningClientView() computes.
//
// Server component (no interactivity) — renders data + links directly. Shown ONLY
// when a real match exists (resolver returns null otherwise), so most lead views
// are unchanged. Two modes: LINKED (confirmed master customer) and ADVISORY
// (unconfirmed Very-High phone/email match — admin can confirm/link).
import Link from "next/link";
import type { ReturningClientView } from "@/lib/customer/returningClient";
import { statusColor } from "@/lib/lead-statuses";
import { formatLeadName } from "@/lib/leadName";
import { fmtISTDate } from "@/lib/datetime";

export default function ReturningClientCard({ view }: { view: ReturningClientView }) {
  const { isLinked, siblings, matchReasons, status, summary, customerHref } = view;
  const tone = isLinked
    ? "border-emerald-300 bg-emerald-50/60 dark:border-emerald-800 dark:bg-emerald-950/20"
    : "border-amber-300 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20";

  return (
    <div className={`card p-4 border ${tone}`}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="text-base">{isLinked ? "🔗" : "⚠️"}</span>
          <h2 className="font-semibold text-sm">
            {isLinked ? "Returning Client" : "Possible returning client"}
            <span className="ml-1.5 font-normal text-gray-500">
              {isLinked ? "· same customer across enquiries" : "· unconfirmed match — confirm to link"}
            </span>
          </h2>
        </div>
        <div className="flex items-center gap-1.5">
          {status && (
            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">{status}</span>
          )}
          {matchReasons.map((r) => (
            <span key={r} className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-white/70 border border-current/20 text-gray-600 dark:bg-slate-800 dark:text-slate-300">{r}</span>
          ))}
        </div>
      </div>

      {/* Union rollup — all contacts/projects seen across this client's enquiries. */}
      {summary && (
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
          <Rollup label="Enquiries" value={String(summary.enquiryCount)} />
          <Rollup label="Phones" value={summary.phones.join(", ") || "—"} />
          <Rollup label="Emails" value={summary.emails.join(", ") || "—"} />
          <Rollup label="Projects" value={summary.projects.join(", ") || "—"} />
          {summary.firstEnquiryAt && <Rollup label="First seen" value={fmtISTDate(summary.firstEnquiryAt)} />}
          {summary.lastEnquiryAt && <Rollup label="Last seen" value={fmtISTDate(summary.lastEnquiryAt)} />}
          {/* Owners rollup intentionally omitted — the summary holds raw ownerIds, and
              the sibling rows below already show owner NAMES (no raw cuid in the UI). */}
          {summary.sources.length > 0 && <Rollup label="Sources" value={summary.sources.join(", ")} />}
        </div>
      )}

      {/* The OTHER enquiries by this same client — the cross-module story. */}
      {siblings.length > 0 && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-widest text-gray-400 mb-1">
            Also appears as {siblings.length} other {siblings.length === 1 ? "enquiry" : "enquiries"}
          </div>
          <div className="divide-y divide-[#e5e7eb] dark:divide-slate-700 rounded-lg border border-[#e5e7eb] dark:border-slate-700 overflow-hidden">
            {siblings.map((s) => (
              <Link key={s.id} href={`/leads/${s.id}`} className="flex items-center justify-between gap-2 px-3 py-2 text-xs hover:bg-white/60 dark:hover:bg-slate-800/60">
                <span className="font-medium truncate">{formatLeadName(s.name)}</span>
                <span className="flex items-center gap-2 flex-none text-[10px] text-gray-500">
                  {s.currentStatus && <span className={`px-1.5 py-0.5 rounded ${statusColor(s.currentStatus)}`}>{s.currentStatus}</span>}
                  {s.forwardedTeam && <span>{s.forwardedTeam}</span>}
                  {s.sourceLabel && <span className="truncate max-w-[120px]" title={s.sourceLabel}>{s.sourceLabel}</span>}
                  {s.ownerName && <span>· {s.ownerName}</span>}
                  <span>{fmtISTDate(s.createdAt)}</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {isLinked && customerHref && (
        <div className="mt-2 text-right">
          <Link href={customerHref} className="text-[11px] text-blue-600 hover:underline">View full customer profile →</Link>
        </div>
      )}
    </div>
  );
}

function Rollup({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="truncate font-medium text-gray-700 dark:text-slate-200" title={value}>{value}</div>
    </div>
  );
}
