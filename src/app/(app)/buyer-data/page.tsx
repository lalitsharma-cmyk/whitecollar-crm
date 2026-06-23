import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import BuyerRecordsTable, { type BuyerRow } from "@/components/BuyerRecordsTable";
import {
  groupByBuyerKey,
  rollupForRecords,
  formatTxnValue,
  inferBuyerCurrency,
} from "@/lib/buyerIntelligence";

// ── Buyer Data — ADMIN/super-admin ONLY operations console ───────────────────
// Transaction-level property records (who bought what, for how much). Contains
// passport + financial data → admin-gated on EVERY page + API route. Repeat-buyer
// rollups (properties owned / total invested / repeat flag) are COMPUTED here by
// grouping the loaded rows on buyerKey — never stored, never stale.
export const dynamic = "force-dynamic";

const fmtDate = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "";

export default async function BuyerDataPage() {
  const me = await requireUser();
  // Admin / super-admin only — passport + financial data.
  if (me.role !== "ADMIN") redirect("/dashboard");

  // Load the full set (server-capped) — the table filters / sorts / paginates
  // client-side, Excel-style. 3000 is a safe cap for the current data volume.
  const records = await prisma.buyerRecord.findMany({
    orderBy: { transactionDate: "desc" },
    take: 3000,
  });

  // Group once on buyerKey so each row knows its buyer's rollup (properties
  // owned + repeat flag) without an N+1 of per-row queries.
  const groups = groupByBuyerKey(records);
  const rollupByKey = new Map<string, ReturnType<typeof rollupForRecords>>();
  for (const [k, recs] of groups) rollupByKey.set(k, rollupForRecords(recs));

  // Summary header figures.
  const totalRecords = records.length;
  const uniqueBuyers = groups.size;
  let repeatBuyers = 0;
  let totalInvestmentInr = 0;
  let totalInvestmentAed = 0;
  let totalInvestmentOther = 0;
  for (const [, rec] of groups.entries()) {
    if (rec.length > 1) repeatBuyers++;
  }
  for (const r of records) {
    const ccy = inferBuyerCurrency({ nationality: r.nationality, projectName: r.projectName, source: r.source });
    const v = typeof r.transactionValue === "number" && isFinite(r.transactionValue) ? r.transactionValue : 0;
    if (ccy === "INR") totalInvestmentInr += v;
    else if (ccy === "AED") totalInvestmentAed += v;
    else totalInvestmentOther += v;
  }
  const investmentParts: string[] = [];
  if (totalInvestmentInr) investmentParts.push(formatTxnValue(totalInvestmentInr, "INR"));
  if (totalInvestmentAed) investmentParts.push(formatTxnValue(totalInvestmentAed, "AED"));
  if (totalInvestmentOther) investmentParts.push(formatTxnValue(totalInvestmentOther));
  const investmentLabel = investmentParts.length ? investmentParts.join(" + ") : "—";

  // Filter option lists (distinct, sorted).
  const projects = Array.from(new Set(records.map((r) => (r.projectName ?? "").trim()).filter(Boolean))).sort();
  const propertyTypes = Array.from(new Set(records.map((r) => (r.propertyType ?? "").trim()).filter(Boolean))).sort();
  const nationalities = Array.from(new Set(records.map((r) => (r.nationality ?? "").trim()).filter(Boolean))).sort();

  // Map to table rows.
  const rows: BuyerRow[] = records.map((r) => {
    const key = (r.buyerKey ?? "").trim();
    const rollup = key ? rollupByKey.get(key) : undefined;
    const owned = rollup?.totalPropertiesOwned ?? 1;
    const repeat = rollup?.repeatBuyerStatus ?? false;
    const ccy = inferBuyerCurrency({ nationality: r.nationality, projectName: r.projectName, source: r.source });
    const towerUnit = [r.tower, r.unitNumber].map((x) => (x ?? "").trim()).filter(Boolean).join(" · ");
    // Phone search field — phones is a JSON/delimited string; raw substring match is fine.
    return {
      id: r.id,
      href: `/buyer-data/${r.id}`,
      clientName: r.clientName,
      project: r.projectName ?? "",
      towerUnit,
      propertyType: r.propertyType ?? "",
      configuration: r.configuration ?? "",
      txnValueDisplay: formatTxnValue(r.transactionValue, ccy),
      txnValueNum: typeof r.transactionValue === "number" && isFinite(r.transactionValue) ? r.transactionValue : 0,
      txnDate: fmtDate(r.transactionDate),
      txnDateMs: r.transactionDate ? new Date(r.transactionDate).getTime() : 0,
      nationality: r.nationality ?? "",
      agent: r.agentName ?? "",
      repeat,
      propertiesOwned: owned,
      phone: (r.phones ?? "") + " ",
      passport: r.passport ?? "",
    };
  });

  const stat = (label: string, value: string | number, tone?: string) => (
    <div className="rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3">
      <div className={`text-lg font-bold ${tone ?? "text-gray-800 dark:text-slate-100"}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</div>
    </div>
  );

  return (
    <>
      {/* ── Header + actions ──────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Buyer Data</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            Transaction & property ownership records · <span className="font-semibold">{totalRecords}</span> in view ·
            {" "}<span className="text-amber-600 dark:text-amber-400">admin-only</span> (passport &amp; financial data)
          </p>
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Link href="/buyer-data/import" className="btn btn-primary" title="Import buyer transaction data">⬆ Import</Link>
          <a href="/api/buyer-data/export" className="btn btn-ghost" title="Export buyer data to CSV">⬇ Export CSV</a>
        </div>
      </div>

      {/* ── Summary stats ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {stat("Total Records", totalRecords)}
        {stat("Unique Buyers", uniqueBuyers)}
        {stat("Repeat Buyers", repeatBuyers, repeatBuyers ? "text-amber-600 dark:text-amber-400" : undefined)}
        {stat("Total Investment", investmentLabel)}
      </div>

      {/* ── Records grid ──────────────────────────────────────────────────── */}
      <BuyerRecordsTable rows={rows} projects={projects} propertyTypes={propertyTypes} nationalities={nationalities} />
    </>
  );
}
