import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import ImportedFieldsCard from "@/components/ImportedFieldsCard";
import BuyerInlineEdit from "@/components/BuyerInlineEdit";
import BuyerDetailActions from "@/components/BuyerDetailActions";
import BuyerActivityTimeline from "@/components/BuyerActivityTimeline";
import BuyerNotesCard from "@/components/BuyerNotesCard";
import { canTouchBuyer } from "@/lib/buyerScope";
import {
  parseJsonArray,
  rollupForRecords,
  formatTxnValue,
  inferBuyerCurrency,
} from "@/lib/buyerIntelligence";

// ── Buyer Data detail — a Lead-style view (Part 5b) ──────────────────────────
// Scoped (admin = any live buyer; assigned agent = own ASSIGNED) via canTouchBuyer.
// Layout (top → bottom): header + lifecycle action bar (convert/reject/assign) →
// intelligence → client / property / transaction (inline-editable) → multi-property
// table (all records sharing this buyerKey) → NOTES → IMPORTED FIELDS → CONVERSATION
// & ACTIVITY timeline (imported fields sit BETWEEN notes and conversation, per spec).
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

  // Repeat-buyer rollup: all LIVE records sharing this buyerKey (incl. this one).
  const siblings = rec.buyerKey
    ? await prisma.buyerRecord.findMany({
        where: { buyerKey: rec.buyerKey, deletedAt: null },
        orderBy: { transactionDate: "asc" },
      })
    : [rec];
  const rollup = rollupForRecords(siblings);
  const others = siblings.filter((s) => s.id !== rec.id);

  // Agent roster for the action bar (admin/mgr only).
  const agents = canAssign
    ? await prisma.user.findMany({
        where: { active: true, hrOnly: false, role: { in: ["AGENT", "MANAGER"] } },
        select: { id: true, name: true, team: true }, orderBy: { name: "asc" },
      })
    : [];

  const ccy = inferBuyerCurrency({ nationality: rec.nationality, projectName: rec.projectName, source: rec.source });
  const coBuyers = parseJsonArray(rec.coBuyerNames);
  const phones = parseJsonArray(rec.phones);
  const emails = parseJsonArray(rec.emails);

  const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex flex-col min-w-0">
      <span className="text-[10px] uppercase tracking-wide text-gray-400">{label}</span>
      <span className="text-gray-800 dark:text-slate-200 break-words">{children}</span>
    </div>
  );

  return (
    <div className="space-y-4 max-w-5xl">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
        <div className="min-w-0">
          <Link href="/buyer-data" className="text-xs text-gray-500 hover:text-gray-800 dark:hover:text-slate-200">← Buyer Data</Link>
          <h1 className="text-xl sm:text-2xl font-bold mt-1 flex items-center gap-2 flex-wrap">
            <BuyerInlineEdit recordId={rec.id} field="clientName" value={rec.clientName} />
            {rollup.repeatBuyerStatus && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200 px-2.5 py-0.5 text-xs font-semibold dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700">
                🔁 Repeat buyer · {rollup.totalPropertiesOwned} properties
              </span>
            )}
          </h1>
          <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">
            {rec.projectName || "—"}{rec.unitNumber ? ` · Unit ${rec.unitNumber}` : ""}
            {rec.source ? ` · imported via ${rec.source}` : ""}
          </p>
        </div>
      </div>

      {/* ── Lifecycle action bar (convert / reject / assign / transfer) ──────── */}
      <BuyerDetailActions
        buyerId={rec.id}
        poolStatus={rec.poolStatus}
        ownerName={rec.owner?.name ?? null}
        convertedLeadId={rec.convertedLeadId}
        canConvertReject={canConvertReject}
        canAssign={canAssign}
        agents={agents}
      />

      {/* ── Intelligence panel ───────────────────────────────────────────── */}
      <div className="card p-4">
        <div className="font-semibold mb-2 dark:text-slate-100">📊 Buyer Intelligence</div>
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

      {/* ── Client info ──────────────────────────────────────────────────── */}
      <div className="card p-4">
        <div className="font-semibold mb-3 dark:text-slate-100">👤 Client</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3 text-sm">
          <Field label="Client Name"><BuyerInlineEdit recordId={rec.id} field="clientName" value={rec.clientName} /></Field>
          <Field label="Co-buyers">{coBuyers.length ? coBuyers.join(", ") : "—"}</Field>
          <Field label="Phones">{phones.length ? phones.join(", ") : "—"}</Field>
          <Field label="Emails">{emails.length ? emails.join(", ") : "—"}</Field>
          <Field label="Passport"><BuyerInlineEdit recordId={rec.id} field="passport" value={rec.passport} /></Field>
          <Field label="Nationality"><BuyerInlineEdit recordId={rec.id} field="nationality" value={rec.nationality} /></Field>
        </div>
      </div>

      {/* ── Property ─────────────────────────────────────────────────────── */}
      <div className="card p-4">
        <div className="font-semibold mb-3 dark:text-slate-100">🏠 Property</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3 text-sm">
          <Field label="Project"><BuyerInlineEdit recordId={rec.id} field="projectName" value={rec.projectName} /></Field>
          <Field label="Tower / Building"><BuyerInlineEdit recordId={rec.id} field="tower" value={rec.tower} /></Field>
          <Field label="Unit Number"><BuyerInlineEdit recordId={rec.id} field="unitNumber" value={rec.unitNumber} /></Field>
          <Field label="Property Type"><BuyerInlineEdit recordId={rec.id} field="propertyType" value={rec.propertyType} /></Field>
          <Field label="Configuration"><BuyerInlineEdit recordId={rec.id} field="configuration" value={rec.configuration} /></Field>
        </div>
      </div>

      {/* ── Transaction ──────────────────────────────────────────────────── */}
      <div className="card p-4">
        <div className="font-semibold mb-3 dark:text-slate-100">💳 Transaction</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3 text-sm">
          <Field label="Transaction Value">
            <BuyerInlineEdit recordId={rec.id} field="transactionValue" type="number" value={rec.transactionValue}
              display={formatTxnValue(rec.transactionValue, ccy)} />
          </Field>
          <Field label="Price / sq.ft">
            <BuyerInlineEdit recordId={rec.id} field="pricePerSqFt" type="number" value={rec.pricePerSqFt}
              display={rec.pricePerSqFt != null ? formatTxnValue(rec.pricePerSqFt, ccy) : ""} />
          </Field>
          <Field label="Transaction Date">
            <BuyerInlineEdit recordId={rec.id} field="transactionDate" type="date" value={toDateInput(rec.transactionDate)}
              display={fmtDate(rec.transactionDate)} />
          </Field>
          <Field label="Transaction ID"><BuyerInlineEdit recordId={rec.id} field="transactionId" value={rec.transactionId} /></Field>
          <Field label="Agent"><BuyerInlineEdit recordId={rec.id} field="agentName" value={rec.agentName} /></Field>
          <Field label="Source">{rec.source || "—"}{rec.sourceFile ? ` (${rec.sourceFile})` : ""}</Field>
        </div>
      </div>

      {/* ── Multiple property ownership table (all records on this buyerKey) ── */}
      {others.length > 0 && (
        <div className="card p-4">
          <div className="font-semibold mb-3 dark:text-slate-100">🏘️ Properties owned by this buyer <span className="text-[11px] text-gray-400 font-normal">— {rollup.totalPropertiesOwned} total (this + {others.length} other{others.length === 1 ? "" : "s"})</span></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                  <th className="px-2 py-1.5">Project</th>
                  <th className="px-2 py-1.5">Tower</th>
                  <th className="px-2 py-1.5">Unit</th>
                  <th className="px-2 py-1.5">Config</th>
                  <th className="px-2 py-1.5 text-right">Txn Value</th>
                  <th className="px-2 py-1.5">Txn Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {/* This record first (highlighted), then the others. */}
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
                      <td className="px-2 py-1.5 text-right tabular-nums text-gray-800 dark:text-slate-200">{formatTxnValue(o.transactionValue, occy)}</td>
                      <td className="px-2 py-1.5 text-gray-600 dark:text-slate-400 whitespace-nowrap">{fmtDate(o.transactionDate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Notes (working remarks) ──────────────────────────────────────── */}
      <BuyerNotesCard buyerId={rec.id} initial={rec.remarks} canEdit={canConvertReject || isAdmin} />

      {/* ── Imported sheet columns — BETWEEN Notes and Conversation (per spec) ── */}
      <ImportedFieldsCard customFields={rec.extraFields} />

      {/* ── Conversation & Activity timeline + log controls + agent history ── */}
      <BuyerActivityTimeline buyerId={rec.id} canLog={canConvertReject} isAdmin={isAdmin} />
    </div>
  );
}
