import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Prisma } from "@prisma/client";
import BuyerListClient, { type BuyerRow, type BuyerAgent } from "@/components/BuyerListClient";
import HelpDot from "@/components/HelpDot";
import { buyerScopeWhere, canAccessDubaiBuyers, isDubaiAssignable } from "@/lib/buyerScope";
import { istDayRange, isValidDateKey } from "@/lib/datetime";
import { canExportData } from "@/lib/exportPerms";
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

export default async function BuyerDataPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  // Dubai Buyer Data is visible only to Admin/super-admin + Dubai-team users.
  // A non-Dubai (India/Gurgaon) agent/manager is redirected away (the nav item is
  // also hidden for them in MobileShell).
  if (!canAccessDubaiBuyers(me)) redirect("/dashboard");
  const isAdmin = me.role === "ADMIN";
  const isAdminOrMgr = me.role === "ADMIN" || me.role === "MANAGER";
  const sp = await searchParams;
  // Scope to what this user may see — buyerScopeWhere pins market="Dubai"
  // (admin = all Dubai + pool; Dubai agent = own ASSIGNED Dubai buyers).
  const scope = await buyerScopeWhere(me);

  // ── Report drill-down params (additive, opt-in — Lead Source Intake drills) ──
  // ?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD narrow to records IMPORTED (createdAt)
  // within those IST calendar days — istDayRange gives the exact UTC instants, so
  // a report's per-day bucket and this list agree with no off-by-one. ?source= is
  // a verbatim `source` field match. Absent params → `where` stays exactly `scope`
  // (byte-identical query to before). BuyerListClient shows the active drill as a
  // clearable chip (URL-driven, like ?tab / ?repeat).
  const drillAnd: Prisma.BuyerRecordWhereInput[] = [];
  const dateFrom = isValidDateKey(sp.dateFrom) ? sp.dateFrom : null;
  const dateTo = isValidDateKey(sp.dateTo) ? sp.dateTo : null;
  if (dateFrom || dateTo) {
    const r: { gte?: Date; lt?: Date } = {};
    if (dateFrom) r.gte = istDayRange(dateFrom).start;
    if (dateTo) r.lt = istDayRange(dateTo).end; // end-exclusive → covers the whole dateTo IST day
    drillAnd.push({ createdAt: r });
  }
  if (sp.source) drillAnd.push({ source: sp.source });
  const where: Prisma.BuyerRecordWhereInput = drillAnd.length ? { AND: [scope, ...drillAnd] } : scope;

  // Load the scoped set (server-capped) — the client filters / sorts / paginates.
  // Explicit select of ONLY the columns the summary + BuyerRow mapping below read
  // (plus owner id/name) — large text columns (remarks/extraFields/rawImport/emails/
  // coBuyerNames) are never used by the list, so dropping them keeps this 5000-row
  // fetch lean.
  const records = await prisma.buyerRecord.findMany({
    where,
    orderBy: [{ poolStatus: "asc" }, { transactionDate: "desc" }],
    take: 5000,
    select: {
      id: true, buyerKey: true, clientName: true, projectName: true, tower: true,
      unitNumber: true, propertyType: true, configuration: true, transactionValue: true,
      transactionDate: true, nationality: true, source: true, market: true, agentName: true,
      poolStatus: true, businessStatus: true, followupDate: true, attemptCount: true,
      createdAt: true, phones: true, passport: true,
      owner: { select: { id: true, name: true } },
    },
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
  let rejectedCount = 0;
  let totalInvestmentInr = 0;
  let totalInvestmentAed = 0;
  let totalInvestmentOther = 0;
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

  // Filter option lists (distinct, sorted).
  const projects = Array.from(new Set(records.map((r) => (r.projectName ?? "").trim()).filter(Boolean))).sort();
  const propertyTypes = Array.from(new Set(records.map((r) => (r.propertyType ?? "").trim()).filter(Boolean))).sort();
  const nationalities = Array.from(new Set(records.map((r) => (r.nationality ?? "").trim()).filter(Boolean))).sort();
  // Owner/Agent FILTER options — the COMPLETE set, NEVER built from only the visible
  // page or filtered rows. Seed it with every owner that currently holds a record…
  const ownerMap = new Map<string, string>(
    records.filter((r) => r.owner).map((r) => [r.owner!.id, r.owner!.name]),
  );

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
  // …then UNION the full assignable roster so the Agent filter ALWAYS lists every valid
  // agent (Mehak, Dinesh, Lalit, …) — even one with 0 current records — regardless of
  // pagination, active filters, or ownership churn (Lalit 2026-07-07). Deduped by id.
  for (const a of agents) if (!ownerMap.has(a.id)) ownerMap.set(a.id, a.name);
  const owners = Array.from(ownerMap.entries())
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));

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
      {/* ── Header + actions ──────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl sm:text-2xl font-bold">Dubai Buyer Data</h1>
            {process.env.NEXT_PUBLIC_SANDBOX === "1" && <HelpDot topic="buyer-data" />}
          </div>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            {isAdmin ? "Dubai worked pipeline — Admin Pool → agent → convert / reject" : "Dubai buyers assigned to you"} · <span className="font-semibold">{totalRecords}</span> in view ·
            {" "}<span className="text-amber-600 dark:text-amber-400">passport &amp; financial data</span>
          </p>
        </div>
        {canExportData(me) && (
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Link href="/buyer-data/import" className="btn btn-primary" title="Import buyer transaction data">⬆ Import</Link>
            <a href="/api/buyer-data/export" className="btn btn-ghost" title="Export buyer data to CSV">⬇ Export CSV</a>
            <a href="/api/buyer-data/export?format=xlsx" className="btn btn-ghost" title="Export buyer data to Excel">⬇ Excel</a>
          </div>
        )}
      </div>

      {/* ── List experience (summary cards live INSIDE the client so they are
            clickable status filters that reconcile with the visible rows) ──── */}
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
          summary={{
            total: totalRecords,
            uniqueBuyers,
            repeatBuyers,
            pool: poolCount,
            assigned: assignedCount,
            converted: convertedCount,
            rejected: rejectedCount,
            investmentLabel,
          }}
        />
      </div>
    </>
  );
}
