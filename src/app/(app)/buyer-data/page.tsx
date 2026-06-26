import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import BuyerListClient, { type BuyerRow, type BuyerAgent } from "@/components/BuyerListClient";
import { buyerScopeWhere, canAccessDubaiBuyers, isDubaiAssignable } from "@/lib/buyerScope";
import {
  groupByBuyerKey,
  rollupForRecords,
  formatTxnValue,
  inferBuyerCurrency,
  classifyBuyer,
} from "@/lib/buyerIntelligence";

// ── Buyer Data — worked pipeline, now with the Leads LIST EXPERIENCE (Part 5b) ──
// Transaction-level property records worked like a lightweight Leads pipeline:
// Admin Pool → assigned to an agent → CONVERTED / REJECTED. Contains passport +
// financial data, so reads are SCOPED via buyerScopeWhere:
//   ADMIN   → every live buyer (pool + all agents').
//   AGENT   → ONLY their own currently-ASSIGNED buyers.
//   MANAGER → their team's agents' buyers.
// Soft-deleted (recycle-bin) buyers are excluded by buyerScopeWhere.
// The client provides: filters (poolStatus / owner / project / type / nationality /
// region / repeat / search), sortable columns, Saved Views, two views (Admin Pool
// vs Assigned/All), and an admin bulk toolbar (Assign / Transfer / Delete / Export /
// Edit) + the AI distribution console. Repeat-buyer rollups are computed here.
export const dynamic = "force-dynamic";

const fmtDate = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "";

const POOL_LABEL: Record<string, string> = {
  ADMIN_POOL: "Admin Pool",
  ASSIGNED: "Assigned",
  CONVERTED: "Converted",
  REJECTED: "Rejected",
};

