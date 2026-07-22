// ════════════════════════════════════════════════════════════════════════════
// CALL LOGS — compact agent-performance cards (Lalit, 2026-07-22)
//
// A horizontal strip of small colored per-agent cards between the overall KPIs
// and the table. Collapsed: name + Total / Connected / Talk Time / Connect-rate.
// Expanded (native <details>, no JS): every outcome + Avg duration + Unresolved.
//
// URL-DRIVEN like the rest of the page. Every number is a <Link> that pins that
// agent (user=<id>) and, where relevant, the outcome/state — so a click filters
// the KPIs AND the table to exactly what the number counted, preserving all other
// active filters. The whole page re-renders server-side on the click, so the
// cards stay in lock-step with the table with no client fetch layer to drift.
//
// count==records: an agent card's numbers are computed (in kpis.ts) from the SAME
// baseWhere as the table, so clicking "Connected 12" lands on 12 rows.
// ════════════════════════════════════════════════════════════════════════════
import Link from "next/link";
import { CallOutcome } from "@prisma/client";
import { agentColor, formatDuration, type AgentKpi } from "./kpis";

/** Build /call-logs?… with user pinned and (optionally) an outcome or state,
 *  preserving every other active filter. Mirrors the KPI-card link rules:
 *  pinning an outcome clears state (they'd AND to empty), page resets to 1. */
function drill(
  sp: Record<string, string | undefined>,
  userId: string,
  opts?: { outcome?: string; state?: "pending" },
): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (v && k !== "page") q.set(k, v);
  q.set("user", userId);
  if (opts?.outcome) { q.set("outcome", opts.outcome); q.delete("state"); }
  else q.delete("outcome");
  if (opts?.state) { q.set("state", opts.state); q.delete("outcome"); }
  else if (!opts?.outcome) q.delete("state");
  const s = q.toString();
  return `/call-logs${s ? `?${s}` : ""}`;
}

/** One drillable number: label + value, links into the table. */
function Stat({
  href, label, value, tone, strong,
}: { href: string; label: string; value: number | string; tone?: string; strong?: boolean }) {
  return (
    <Link href={href} className="flex items-baseline justify-between gap-2 hover:underline">
      <span className="text-[10px] text-gray-500 dark:text-slate-400">{label}</span>
      <span className={`tabular-nums ${strong ? "font-bold" : "font-semibold"} ${tone ?? "text-slate-800 dark:text-slate-100"}`}>{value}</span>
    </Link>
  );
}

export default function CallLogAgentCards({
  agents,
  sp,
}: {
  agents: AgentKpi[];
  sp: Record<string, string | undefined>;
}) {
  if (agents.length === 0) return null;
  const selected = sp.user ?? "";

  // Detailed outcome rows shown on expand (headline ones live in the collapsed
  // face). Order chosen for at-a-glance scanning, not enum order.
  const DETAIL: { key: CallOutcome; label: string }[] = [
    { key: CallOutcome.BUSY, label: "Busy" },
    { key: CallOutcome.SWITCHED_OFF, label: "Switched Off" },
    { key: CallOutcome.WRONG_NUMBER, label: "Wrong Number" },
    { key: CallOutcome.NOT_INTERESTED, label: "Not Interested" },
    { key: CallOutcome.CALLBACK, label: "Callback" },
    { key: CallOutcome.FAILED, label: "Failed" },
    { key: CallOutcome.CANCELLED, label: "Cancelled" },
    { key: CallOutcome.MISSED, label: "Missed" },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
          Agent performance
        </h2>
        {selected && (
          <Link href={drill(sp, "").replace(/([?&])user=[^&]*(&|$)/, "$1").replace(/[?&]$/, "")}
            className="text-[11px] text-blue-600 dark:text-blue-400 hover:underline">
            Clear agent filter
          </Link>
        )}
      </div>

      {/* Horizontal scroll row on desktop/tablet; each card fixed-width so the row
          stays compact and swipes on mobile. */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
        {agents.map((a) => {
          const c = agentColor(a.userId);
          const k = a.kpis;
          const isSel = selected === a.userId;
          const dim = selected && !isSel;
          const o = k.byOutcome;
          return (
            <div
              key={a.userId}
              className={`snap-start shrink-0 w-[190px] rounded-lg border overflow-hidden transition ${
                isSel
                  ? `border-transparent ring-2 ${c.ring} ${c.tint}`
                  : "border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900"
              } ${dim ? "opacity-55 hover:opacity-100" : ""}`}
            >
              {/* Colour bar = the agent's stable identity colour */}
              <div className={`h-1 ${c.bar}`} />
              <div className="p-2.5 space-y-1.5">
                <Link href={drill(sp, a.userId)} className="block">
                  <div className={`text-sm font-bold truncate ${c.text}`} title={a.name}>{a.name}</div>
                  {a.team && <div className="text-[10px] text-gray-400 dark:text-slate-500">{a.team}</div>}
                </Link>

                {/* Collapsed headline metrics — each drillable */}
                <div className="space-y-0.5">
                  <Stat href={drill(sp, a.userId)} label="Total Calls" value={k.total} strong tone={c.text} />
                  <Stat href={drill(sp, a.userId, { outcome: CallOutcome.CONNECTED })} label="Connected" value={o[CallOutcome.CONNECTED]} tone="text-emerald-600 dark:text-emerald-400" />
                  <Stat href={drill(sp, a.userId, { outcome: CallOutcome.NOT_PICKED })} label="Not Picked" value={o[CallOutcome.NOT_PICKED]} tone="text-amber-600 dark:text-amber-400" />
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10px] text-gray-500 dark:text-slate-400">Talk Time</span>
                    <span className="tabular-nums font-semibold text-slate-800 dark:text-slate-100">{formatDuration(k.talkTimeSec)}</span>
                  </div>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[10px] text-gray-500 dark:text-slate-400">Connect Rate</span>
                    <span className="tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">{k.connectionRate}%</span>
                  </div>
                </div>

                {/* Expanded detail — native, no JS. Reads compact when closed. */}
                <details className="group">
                  <summary className="cursor-pointer text-[10px] text-gray-400 dark:text-slate-500 hover:text-gray-600 dark:hover:text-slate-300 list-none flex items-center gap-1">
                    <span className="group-open:hidden">▸ more</span>
                    <span className="hidden group-open:inline">▾ less</span>
                  </summary>
                  <div className="mt-1 pt-1 border-t border-gray-100 dark:border-slate-800 space-y-0.5">
                    {DETAIL.map((d) => (
                      <Stat key={d.key} href={drill(sp, a.userId, { outcome: d.key })} label={d.label} value={o[d.key]} />
                    ))}
                    <Stat href={drill(sp, a.userId, { state: "pending" })} label="Unresolved" value={k.pending} tone="text-violet-600 dark:text-violet-400" />
                    <div className="flex items-baseline justify-between gap-2 pt-0.5">
                      <span className="text-[10px] text-gray-500 dark:text-slate-400">Avg Duration</span>
                      <span className="tabular-nums font-semibold text-slate-800 dark:text-slate-100">{formatDuration(k.avgDurationSec)}</span>
                    </div>
                  </div>
                </details>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
