import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { startOfMonth, endOfMonth, subMonths, format } from "date-fns";
import { getTravelRatePerKmInr } from "@/lib/settings";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface Row {
  userId: string;
  name: string;
  team: string | null;
  trips: number;
  km: number;
  amount: number;
}

async function compute(start: Date, end: Date, agentScope: string | null): Promise<Row[]> {
  const acts = await prisma.activity.findMany({
    where: {
      completedAt: { gte: start, lte: end },
      distanceKm: { not: null },
      ...(agentScope ? { userId: agentScope } : {}),
    },
    include: { user: true },
  });
  const map = new Map<string, Row>();
  for (const a of acts) {
    const uid = a.userId ?? "unknown";
    const row = map.get(uid) ?? { userId: uid, name: a.user?.name ?? "Unknown", team: a.user?.team ?? null, trips: 0, km: 0, amount: 0 };
    row.trips++;
    row.km += a.distanceKm ?? 0;
    row.amount += a.reimbursementAmount ?? 0;
    map.set(uid, row);
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export default async function TravelReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const agentScope = me.role === "AGENT" ? me.id : (sp.agent ?? null);

  const now = new Date();
  const thisStart = startOfMonth(now);
  const thisEnd = endOfMonth(now);
  const lastStart = startOfMonth(subMonths(now, 1));
  const lastEnd = endOfMonth(subMonths(now, 1));

  const [thisM, lastM, rate, agents] = await Promise.all([
    compute(thisStart, thisEnd, agentScope),
    compute(lastStart, lastEnd, agentScope),
    getTravelRatePerKmInr(),
    me.role !== "AGENT"
      ? prisma.user.findMany({ where: { active: true, role: { in: ["AGENT", "MANAGER"] } }, orderBy: { name: "asc" } })
      : Promise.resolve([]),
  ]);

  const thisTotal = thisM.reduce((s, r) => s + r.amount, 0);
  const lastTotal = lastM.reduce((s, r) => s + r.amount, 0);

  return (
    <>
      <div>
        {/* Back link added per Lalit feedback 2026-06. */}
        <Link href="/reports" className="text-xs text-gray-500 hover:underline">
          ← Back to reports
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold">🚗 Travel Reimbursement</h1>
        <p className="text-xs sm:text-sm text-gray-500">
          Distance + reimbursement totals per agent. Rate currently: <b>₹{rate}/km</b>
          {me.role === "ADMIN" && <span> · <Link href="/settings" className="underline">change in Settings</Link></span>}
        </p>
      </div>

      {me.role !== "AGENT" && (
        <div className="flex flex-wrap gap-2 items-center">
          <span className="text-xs text-gray-500">Filter by agent:</span>
          <Link href="/reports/travel" className={`chip text-[10px] ${!agentScope ? "chip-warm" : "chip-lost"}`}>All</Link>
          {agents.map((u) => (
            <Link key={u.id} href={`/reports/travel?agent=${u.id}`}
              className={`chip text-[10px] ${agentScope === u.id ? "chip-warm" : "chip-lost"}`}>{u.name}</Link>
          ))}
        </div>
      )}

      {[
        { m: thisM, label: format(now, "MMMM yyyy"), total: thisTotal },
        { m: lastM, label: format(subMonths(now, 1), "MMMM yyyy"), total: lastTotal },
      ].map((blk) => (
        <section key={blk.label}>
          <h2 className="text-base font-bold text-[#0b1a33] mb-2">{blk.label} <span className="text-sm text-gray-500 font-normal">· total ₹{blk.total.toLocaleString("en-IN")}</span></h2>
          <div className="card overflow-x-auto">
            <table className="tbl min-w-[560px]">
              <thead><tr>
                <th>Agent</th><th>Team</th>
                <th className="text-center">Trips</th>
                <th className="text-center">Total km</th>
                <th className="text-center">Reimbursement</th>
              </tr></thead>
              <tbody>
                {blk.m.length === 0 && (
                  <tr><td colSpan={5} className="text-center text-gray-500 py-6 text-sm">No travel logged this month.</td></tr>
                )}
                {blk.m.map((r) => (
                  <tr key={r.userId}>
                    <td className="font-semibold">{r.name}</td>
                    <td><span className={`chip ${r.team === "India" ? "src-csv" : "src-wa"}`}>{r.team ?? "—"}</span></td>
                    <td className="text-center">{r.trips}</td>
                    <td className="text-center">{r.km.toFixed(1)}</td>
                    <td className="text-center font-semibold">₹{r.amount.toLocaleString("en-IN")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
