import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { notFound } from "next/navigation";
import Link from "next/link";
import ImportedFieldsCard from "@/components/ImportedFieldsCard";
import BuyerInlineEdit from "@/components/BuyerInlineEdit";
import { canTouchBuyer } from "@/lib/buyerScope";
import {
  parseJsonArray,
  rollupForRecords,
  formatTxnValue,
  inferBuyerCurrency,
} from "@/lib/buyerIntelligence";

// ── Buyer Data detail — scoped (admin = any; agent = own ASSIGNED) ───────────
// Full transaction record + repeat-buyer intelligence + "other properties by
// this buyer" (rollup on buyerKey). Key fields are inline-editable (PATCH with a
// field whitelist); the imported sheet columns show verbatim. Access is gated by
// canTouchBuyer so an agent reaching a buyer they don't own gets a 404.
export const dynamic = "force-dynamic";

const fmtDate = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—";
const toDateInput = (d: Date | null) =>
  d ? new Date(d).toISOString().slice(0, 10) : "";

export default async function BuyerDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  const { id } = await params;

  const rec = await prisma.buyerRecord.findUnique({ where: { id } });
  if (!rec) notFound();
  // 404 (not 403) if this user can't see this buyer — don't confirm existence.
  if (!(await canTouchBuyer(me, { ownerId: rec.ownerId, poolStatus: rec.poolStatus }))) notFound();

  // Repeat-buyer rollup: all records sharing this buyerKey (incl. this one).
  const siblings = rec.buyerKey
    ? await prisma.buyerRecord.findMany({
        where: { buyerKey: rec.buyerKey },
        orderBy: { transactionDate: "asc" },
      })
    : [rec];
  const rollup = rollupForRecords(siblings);
  const others = siblings.filter((s) => s.id !== rec.id);

  const ccy = inferBuyerCurrency({ nationality: rec.nationality, projectName: rec.projectName, source: rec.source });
  const coBuyers = parseJsonArray(rec.coBuyerNames);
  const phones = parseJsonArray(rec.phones);
  const emails = parseJsonArray(rec.emails);

  // Small read-only field renderer.
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

      {/* ── Other properties by this buyer ───────────────────────────────── */}
      {others.length > 0 && (
        <div className="card p-4">
          <div className="font-semibold mb-3 dark:text-slate-100">🔁 Other properties by this buyer <span className="text-[11px] text-gray-400 font-normal">— same buyer ({others.length})</span></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                  <th className="px-2 py-1.5">Project</th>
                  <th className="px-2 py-1.5">Tower / Unit</th>
                  <th className="px-2 py-1.5">Type</th>
                  <th className="px-2 py-1.5 text-right">Value</th>
                  <th className="px-2 py-1.5">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                {others.map((o) => {
                  const occy = inferBuyerCurrency({ nationality: o.nationality, projectName: o.projectName, source: o.source });
                  const tu = [o.tower, o.unitNumber].map((x) => (x ?? "").trim()).filter(Boolean).join(" · ");
                  return (
                    <tr key={o.id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                      <td className="px-2 py-1.5"><Link href={`/buyer-data/${o.id}`} className="text-[#0b1a33] dark:text-blue-300 hover:underline">{o.projectName || "—"}</Link></td>
                      <td className="px-2 py-1.5 text-gray-600 dark:text-slate-400">{tu || "—"}</td>
                      <td className="px-2 py-1.5 text-gray-600 dark:text-slate-400">{o.propertyType || "—"}</td>
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

      {/* ── Imported sheet columns (verbatim) ────────────────────────────── */}
      <ImportedFieldsCard customFields={rec.extraFields} />
    </div>
  );
}
