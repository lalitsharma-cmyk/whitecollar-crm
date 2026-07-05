import Link from "next/link";
import {
  buildBuyerReport,
  buildBuyerSummary,
  type BuyerReportScope,
  type DateRange,
} from "@/lib/buyerPerformance";
import BuyerPerformanceTable from "@/components/BuyerPerformanceTable";
import BuyerSummaryDashboard from "@/components/BuyerSummaryDashboard";
import BuyerConversionFunnel, { aggregateBuyerFunnel } from "@/components/BuyerConversionFunnel";

// ─────────────────────────────────────────────────────────────────────────
// A self-contained BUYER-DATA performance section for ONE market (Dubai | India),
// reused by the Agent Performance report's Buyer / Combined views (Lalit 2026-07-06:
// PARALLEL sections). It builds the buyer report via the EXISTING buyer engine
// (buildBuyerReport / buildBuyerSummary — no reinvention) scoped to the market,
// then renders the pool summary + per-agent buyer table + conversion funnel.
//
// Buyer-appropriate metrics ONLY (assigned / converted / rejected / returns /
// attempts / calls / funnel) — we NEVER invent lead metrics (Fresh / Follow-up)
// for buyers. Market split (Dubai vs India) is the caller's job: it renders one
// section per accessible market so the two markets stay parallel and separate.
// ─────────────────────────────────────────────────────────────────────────

function num(n: number): string {
  return n.toLocaleString("en-IN");
}

export default async function BuyerPerformanceSection({
  market,
  range,
  meId,
  role,
  isAdmin,
}: {
  market: "Dubai" | "India";
  range: DateRange;
  meId: string;
  role: "ADMIN" | "MANAGER" | "AGENT";
  /** ADMIN with no team filter → whole-pool summary (null owner scope). */
  isAdmin: boolean;
}) {
  // scope.team drives the agent roster + every buyer query's market in the engine.
  const scope: BuyerReportScope = { role, meId, team: market };
  const rows = await buildBuyerReport(range, scope);
  const overallFunnel = aggregateBuyerFunnel(rows);

  // Whole-pool summary for admins; in-scope agents' slice otherwise (matches the
  // buyer-performance page's own owner-scoping rule).
  const teamOwnerIds: string[] | null = isAdmin ? null : rows.map((r) => r.agentId);
  const summary = await buildBuyerSummary(teamOwnerIds, market);

  // Deep-link to the full standalone buyer report for this market (keeps the range).
  const marketQ = market === "India" ? "&market=India" : "";
  const fullHref = `/reports/buyer-performance?range=${range.preset}${marketQ}`;
  const flag = market === "India" ? "🇮🇳" : "🇦🇪";
  const totalConverted = rows.reduce((s, m) => s + m.converted, 0);
  const totalAssigned = rows.reduce((s, m) => s + m.buyersAssigned, 0);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-lg font-bold">{flag} {market} Buyer Data</h2>
        <Link href={fullHref} className="text-[11px] text-blue-600 hover:underline">Open full {market} buyer report →</Link>
      </div>
      <p className="text-[11px] text-gray-500 -mt-2">
        Buyer pipeline metrics (assigned · converted · returned · attempts · funnel){market === "India" ? " · ₹" : ""} —
        a separate parallel section from the lead modules. Period: {range.label}. {num(totalAssigned)} assigned · {num(totalConverted)} converted.
      </p>

      <BuyerSummaryDashboard summary={summary} />
      <BuyerPerformanceTable rows={rows} query={`?range=${range.preset}${marketQ}`} />
      <BuyerConversionFunnel stages={overallFunnel} title={`${market} buyer conversion funnel`} />
    </section>
  );
}
