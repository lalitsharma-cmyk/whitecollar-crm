// Shared "status-module" view (Sale Off / Lease Off, Lalit 2026-07-02). Renders the
// leads in a given TERMINAL status-set as a standalone module — these clients are the
// seller / re-sale / rental inventory, hidden from the working /leads view. Role/geo
// scoped via leadScopeWhere (ADMIN all · MANAGER team · AGENT own), India/UAE market
// tabs (admin/manager). Read-only list; clicking a row opens the lead. Adding a status
// to SALE_OFF_STATUSES / LEASE_OFF_STATUSES auto-expands the module (single source).

import { prisma } from "@/lib/prisma";
import { leadScopeWhere } from "@/lib/leadScope";
import { leadFilterWhere } from "@/lib/leadFilterWhere";
import { displayBudget } from "@/lib/budgetParse";
import { statusColor } from "@/lib/lead-statuses";
import Link from "next/link";

type Me = Parameters<typeof leadScopeWhere>[0] & { role: string };
type SP = Record<string, string | undefined>;

export default async function StatusModuleView({
  me, sp, statusSet, label, icon, moduleKey, emptyHint,
}: {
  me: Me; sp: SP; statusSet: string[]; label: string; icon: string; moduleKey: string; emptyHint: string;
}) {
  const scope = await leadScopeWhere(me);
  const isAdminOrMgr = me.role === "ADMIN" || me.role === "MANAGER";
  const marketFilter = (sp.market ?? "all").toLowerCase();
  const marketAnd = sp.market ? leadFilterWhere({ market: sp.market }) : [];
  const searchAnd = sp.q ? leadFilterWhere({ q: sp.q }) : [];

  const base = { ...scope, currentStatus: { in: statusSet } };
  const where = { ...base, AND: [...marketAnd, ...searchAnd] };

  const [rows, total, indiaCount, uaeCount] = await Promise.all([
    prisma.lead.findMany({
      where, orderBy: [{ lastTouchedAt: "desc" }], take: 300,
      select: {
        id: true, name: true, currentStatus: true, forwardedTeam: true, market: true,
        budgetRaw: true, budgetMin: true, budgetMax: true, budgetCurrency: true,
        sourceDetail: true, city: true, owner: { select: { name: true } },
      },
    }),
    prisma.lead.count({ where: base }),
    prisma.lead.count({ where: { ...base, AND: leadFilterWhere({ market: "india" }) } }),
    prisma.lead.count({ where: { ...base, AND: leadFilterWhere({ market: "uae" }) } }),
  ]);

  const params = () => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) if (v != null && v !== "" && k !== "page") p.set(k, String(v));
    return p;
  };
  const mHref = (m: string | null) => {
    const p = params(); if (m) p.set("market", m); else p.delete("market");
    const qs = p.toString(); return qs ? `/${moduleKey}?${qs}` : `/${moduleKey}`;
  };
  const seg = "px-3 py-1.5 rounded-full text-xs font-semibold border min-h-9 inline-flex items-center gap-1";
  const on = "bg-[#0b1a33] text-white border-[#0b1a33] dark:bg-blue-700 dark:border-blue-700";
  const off = "bg-white dark:bg-slate-700 border-[#e5e7eb] dark:border-slate-600 text-gray-700 dark:text-slate-100 hover:bg-gray-50";

  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">{icon} {label}</h1>
        <p className="text-xs sm:text-sm text-gray-500">
          {total} record{total === 1 ? "" : "s"} · these clients want to {moduleKey === "lease-off" ? "lease/rent out" : "sell"} — your seller inventory
          {marketFilter !== "all" && <span className="ml-1">· {marketFilter === "india" ? "India" : "Dubai/UAE"}</span>}
        </p>
      </div>

      {isAdminOrMgr && (
        <div className="flex gap-2">
          <Link href={mHref(null)} className={`${seg} ${marketFilter === "all" ? on : off}`}>All <span className="opacity-70">{total}</span></Link>
          <Link href={mHref("india")} className={`${seg} ${marketFilter === "india" ? on : off}`}>🇮🇳 India <span className="opacity-70">{indiaCount}</span></Link>
          <Link href={mHref("dubai")} className={`${seg} ${marketFilter === "dubai" ? on : off}`}>🇦🇪 Dubai <span className="opacity-70">{uaeCount}</span></Link>
        </div>
      )}

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 border-b">
              <th className="text-left py-2.5 px-3">Client</th>
              <th className="text-left px-2">Status</th>
              <th className="text-left px-2">Market</th>
              <th className="text-left px-2">Property</th>
              <th className="text-right px-2">Value</th>
              <th className="text-left px-2">Owner</th>
              <th className="px-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e5e7eb]">
            {rows.length === 0 ? (
              <tr><td colSpan={7} className="py-8 text-center text-gray-500">{emptyHint}</td></tr>
            ) : rows.map((l) => (
              <tr key={l.id} className="hover:bg-gray-50">
                <td className="py-2.5 px-3 font-medium">{l.name ?? "—"}{l.city && <span className="ml-1.5 text-[10px] text-gray-400">{l.city}</span>}</td>
                <td className="px-2"><span className={`text-[10px] px-1.5 py-0.5 rounded ${statusColor(l.currentStatus)}`}>{l.currentStatus ?? "—"}</span></td>
                <td className="px-2 text-xs text-gray-600">{l.market ?? l.forwardedTeam ?? "—"}</td>
                <td className="px-2 text-xs text-gray-700 max-w-[220px] truncate" title={l.sourceDetail ?? ""}>{l.sourceDetail ?? "—"}</td>
                <td className="px-2 text-right tabular-nums">{displayBudget(l)}</td>
                <td className="px-2 text-xs text-gray-600">{l.owner?.name ?? "Unassigned"}</td>
                <td className="px-3 text-right"><Link href={`/leads/${l.id}`} className="text-[11px] text-blue-600 hover:underline">Open →</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
