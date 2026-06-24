import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import ImportedFieldsCard from "@/components/ImportedFieldsCard";
import BuyerInlineEdit from "@/components/BuyerInlineEdit";
import BuyerActivityTimeline from "@/components/BuyerActivityTimeline";
import BuyerActionsClient from "@/components/BuyerActionsClient";
import BuyerAdminPanel from "@/components/BuyerAdminPanel";
import BuyerQuickNoteCard from "@/components/BuyerQuickNoteCard";
import BuyerNotesCard from "@/components/BuyerNotesCard";
import StickyNoteWidget from "@/components/StickyNoteWidget";
import LeadMobileTabs from "@/components/LeadMobileTabs";
import { canTouchBuyer } from "@/lib/buyerScope";
import {
  parseJsonArray,
  rollupForRecords,
  formatTxnValue,
  inferBuyerCurrency,
} from "@/lib/buyerIntelligence";

// ── Buyer Data detail — UNIFIED with the Lead detail view (Lead = master template).
// Same layout shell as src/app/(app)/leads/[id]/page.tsx:
//   • LeadMobileTabs + grid lg:grid-cols-3 (main col-span-2 + right rail)
//   • Header card: name (inline-edit) + status chip + action button row
//     (Call/WhatsApp/Email/Log Call/Note/Voice — BuyerActionsClient)
//   • Buyer Intelligence (mirrors BANT verdict slot at the top of the left column)
//   • Conversation History (Raw History + Smart Timeline — BuyerActivityTimeline)
//   • Quick Note (BuyerQuickNoteCard) — secondary, after Conversation History
//   • BELOW QUICK NOTE → Buyer Data Extra Section: Property / Transaction / Buyer
//     details (inline-edit) + Imported Fields + multi-property table.
//   • Right rail: floating Sticky-Note widget (StickyNoteWidget, apiBase=/api/buyer-data)
//     + Buyer admin panel (convert/assign/reject + attempt + transfer history).
// Buyer-specific data only; the Lead view is untouched. Scoped via canTouchBuyer.
export const dynamic = "force-dynamic";

const fmtDate = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—";
const toDateInput = (d: Date | null) =>
  d ? new Date(d).toISOString().slice(0, 10) : "";