export default async function BuyerDataPage() {
  const me = await requireUser();
  // Dubai Buyer Data is visible only to Admin/super-admin + Dubai-team users.
  // A non-Dubai (India/Gurgaon) agent/manager is redirected away (the nav item is
  // also hidden for them in MobileShell).
  if (!canAccessDubaiBuyers(me)) redirect("/dashboard");
  const isAdmin = me.role === "ADMIN";
  const isAdminOrMgr = me.role === "ADMIN" || me.role === "MANAGER";
  // Scope to what this user may see — buyerScopeWhere pins market="Dubai"
  // (admin = all Dubai + pool; Dubai agent = own ASSIGNED Dubai buyers).
  const scope = await buyerScopeWhere(me);

  // Load the scoped set (server-capped) — the client filters / sorts / paginates.
  const records = await prisma.buyerRecord.findMany({
    where: scope,
    orderBy: [{ poolStatus: "asc" }, { transactionDate: "desc" }],
    take: 5000,
    include: { owner: { select: { id: true, name: true } } },
  });

  // Group once on buyerKey so each row knows its buyer's rollup (properties owned +
  // repeat flag) without an N+1 of per-row queries. (Deleted rows are already excluded.)
  const groups = groupByBuyerKey(records);
  const rollupByKey = new Map<string, ReturnType<typeof rollupForRecords>>();
  for (const [k, recs] of groups) rollupByKey.set(k, rollupForRecords(recs));

  // Summary header figures.
  const totalRecords = records.length;
  const uniqueBuyers = groups.size;
  let repeatBuyers = 0;
  let poolCount = 0;
  let assignedCount = 0;
  let convertedCount = 0;
  let totalInvestmentInr = 0;
  let totalInvestmentAed = 0;
  let totalInvestmentOther = 0;
  for (const [, rec] of groups.entries()) if (rec.length > 1) repeatBuyers++;
  for (const r of records) {
    if (r.poolStatus === "ADMIN_POOL") poolCount++;
    else if (r.poolStatus === "ASSIGNED") assignedCount++;
    else if (r.poolStatus === "CONVERTED") convertedCount++;
    const ccy = inferBuyerCurrency({ nationality: r.nationality, projectName: r.projectName, source: r.source, market: r.market });
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
  const owners = Array.from(
    new Map(records.filter((r) => r.owner).map((r) => [r.owner!.id, r.owner!.name])).entries(),
  ).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  // The active agent roster (admin/mgr only — powers Assign/Transfer + AI
  // distribution). DUBAI ONLY: assignment is limited to Dubai-team users + admins,
  // so the roster offered to the UI excludes India/Gurgaon + HR/non-sales users.
  // (The server endpoints re-enforce this via isDubaiAssignable.)
  let agents: BuyerAgent[] = [];
  if (isAdminOrMgr) {
    // Allowed targets = Dubai-team AGENT/MANAGER, PLUS admins (any team — admins
    // can hold/convert any market's buyers). India/Gurgaon + HR/non-sales excluded.
    const ag = await prisma.user.findMany({
      where: {
        active: true,
        hrOnly: false,
        OR: [
          { team: "Dubai", role: { in: ["AGENT", "MANAGER"] } },
          { role: "ADMIN" },
        ],
      },
      select: { id: true, name: true, team: true, role: true },
      orderBy: { name: "asc" },
    });
    // Defensive: keep only genuinely Dubai-assignable users (team=Dubai or admin).
    agents = ag.filter((a) => isDubaiAssignable(a)).map(({ id, name, team }) => ({ id, name, team }));
  }

  // Map to table rows.
  const rows: BuyerRow[] = records.map((r) => {
    const key = (r.buyerKey ?? "").trim();
    const rollup = key ? rollupByKey.get(key) : undefined;
    const owned = rollup?.totalPropertiesOwned ?? 1;
    const repeat = rollup?.repeatBuyerStatus ?? false;
    const ccy = inferBuyerCurrency({ nationality: r.nationality, projectName: r.projectName, source: r.source, market: r.market });
    const towerUnit = [r.tower, r.unitNumber].map((x) => (x ?? "").trim()).filter(Boolean).join(" · ");
    const region = ccy === "INR" ? "India" : ccy === "AED" ? "Dubai/UAE" : "—";
    // Classification from the buyer's full rollup (total invested + properties owned),
    // not this single row — so a repeat/whale buyer is tagged on every one of their rows.
    const totalInvested = rollup?.totalInvestmentValue ?? (typeof r.transactionValue === "number" && isFinite(r.transactionValue) ? r.transactionValue : 0);
    const buyerClass = classifyBuyer({ totalPropertiesOwned: owned, totalInvestmentValue: totalInvested }, ccy);
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
      region,
      agent: r.owner?.name ?? r.agentName ?? "",
      ownerId: r.owner?.id ?? "",
      poolStatus: r.poolStatus,
      poolStatusLabel: POOL_LABEL[r.poolStatus] ?? r.poolStatus,
      attemptCount: r.attemptCount,
      repeat,
      propertiesOwned: owned,
      buyerClass,
      createdAtMs: r.createdAt ? new Date(r.createdAt).getTime() : 0,
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
          <h1 className="text-xl sm:text-2xl font-bold">Dubai Buyer Data</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            {isAdmin ? "Dubai worked pipeline — Admin Pool → agent → convert / reject" : "Dubai buyers assigned to you"} · <span className="font-semibold">{totalRecords}</span> in view ·
            {" "}<span className="text-amber-600 dark:text-amber-400">passport &amp; financial data</span>
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Link href="/buyer-data/import" className="btn btn-primary" title="Import buyer transaction data">⬆ Import</Link>
            <a href="/api/buyer-data/export" className="btn btn-ghost" title="Export buyer data to CSV">⬇ Export CSV</a>
          </div>
        )}
      </div>

      {/* ── Summary stats ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mt-3">
        {stat("Total", totalRecords)}
        {stat("Unique Buyers", uniqueBuyers)}
        {stat("Admin Pool", poolCount, poolCount ? "text-blue-600 dark:text-blue-400" : undefined)}
        {stat("Assigned", assignedCount, assignedCount ? "text-emerald-600 dark:text-emerald-400" : undefined)}
        {stat("Repeat Buyers", repeatBuyers, repeatBuyers ? "text-amber-600 dark:text-amber-400" : undefined)}
        {stat("Investment", investmentLabel)}
      </div>

      {/* ── List experience ───────────────────────────────────────────────── */}
      <div className="mt-3">
        <BuyerListClient
          rows={rows}
          projects={projects}
          propertyTypes={propertyTypes}
          nationalities={nationalities}
          owners={owners}
          agents={agents}
          isAdmin={isAdmin}
          isAdminOrMgr={isAdminOrMgr}
          viewerId={me.id}
          poolAvailable={poolCount}
          convertedCount={convertedCount}
        />
      </div>
    </>
  );
}
