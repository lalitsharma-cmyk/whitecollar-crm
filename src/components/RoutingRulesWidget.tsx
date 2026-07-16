import "server-only";
// RoutingRulesWidget — small, self-contained admin dashboard card for the Lead
// Routing Scheduler. SERVER component: does its own reads, renders null for
// non-admins, and shows the loud red state while routing is paused.
//
// Mount (main session wires it): pass the signed-in viewer's role —
//   {me.role === "ADMIN" && <RoutingRulesWidget viewerRole={me.role} />}
// (The role prop is also enforced here, so an unconditional mount is safe too.)

import Link from "next/link";
import { prisma } from "@/lib/prisma";
import {
  isRoutingPaused,
  computeRuleStatus,
  ROUTING_REASON_PREFIX,
} from "@/lib/leadRouting";
import { istDayRange, fmtISTDate } from "@/lib/datetime";

function windowShort(startsAt: Date, endsAt: Date | null): string {
  if (!endsAt) return `from ${fmtISTDate(startsAt)} · permanent`;
  const lastDay = new Date(endsAt.getTime() - 1);
  const a = fmtISTDate(startsAt);
  const b = fmtISTDate(lastDay);
  return a === b ? a : `${a} – ${b}`;
}

export default async function RoutingRulesWidget({ viewerRole }: { viewerRole?: string | null }) {
  if (viewerRole !== "ADMIN") return null; // admins only — renders nothing for anyone else

  const now = new Date();
  const liveWhere = {
    active: true,
    disabledAt: null,
    startsAt: { lte: now },
    OR: [{ endsAt: null }, { endsAt: { gt: now } }],
  }; // NOTE: no `as const` — Prisma where-inputs need mutable arrays
  const [paused, candidateRules, activeCount, assignedToday] = await Promise.all([
    isRoutingPaused(),
    prisma.routingRule.findMany({
      where: liveWhere,
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
      select: {
        id: true, name: true, active: true, priority: true,
        startsAt: true, endsAt: true, disabledAt: true, assignedCount: true,
      },
      take: 6,
    }),
    prisma.routingRule.count({ where: liveWhere }),
    // Every rule-applied assignment stamps a "Rule: …" reason on its Assignment
    // row, so "assigned by rule today (IST)" is a single indexed count.
    prisma.assignment.count({
      where: {
        assignedAt: { gte: istDayRange().start },
        reason: { startsWith: ROUTING_REASON_PREFIX },
      },
    }),
  ]);

  const active = candidateRules.filter((r) => computeRuleStatus(r, { now }) === "Active");

  // ── PAUSED: loud red state ──
  if (paused) {
    return (
      <div className="card p-4 border-l-4 border-rose-600 bg-rose-50 dark:bg-rose-950/40">
        <div className="flex items-center justify-between gap-2">
          <div className="font-bold text-sm text-rose-800 dark:text-rose-200">⏸ Routing PAUSED</div>
          <Link href="/admin/routing-rules" className="text-xs font-semibold text-rose-700 dark:text-rose-300 underline whitespace-nowrap">
            Manage →
          </Link>
        </div>
        <p className="text-xs text-rose-700 dark:text-rose-300 mt-1">
          Automatic assignment is stopped — every new lead stays <b>unassigned</b> until distributed manually.
          Resume from the Routing Scheduler.
        </p>
      </div>
    );
  }

  return (
    <div className="card p-4 border-l-4 border-[#c9a24b]">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold text-sm flex items-center gap-1.5">
          🚦 Lead Routing
          <span className={`text-[11px] px-1.5 py-0.5 rounded-full border ${activeCount > 0 ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-gray-100 text-gray-500 border-gray-300"}`}>
            {activeCount} active rule{activeCount === 1 ? "" : "s"}
          </span>
        </div>
        <Link href="/admin/routing-rules" className="text-xs font-semibold text-[#0b1a33] dark:text-blue-300 underline whitespace-nowrap">
          Manage →
        </Link>
      </div>

      {active.length === 0 ? (
        <p className="text-xs text-gray-500 dark:text-slate-400 mt-1.5">
          No rules live right now — new leads follow the default assignment
          (Dubai → Lalit · Tue-IST India → Yasir · else Tanuj).
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {active.slice(0, 4).map((r) => (
            <li key={r.id} className="text-xs flex items-baseline justify-between gap-2">
              <span className="font-semibold truncate">{r.name}</span>
              <span className="text-gray-400 dark:text-slate-500 whitespace-nowrap">{windowShort(r.startsAt, r.endsAt)}</span>
            </li>
          ))}
          {activeCount > 4 && (
            <li className="text-[11px] text-gray-400">+{activeCount - 4} more…</li>
          )}
        </ul>
      )}

      <div className="mt-2 pt-2 border-t border-gray-100 dark:border-slate-700 text-[11px] text-gray-500 dark:text-slate-400">
        <b className="text-gray-700 dark:text-slate-200">{assignedToday}</b> lead{assignedToday === 1 ? "" : "s"} assigned by rules today (IST)
      </div>
    </div>
  );
}
