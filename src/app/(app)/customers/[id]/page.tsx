import { notFound } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { getCustomer360 } from "@/lib/customer/query";
import { statusColor } from "@/lib/lead-statuses";
import { formatLeadName } from "@/lib/leadName";
import CustomerTimeline from "@/components/CustomerTimeline";

// Read-only Customer 360 (Step 1 foundation). Permission-scoped via the loader
// (leadScopeWhere): an agent sees only their own enquiries under the customer, a
// manager their team's, an admin all. NOT editable (Rule 3) — every value shown
// (status / owner / confidence / summary) is COMPUTED LIVE from the enquiries,
// never stored. The page renders nothing a user can mutate here; linking/merging
// is a separate admin action (the audited link service).
//
// NOTE: this route is schema-dependent (Customer / Lead.customerId). The Step-1
// migration is NOT applied to prod, so this page is build-verified only; it
// becomes live once the (gated) schema deploys.
export const dynamic = "force-dynamic";

const STATUS_PILL: Record<string, string> = {
  Active: "bg-emerald-100 text-emerald-700 border border-emerald-200",
  Converted: "bg-blue-100 text-blue-700 border border-blue-200",
  Closed: "bg-slate-100 text-slate-600 border border-slate-200",
};

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <div className="text-sm text-slate-800 dark:text-slate-100 mt-0.5">{children}</div>
    </div>
  );
}

function Chips({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s) => (
        <span key={s} className="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-xs">{s}</span>
      ))}
    </div>
  );
}

export default async function Customer360Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const me = await requireUser();

  const c = await getCustomer360(me, id);
  if (!c) notFound();

  const ownerLabel =
    c.ownerOfRecord === "MULTIPLE"
      ? "Multiple Owners"
      : c.ownerOfRecordName ?? c.ownerOfRecord;

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Customer</p>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
            {formatLeadName(c.displayName)}
          </h1>
          <p className="text-xs text-slate-400 mt-1 font-mono">{c.id}</p>
        </div>
        <span className={"px-3 py-1 rounded-full text-sm font-medium " + (STATUS_PILL[c.status] ?? STATUS_PILL.Closed)}>
          {c.status}
        </span>
      </div>

      {/* Computed summary card */}
      <div className="card p-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Owner of record">{ownerLabel}</Stat>
          <Stat label="Enquiries">{c.summary.enquiryCount}</Stat>
          <Stat label="First enquiry">
            {c.summary.firstEnquiryAt
              ? c.summary.firstEnquiryAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" })
              : "—"}
          </Stat>
          <Stat label="Last enquiry">
            {c.summary.lastEnquiryAt
              ? c.summary.lastEnquiryAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" })
              : "—"}
          </Stat>
          <Stat label="Phones"><Chips items={c.summary.phones} /></Stat>
          <Stat label="Emails"><Chips items={c.summary.emails} /></Stat>
          <Stat label="Properties enquired"><Chips items={c.summary.projects} /></Stat>
          <Stat label="Sources"><Chips items={c.summary.sources} /></Stat>
        </div>

        {/* Live confidence (why these enquiries are one customer) */}
        {c.confidence.reasons.length > 0 && (
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
            <p className="text-xs uppercase tracking-wide text-slate-400 mb-1.5">
              Match confidence (computed) — {c.confidence.score}%
            </p>
            <div className="flex flex-wrap gap-1.5">
              {c.confidence.reasons.map((r) => (
                <span key={r} className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs">
                  ✓ {r}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Enquiries */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">
          Enquiries ({c.enquiries.length})
        </h2>
        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {c.enquiries.map((e) => (
            <div key={e.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <Link href={`/leads/${e.id}`} className="text-sm font-medium text-blue-600 hover:underline">
                  {formatLeadName(e.name)}
                </Link>
                <p className="text-xs text-slate-500 mt-0.5">
                  {[e.sourceDetail, e.sourceRaw, e.forwardedTeam].filter(Boolean).join(" · ") || "—"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400">{e.ownerName ?? "Unassigned"}</span>
                <span className={"px-2 py-0.5 rounded text-xs " + statusColor(e.currentStatus)}>
                  {e.currentStatus ?? "Fresh"}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Master timeline (filterable; events never removed) */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">Master timeline</h2>
        <CustomerTimeline
          events={c.timeline.map((t) => ({
            id: t.id,
            leadId: t.leadId,
            at: t.at.toISOString(),
            category: t.category,
            title: t.title,
            detail: t.detail,
            by: t.by,
          }))}
        />
      </div>

      <p className="text-xs text-slate-400 text-center">
        Read-only view · status, owner, confidence and summary are computed live from the linked enquiries · not editable here.
      </p>
    </div>
  );
}