export default async function BuyerDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;

  const rec = await prisma.buyerRecord.findUnique({ where: { id }, include: { owner: { select: { id: true, name: true } } } });
  if (!rec) notFound();
  // 404 (not 403) if this user can't see this buyer — also blocks a soft-deleted one.
  if (!(await canTouchBuyer(me, { ownerId: rec.ownerId, poolStatus: rec.poolStatus, deletedAt: rec.deletedAt }))) notFound();

  const isAdmin = me.role === "ADMIN";
  const isAdminOrMgr = me.role === "ADMIN" || me.role === "MANAGER";
  // Convert/Reject: the assigned agent (own ASSIGNED) or an admin. Assign/Transfer: admin/manager.
  const canConvertReject = isAdmin || (rec.ownerId === me.id && rec.poolStatus === "ASSIGNED");
  const canAssign = isAdminOrMgr;
  // canLog (action row + quick note): an ASSIGNED buyer worked by the viewer (or admin).
  const canLog = isAdmin || (rec.ownerId === me.id && rec.poolStatus === "ASSIGNED");
  // Inline edits are allowed for anyone who can touch the buyer (admin any; assigned
  // agent their own) — the PATCH route re-checks canTouchBuyer server-side.
  const canEditFields = canConvertReject;

  // Repeat-buyer rollup: all LIVE records sharing this buyerKey (incl. this one).
  const siblings = rec.buyerKey
    ? await prisma.buyerRecord.findMany({
        where: { buyerKey: rec.buyerKey, deletedAt: null },
        orderBy: { transactionDate: "asc" },
      })
    : [rec];
  const rollup = rollupForRecords(siblings);
  const others = siblings.filter((s) => s.id !== rec.id);

  // Agent roster for the admin panel (admin/mgr only).
  const agents = canAssign
    ? await prisma.user.findMany({
        where: { active: true, hrOnly: false, role: { in: ["AGENT", "MANAGER"] } },
        select: { id: true, name: true, team: true }, orderBy: { name: "asc" },
      })
    : [];

  // Sticky note — private to the calling user, upserted so the widget renders
  // synchronously (mirrors the Lead view's StickyNote upsert).
  const stickyNote = await prisma.buyerStickyNote.upsert({
    where: { buyerId_userId: { buyerId: rec.id, userId: me.id } },
    create: { buyerId: rec.id, userId: me.id, body: "" },
    update: {},
  });

  const ccy = inferBuyerCurrency({ nationality: rec.nationality, projectName: rec.projectName, source: rec.source });
  const coBuyers = parseJsonArray(rec.coBuyerNames);
  const phones = parseJsonArray(rec.phones);
  const emails = parseJsonArray(rec.emails);
  const primaryPhone = phones[0] ?? null;
  const altPhone = phones[1] ?? null;
  const primaryEmail = emails[0] ?? null;

  // poolStatus → status-chip colour, styled like the Lead status chip.
  const poolLabel = rec.poolStatus.replace(/_/g, " ");
  const statusChipCls =
    rec.poolStatus === "CONVERTED" ? "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-700"
    : rec.poolStatus === "ASSIGNED" ? "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700"
    : rec.poolStatus === "REJECTED" ? "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700"
    : "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700";

  // Small inline field renderer for the buyer extra section (label + value/editor).
  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex flex-col min-w-0">
      <span className="text-xs text-gray-500 dark:text-slate-400">{label}</span>
      <span className="text-gray-800 dark:text-slate-200 break-words text-sm">{children}</span>
    </div>
  );
  // Inline-or-readonly: edit when permitted, else show the value plainly (parity
  // with the Lead view, where agents on others' records see read-only values).
  const editable = (field: string, value: string | number | null, opts?: { type?: "text" | "number" | "date"; display?: string }) =>
    canEditFields
      ? <BuyerInlineEdit recordId={rec.id} field={field} value={value} type={opts?.type} display={opts?.display} />
      : <>{opts?.display ?? (value == null || value === "" ? "—" : String(value))}</>;

  return (
    <>
      {/* Mobile tab bar — identical mechanism to the Lead view (sets body[data-lead-tab]). */}
      <LeadMobileTabs />

      {/* Floating private sticky note — reuses the EXACT Lead widget, pointed at the
          buyer sticky-note API. Renders nothing until opened (or when a body exists). */}
      <StickyNoteWidget
        leadId={rec.id}
        initialBody={stickyNote.body}
        initialUpdatedAt={stickyNote.updatedAt ? stickyNote.updatedAt.toISOString() : null}
        apiBase="/api/buyer-data"
      />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 pb-24 lg:pb-0">
        {/* ── MAIN COLUMN (col-span-2) ──────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4">
          {/* Header — name + status chip + action button row (always visible, no
              data-lead-section so the mobile tabs never hide it; matches Lead view). */}
          <div className="card p-4">
            <div className="flex items-start justify-between flex-wrap gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold dark:text-slate-100">
                    {canEditFields
                      ? <BuyerInlineEdit recordId={rec.id} field="clientName" value={rec.clientName} />
                      : rec.clientName}
                  </h2>
                  {/* Status chip — styled like the Lead status chip. */}
                  <span className={`text-xs px-2.5 py-0.5 rounded-full border font-semibold inline-flex items-center ${statusChipCls}`}>
                    {poolLabel}
                  </span>
                  {rollup.repeatBuyerStatus && (
                    <span className="chip text-[10px] bg-amber-100 text-amber-800 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700">
                      🔁 Repeat buyer · {rollup.totalPropertiesOwned} properties
                    </span>
                  )}
                </div>
                <div className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                  {rec.projectName || "—"}{rec.unitNumber ? ` · Unit ${rec.unitNumber}` : ""}
                  {rec.source ? ` · imported via ${rec.source}` : ""}
                </div>
                {/* Requirement snapshot chips — Configuration + Transaction value (mirrors
                    the Lead header's config + budget chip row). */}
                {(rec.configuration || rec.transactionValue) && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                    {rec.configuration && (
                      <span className="bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 px-2 py-0.5 rounded font-medium">
                        {rec.configuration}
                      </span>
                    )}
                    {rec.transactionValue != null && (
                      <span className="bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700 px-2 py-0.5 rounded font-medium">
                        {formatTxnValue(rec.transactionValue, ccy)}
                      </span>
                    )}
                  </div>
                )}
                {/* Action button row — same visual style as the Lead view. */}
                <BuyerActionsClient
                  buyerId={rec.id}
                  phone={primaryPhone}
                  altPhone={altPhone}
                  email={primaryEmail}
                  clientName={rec.clientName}
                  agentName={me.name}
                  canLog={canLog}
                />
              </div>
            </div>
          </div>

          {/* Buyer Intelligence — occupies the BANT-verdict slot at the top of the
              left column (rollup metrics). data-lead-section="overview". */}
          <div data-lead-section="overview" className="card p-4 border-l-4 border-amber-400 bg-amber-50/40 dark:bg-amber-900/10">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className="text-xs font-bold tracking-widest text-gray-600 dark:text-slate-300">📊 BUYER INTELLIGENCE</span>
              <span className="text-[10px] text-gray-500 dark:text-slate-400">Properties · Investment · Purchase history</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
              <div>
                <div className="text-lg font-bold text-gray-800 dark:text-slate-100">{rollup.totalPropertiesOwned}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Properties Owned</div>
              </div>
              <div>
                <div className="text-lg font-bold text-gray-800 dark:text-slate-100">{formatTxnValue(rollup.totalInvestmentValue, ccy)}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Total Investment</div>
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-800 dark:text-slate-100 mt-1">{fmtDate(rollup.firstPurchaseDate)}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">First Purchase</div>
              </div>
              <div>
                <div className="text-sm font-semibold text-gray-800 dark:text-slate-100 mt-1">{fmtDate(rollup.latestPurchaseDate)}</div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Latest Purchase</div>
              </div>
              <div>
                <div className={`text-sm font-semibold mt-1 ${rollup.repeatBuyerStatus ? "text-amber-600 dark:text-amber-400" : "text-gray-500"}`}>
                  {rollup.repeatBuyerStatus ? "Repeat 🔁" : "First-time"}
                </div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400">Buyer Status</div>
              </div>
            </div>
          </div>

          {/* Conversation History — Raw History + Smart Timeline (BuyerActivity),
              same card look as the Lead Conversation History. */}
          <div data-lead-section="timeline">
            <BuyerActivityTimeline buyerId={rec.id} canLog={canLog} isAdmin={isAdmin} rawRemarks={rec.remarks} />
          </div>

          {/* Quick Note — secondary, after Conversation History (parity with Lead view). */}
          <div data-lead-section="timeline">
            <BuyerQuickNoteCard buyerId={rec.id} canLog={canLog} />
          </div>

          {/* ════════════════════════════════════════════════════════════════════
              BUYER DATA EXTRA SECTION — below Quick Note, in the available space.
              Property / Transaction / Buyer / Imported fields + multi-property table.
              This is the ONLY visible difference from the Lead view.
              ════════════════════════════════════════════════════════════════════ */}

          {/* Buyer Property Details */}
          <div data-lead-section="overview" className="card p-4">
            <div className="font-semibold mb-3 dark:text-slate-100">🏠 Buyer Property Details {canEditFields && <span className="text-[10px] text-gray-400 font-normal">(click any value to edit)</span>}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
              <Field label="Project">{editable("projectName", rec.projectName)}</Field>
              <Field label="Tower / Building">{editable("tower", rec.tower)}</Field>
              <Field label="Unit Number">{editable("unitNumber", rec.unitNumber)}</Field>
              <Field label="Property Type">{editable("propertyType", rec.propertyType)}</Field>
              <Field label="Configuration">{editable("configuration", rec.configuration)}</Field>
              <Field label="Size">{editable("size", rec.size)}</Field>
              <Field label="Actual Size">{editable("actualSize", rec.actualSize)}</Field>
              <Field label="Area">{editable("area", rec.area)}</Field>
              <Field label="Country">{editable("country", rec.country)}</Field>
            </div>
          </div>

          {/* Transaction Details */}
          <div data-lead-section="overview" className="card p-4">
            <div className="font-semibold mb-3 dark:text-slate-100">💳 Transaction Details {canEditFields && <span className="text-[10px] text-gray-400 font-normal">(click any value to edit)</span>}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
              <Field label="Transaction Value">{editable("transactionValue", rec.transactionValue, { type: "number", display: formatTxnValue(rec.transactionValue, ccy) })}</Field>
              <Field label="Transaction Date">{editable("transactionDate", toDateInput(rec.transactionDate), { type: "date", display: fmtDate(rec.transactionDate) })}</Field>
              <Field label="Transaction ID">{editable("transactionId", rec.transactionId)}</Field>
              <Field label="Price / sq.ft">{editable("pricePerSqFt", rec.pricePerSqFt, { type: "number", display: rec.pricePerSqFt != null ? formatTxnValue(rec.pricePerSqFt, ccy) : undefined })}</Field>
              <Field label="Transaction Type">{editable("transactionType", rec.transactionType)}</Field>
              <Field label="Role">{editable("role", rec.role)}</Field>
            </div>
          </div>

          {/* Buyer Details */}
          <div data-lead-section="overview" className="card p-4">
            <div className="font-semibold mb-3 dark:text-slate-100">👤 Buyer Details {canEditFields && <span className="text-[10px] text-gray-400 font-normal">(click any value to edit)</span>}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">
              <Field label="Buyer Name">{editable("clientName", rec.clientName)}</Field>
              <Field label="Co-Buyers">{coBuyers.length ? coBuyers.join(", ") : "—"}</Field>
              <Field label="Phones">{phones.length ? phones.join(", ") : "—"}</Field>
              <Field label="Emails">{emails.length ? emails.join(", ") : "—"}</Field>
              <Field label="Nationality">{editable("nationality", rec.nationality)}</Field>
              <Field label="Passport Number">{editable("passport", rec.passport)}</Field>
              <Field label="Passport Expiry">{editable("passportExpiry", rec.passportExpiry)}</Field>
              <Field label="Owner Name">{editable("ownerName", rec.ownerName)}</Field>
              <Field label="Sales Agent">{editable("agentName", rec.agentName)}</Field>
            </div>
          </div>

          {/* Imported Fields — unmapped import columns (extraFields) + the verbatim
              full original row (rawImport, collapsible "Original Imported Row"). */}
          <ImportedFieldsCard customFields={rec.extraFields} rawImport={rec.rawImport} />

          {/* Multiple Properties table — all records sharing this buyerKey. */}
          {others.length > 0 && (
            <div data-lead-section="overview" className="card p-4">
              <div className="font-semibold mb-3 dark:text-slate-100">🏘️ Properties owned by this buyer <span className="text-[11px] text-gray-400 font-normal">— {rollup.totalPropertiesOwned} total (this + {others.length} other{others.length === 1 ? "" : "s"})</span></div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                      <th className="px-2 py-1.5">Project</th>
                      <th className="px-2 py-1.5">Tower / Building</th>
                      <th className="px-2 py-1.5">Unit</th>
                      <th className="px-2 py-1.5">Config</th>
                      <th className="px-2 py-1.5">Size</th>
                      <th className="px-2 py-1.5 text-right">Txn Value</th>
                      <th className="px-2 py-1.5">Txn Date</th>
                      <th className="px-2 py-1.5">Owner</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {[rec, ...others].map((o) => {
                      const occy = inferBuyerCurrency({ nationality: o.nationality, projectName: o.projectName, source: o.source });
                      const isThis = o.id === rec.id;
                      return (
                        <tr key={o.id} className={isThis ? "bg-amber-50/40 dark:bg-amber-900/10" : "hover:bg-gray-50 dark:hover:bg-slate-800/50"}>
                          <td className="px-2 py-1.5">
                            {isThis ? <span className="font-medium text-gray-800 dark:text-slate-200">{o.projectName || "—"} <span className="text-[10px] text-amber-600">(this)</span></span>
                              : <Link href={`/buyer-data/${o.id}`} className="text-[#0b1a33] dark:text-blue-300 hover:underline">{o.projectName || "—"}</Link>}
                          </td>
                          <td className="px-2 py-1.5 text-gray-600 dark:text-slate-400">{o.tower || "—"}</td>
                          <td className="px-2 py-1.5 text-gray-600 dark:text-slate-400">{o.unitNumber || "—"}</td>
                          <td className="px-2 py-1.5 text-gray-600 dark:text-slate-400">{o.configuration || "—"}</td>
                          <td className="px-2 py-1.5 text-gray-600 dark:text-slate-400">{o.size || "—"}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums text-gray-800 dark:text-slate-200">{formatTxnValue(o.transactionValue, occy)}</td>
                          <td className="px-2 py-1.5 text-gray-600 dark:text-slate-400 whitespace-nowrap">{fmtDate(o.transactionDate)}</td>
                          <td className="px-2 py-1.5 text-gray-600 dark:text-slate-400">{o.ownerName || "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT RAIL ────────────────────────────────────────────────────── */}
        <div className="space-y-3">
          {/* Buyer admin panel — convert / assign / reject + attempt + transfer history
              (mirrors the Lead "Lead admin" right-rail card). */}
          <BuyerAdminPanel
            buyerId={rec.id}
            poolStatus={rec.poolStatus}
            ownerName={rec.owner?.name ?? null}
            convertedLeadId={rec.convertedLeadId}
            canConvertReject={canConvertReject}
            canAssign={canAssign}
            showHistory={isAdminOrMgr}
            agents={agents}
          />

          {/* Working notes — SHARED free-text notes retained across reassignments
              (distinct from the per-user Quick Note / sticky note above). */}
          <BuyerNotesCard buyerId={rec.id} initial={rec.remarks} canEdit={canEditFields} />

          {/* Source / import provenance — small read-only card (admin/manager),
              like the Lead view's reference cards on the right rail. */}
          {isAdminOrMgr && (
            <div data-lead-section="admin" className="card p-4">
              <div className="text-[10px] uppercase tracking-widest text-gray-500 dark:text-slate-400 font-semibold mb-2">📥 Source</div>
              <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-xs">
                <dt className="text-gray-400 dark:text-slate-500">Source</dt>
                <dd className="text-gray-700 dark:text-slate-200 break-words">{rec.source || "—"}</dd>
                {rec.sourceFile && (<><dt className="text-gray-400 dark:text-slate-500">File</dt><dd className="text-gray-700 dark:text-slate-200 break-words">{rec.sourceFile}</dd></>)}
                <dt className="text-gray-400 dark:text-slate-500">Imported</dt>
                <dd className="text-gray-700 dark:text-slate-200">{fmtDate(rec.createdAt)}</dd>
              </dl>
            </div>
          )}

          <Link href="/buyer-data" className="text-xs text-[#0b1a33] dark:text-blue-300 font-semibold inline-block">← Back to Buyer Data</Link>
        </div>
      </div>
    </>
  );
}
