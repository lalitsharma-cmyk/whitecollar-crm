import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import BuyerListClient, { type BuyerRow, type BuyerAgent } from "@/components/BuyerListClient";
import { buyerScopeWhereForMarket, canAccessBuyerMarket, INDIA_MARKET } from "@/lib/buyerScope";
import {
  groupByBuyerKey,
  rollupForRecords,
  formatTxnValue,
  inferBuyerCurrency,
  classifyBuyer,
} from "@/lib/buyerIntelligence";

// ── INDIA Buyer Data — the India-market (INR / Cr) sibling of Dubai Buyer Data ──
// SAME worked-pipeline experience + SAME components as Dubai Buyer Data, but scoped to
// market="India" and gated to the India team (+ admins). Currency is auto-inferred per
// row (market="India" → INR/Cr) by inferBuyerCurrency, so no forked formatting. The
// security scope is buyerScopeWhereForMarket(me,"India"): an India agent sees only their
// own ASSIGNED India buyers, a Dubai user sees NOTHING here, and vice-versa.
export const dynamic = "force-dynamic";

const fmtDate = (d: Date | null) =>
  d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "";

const POOL_LABEL: Record<string, string> = {
  ADMIN_POOL: "Admin Pool", ASSIGNED: "Assigned", CONVERTED: "Converted", REJECTED: "Rejected",
};

export default async function IndiaBuyerDataPage() {
  const me = await requireUser();
  // India Buyer Data is visible only to Admin/super-admin + India-team users.
  if (!canAccessBuyerMarket(me, INDIA_MARKET)) redirect("/dashboard");
  const isAdmin = me.role === "ADMIN";
  const isAdminOrMgr = me.role === "ADMIN" || me.role === "MANAGER";
  const scope = await buyerScopeWhereForMarket(me, INDIA_MARKET);

  const records = await prisma.buyerRecord.findMany({
    where: scope,
    orderBy: [{ poolStatus: "asc" }, { transactionDate: "desc" }],
    take: 5000,
    include: { owner: { select: { id: true, name: true } } },
  });

  const groups = groupByBuyerKey(records);
  const rollupByKey = new Map<string, ReturnType<typeof rollupForRecords>>();
  for (const [k, recs] of groups) rollupByKey.set(k, rollupForRecords(recs));

  const totalRecords = records.length;
  const uniqueBuyers = groups.size;
  let repeatBuyers = 0, poolCount = 0, assignedCount = 0, convertedCount = 0, rejectedCount = 0;
  let totalInvestmentInr = 0, totalInvestmentAed = 0, totalInvestmentOther = 0;
  for (const [, rec] of groups.entries()) if (rec.length > 1) repeatBuyers++;
  for (const r of records) {
    if (r.poolStatus === "ADMIN_POOL") poolCount++;
    else if (r.poolStatus === "ASSIGNED") assignedCount++;
    else if (r.poolStatus === "CONVERTED") convertedCount++;
    else if (r.poolStatus === "REJECTED") rejectedCount++;
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

  const projects = Array.from(new Set(records.map((r) => (r.projectName ?? "").trim()).filter(Boolean))).sort();
  const propertyTypes = Array.from(new Set(records.map((r) => (r.propertyType ?? "").trim()).filter(Boolean))).sort();
  const nationalities = Array.from(new Set(records.map((r) => (r.nationality ?? "").trim()).filter(Boolean))).sort();
  const owners = Array.from(
    new Map(records.filter((r) => r.owner).map((r) => [r.owner!.id, r.owner!.name])).entries(),
  ).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  // India assignment roster: India-team AGENT/MANAGER + admins (server endpoints
  // re-enforce). Empty for non-admin/mgr.
  let agents: BuyerAgent[] = [];
  if (isAdminOrMgr) {
    const ag = await prisma.user.findMany({
      where: { active: true, hrOnly: false, OR: [{ team: "India", role: { in: ["AGENT", "MANAGER"] } }, { role: "ADMIN" }] },
      select: { id: true, name: true, team: true },
      orderBy: { name: "asc" },
    });
    agents = ag.map(({ id, name, team }) => ({ id, name, team }));
  }

  const rows: BuyerRow[] = records.map((r) => {
    const key = (r.buyerKey ?? "").trim();
    const rollup = key ? rollupByKey.get(key) : undefined;
    const owned = rollup?.totalPropertiesOwned ?? 1;
    const repeat = rollup?.repeatBuyerStatus ?? false;
    const ccy = inferBuyerCurrency({ nationality: r.nationality, projectName: r.projectName, source: r.source, market: r.market });
    const towerUnit = [r.tower, r.unitNumber].map((x) => (x ?? "").trim()).filter(Boolean).join(" · ");
    const region = ccy === "INR" ? "India" : ccy === "AED" ? "Dubai/UAE" : "—";
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
      businessStatus: r.businessStatus ?? "",
      followupDisplay: fmtDate(r.followupDate),
      followupMs: r.followupDate ? new Date(r.followupDate).getTime() : 0,
      attemptCount: r.attemptCount,
      repeat,
      propertiesOwned: owned,
      buyerClass,
      createdAtMs: r.createdAt ? new Date(r.createdAt).getTime() : 0,
      phone: (r.phones ?? "") + " ",
      passport: r.passport ?? "",
    };
  });

  return (
    <>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">India Buyer Data</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            {isAdmin ? "India worked pipeline — Admin Pool → agent → convert / reject" : "India buyers assigned to you"} · <span className="font-semibold">{totalRecords}</span> in view ·
            {" "}<span className="text-amber-600 dark:text-amber-400">₹ INR / Cr</span>
          </p>
        </div>
        {isAdmin && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Link href="/india-buyer-data/import" className="btn btn-primary" title="Import India buyer transaction data">⬆ Import</Link>
            <a href="/api/buyer-data/export?market=India" className="btn btn-ghost" title="Export India buyer data to CSV">⬇ Export CSV</a>
          </div>
        )}
      </div>

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
          summary={{ total: totalRecords, uniqueBuyers, repeatBuyers, pool: poolCount, assigned: assignedCount, converted: convertedCount, rejected: rejectedCount, investmentLabel }}
        />
      </div>
    </>
  );
}
