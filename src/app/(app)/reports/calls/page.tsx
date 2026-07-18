// ☎️ Call Report — the ONE central calling report over CallLog (lead-linked AND
// buyer-linked rows). Every number opens the exact records on /call-logs.
//
// count == records, by construction: see ./calls.ts, which byte-mirrors the
// /call-logs role scope, live envelope and filter parsing. Cells that CANNOT be
// exact (no list param exists for the dimension) render with a dotted underline
// and say so in their tooltip — an honest superset, never a fake filter.
//
// Permissions mirror /call-logs (calls are scoped by the ACTOR):
//   ADMIN   → all calls, agent + team pickers
//   MANAGER → their team's calls, agent picker only (team is locked server-side)
//   AGENT   → only their OWN calls, no pickers, no source table (the /leads +
//             lead-intake source-privacy gate)
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import {
  buildCallReport,
  resolveCallParams,
  reportHref,
  type Cell,
  type DimRow,
  type Grain,
} from "./calls";
import { ACTIVITY_SOURCE_MODULES } from "@/lib/moduleSource";

export const dynamic = "force-dynamic";

// ── Render helpers ───────────────────────────────────────────────────────────

/** A clickable number. Exact → plain link. Superset → dotted underline + title. */
function Num({ cell, strong, tone }: { cell: Cell; strong?: boolean; tone?: string }) {
  const cls = [
    "tabular-nums hover:underline",
    strong ? "font-semibold" : "",
    tone ?? "text-sky-700 dark:text-sky-400",
    cell.exact ? "" : "decoration-dotted underline underline-offset-2 decoration-gray-400",
  ].join(" ");
  return (
    <Link
      href={cell.href}
      className={cls}
      title={cell.exact ? "Open exactly these calls" : `Approximate drill — ${cell.note}`}
    >
      {cell.n.toLocaleString()}
      {!cell.exact && <span className="text-gray-400 dark:text-slate-500 text-[9px] align-super ml-0.5">≈</span>}
    </Link>
  );
}

function ChipRow({ parts }: { parts: NonNullable<Cell["parts"]> }) {
  if (!parts.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {parts.map((pt) => (
        <Link
          key={pt.label}
          href={pt.href}
          className="inline-flex items-center gap-1 rounded bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-gray-700 dark:text-slate-200 hover:bg-sky-100 dark:hover:bg-slate-600"
          title="Open exactly these calls"
        >
          {pt.label} <span className="tabular-nums font-semibold">{pt.n.toLocaleString()}</span>
        </Link>
      ))}
    </div>
  );
}

function SummaryCard({ title, cell, tone, sub }: { title: string; cell: Cell; tone: string; sub?: string }) {
  return (
    <div className={`card p-4 border-l-4 ${tone}`}>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">{title}</div>
      <div className="text-2xl font-bold mt-1 text-gray-900 dark:text-slate-100">
        <Num cell={cell} strong tone="text-gray-900 dark:text-slate-100" />
      </div>
      {cell.parts && <ChipRow parts={cell.parts} />}
      {sub && <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">{sub}</div>}
    </div>
  );
}

/** The shared Calls / Connected / Unsuccessful / Connect-% table body. */
function DimTable({
  title, rows, colLabel, note, max,
}: { title: string; rows: DimRow[]; colLabel: string; note?: string; max?: number }) {
  const shown = max ? rows.slice(0, max) : rows;
  return (
    <div className="card p-5">
      <div className="flex items-baseline justify-between mb-2 gap-2">
        <h2 className="font-bold text-base text-gray-900 dark:text-slate-100">{title}</h2>
        {note && <span className="text-[10px] text-gray-400 dark:text-slate-500 text-right">{note}</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[460px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
              <th className="py-2 pr-3">{colLabel}</th>
              <th className="py-2 pr-3">Calls</th>
              <th className="py-2 pr-3">Connected</th>
              <th className="py-2 pr-3">Unsuccessful</th>
              <th className="py-2 pr-3">Connect %</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={5} className="py-4 text-center text-gray-400 dark:text-slate-500 text-xs">No calls in this range.</td></tr>
            )}
            {shown.map((row) => (
              <tr key={row.key} className="border-b border-gray-100 dark:border-slate-800 align-top">
                <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">{row.label}</td>
                <td className="py-2 pr-3"><Num cell={row.count} strong /></td>
                <td className="py-2 pr-3"><Num cell={row.connected} tone="text-emerald-700 dark:text-emerald-400" /></td>
                <td className="py-2 pr-3"><Num cell={row.unsuccessful} tone="text-rose-700 dark:text-rose-400" /></td>
                <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-slate-300">
                  {row.connectPct == null ? "—" : `${row.connectPct.toFixed(1)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {max && rows.length > max && (
        <div className="mt-2 text-[10px] text-gray-400 dark:text-slate-500">
          Showing the top {max} of {rows.length} — the remainder is in the totals above.
        </div>
      )}
    </div>
  );
}

const GRAIN_TABS: { id: Grain; label: string }[] = [
  { id: "daily", label: "Daily" },
  { id: "weekly", label: "Weekly" },
  { id: "monthly", label: "Monthly" },
  { id: "yearly", label: "Yearly" },
  { id: "custom", label: "Custom" },
];

export default async function CallReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireUser();
  const sp = await searchParams;
  const params = await resolveCallParams(sp, me);
  const r = await buildCallReport(me, params);

  const { grain, bucketGrain, fromKey, toKey, user, team, module, outcome, state, canSeeSource, showScopePickers, showTeamPicker } = params;
  const isAgent = me.role === "AGENT";

  // `state` rides every self-link so an explicitly-requested inspection mode
  // (?state=pending — the unresolved-dial view) survives a grain/filter change
  // instead of silently snapping back to the resolved default and showing
  // different numbers under the same heading.
  const grainHref = (g: Grain) =>
    // Grain tabs reset the range so the tab's own default window applies —
    // except Custom, which keeps the dates you're looking at.
    g === "custom"
      ? reportHref({ grain: "custom", from: fromKey, to: toKey, user, team, module, outcome, state })
      : reportHref({ grain: g, user, team, module, outcome, state });

  const clearHref = (drop: "user" | "team" | "module" | "outcome" | "state") =>
    reportHref({
      grain, from: fromKey, to: toKey,
      user: drop === "user" ? "" : user,
      team: drop === "team" ? "" : team,
      module: drop === "module" ? "" : module,
      outcome: drop === "outcome" ? "" : outcome,
      state: drop === "state" ? "" : state,
    });

  const agentName = r.userRoster.find((u) => u.id === user)?.name ?? user;

  // Chart geometry (server-rendered SVG — every bar is a drill link).
  const bars = r.byBucket;
  const CH = 190, padT = 18, padB = 36, barW = 30, gap = 12, padL = 10;
  const chartW = padL * 2 + Math.max(bars.length, 1) * (barW + gap);
  const innerH = CH - padT - padB;
  const labelEvery = Math.max(1, Math.ceil(bars.length / 16));

  const scopeLabel =
    isAgent ? "your calls" : me.role === "MANAGER" ? "your team's calls" : "all modules & teams";

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-slate-100">☎️ Call Report</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            Every call across Leads, Revival and Buyer Data — by agent, team, module, source, project, date and outcome.
            Every number opens the exact calls. {r.rangeLabel} · {scopeLabel}
          </p>
        </div>
        <Link href="/reports" className="text-[11px] text-gray-500 dark:text-slate-400 hover:underline">
          ← All reports
        </Link>
      </div>

      {/* ── Grain tabs ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-1.5">
        {GRAIN_TABS.map((t) => (
          <Link
            key={t.id}
            href={grainHref(t.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium ${
              grain === t.id
                ? "bg-[#0b1a33] text-white dark:bg-[#c9a24b] dark:text-[#0b1a33]"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            }`}
          >
            {t.label}
          </Link>
        ))}
        {grain !== bucketGrain && grain !== "custom" && (
          <span className="self-center text-[10px] text-gray-400 dark:text-slate-500">bucketed {bucketGrain} by span</span>
        )}
        {grain === "custom" && (
          <span className="self-center text-[10px] text-gray-400 dark:text-slate-500">bucketed {bucketGrain} by span</span>
        )}
      </div>

      {/* ── Filters (plain GET form — server-component friendly) ───────────── */}
      <form method="get" action="/reports/calls" className="card p-3 flex flex-wrap items-end gap-3">
        <label className="text-[11px] text-gray-500 dark:text-slate-400 flex flex-col gap-1">
          Grain
          <select name="grain" defaultValue={grain} className="rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 text-xs px-2 py-1.5">
            {GRAIN_TABS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-gray-500 dark:text-slate-400 flex flex-col gap-1">
          From
          <input type="date" name="from" defaultValue={fromKey} className="rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 text-xs px-2 py-1" />
        </label>
        <label className="text-[11px] text-gray-500 dark:text-slate-400 flex flex-col gap-1">
          To
          <input type="date" name="to" defaultValue={toKey} className="rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 text-xs px-2 py-1" />
        </label>
        {showTeamPicker ? (
          <label className="text-[11px] text-gray-500 dark:text-slate-400 flex flex-col gap-1">
            Team
            <select name="team" defaultValue={team} className="rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 text-xs px-2 py-1.5">
              <option value="">All teams</option>
              <option value="Dubai">Dubai</option>
              <option value="India">India</option>
            </select>
          </label>
        ) : me.role === "MANAGER" && team ? (
          <div className="text-[11px] text-gray-500 dark:text-slate-400 flex flex-col gap-1">
            Team
            <span className="px-2 py-1.5 rounded bg-gray-100 dark:bg-slate-700 text-xs text-gray-700 dark:text-slate-200">{team} (your team)</span>
          </div>
        ) : null}
        {showScopePickers && (
          <label className="text-[11px] text-gray-500 dark:text-slate-400 flex flex-col gap-1">
            Agent
            <select name="user" defaultValue={user} className="rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 text-xs px-2 py-1.5 max-w-[180px]">
              <option value="">All agents</option>
              {r.userRoster.map((u) => (
                <option key={u.id} value={u.id}>{u.name}{u.team ? ` · ${u.team}` : ""}</option>
              ))}
            </select>
          </label>
        )}
        <label className="text-[11px] text-gray-500 dark:text-slate-400 flex flex-col gap-1">
          Module
          <select name="module" defaultValue={module} className="rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 text-xs px-2 py-1.5">
            <option value="">All modules</option>
            {ACTIVITY_SOURCE_MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-gray-500 dark:text-slate-400 flex flex-col gap-1">
          Call status
          <select name="outcome" defaultValue={outcome} className="rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 text-xs px-2 py-1.5">
            <option value="">All outcomes</option>
            {r.outcomeOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </label>
        <button type="submit" className="px-3 py-1.5 rounded-lg bg-[#0b1a33] text-white dark:bg-[#c9a24b] dark:text-[#0b1a33] text-xs font-semibold">
          Apply
        </button>
      </form>

      {/* ── Active-filter chips ────────────────────────────────────────────── */}
      {(user || (team && showTeamPicker) || module || outcome || state === "pending") && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-gray-400 dark:text-slate-500">Active filters:</span>
          {user && (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 px-2 py-0.5">
              Agent: {agentName}
              <Link href={clearHref("user")} className="hover:text-indigo-900">✕</Link>
            </span>
          )}
          {team && showTeamPicker && (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 dark:bg-sky-950/40 border border-sky-200 dark:border-sky-800 text-sky-700 dark:text-sky-300 px-2 py-0.5">
              Team: {team}
              <Link href={clearHref("team")} className="hover:text-sky-900">✕</Link>
            </span>
          )}
          {module && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 px-2 py-0.5">
              Module: {module}
              <Link href={clearHref("module")} className="hover:text-emerald-900">✕</Link>
            </span>
          )}
          {outcome && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 px-2 py-0.5">
              Call status: {r.outcomeOptions.find((o) => o.key === outcome)?.label ?? outcome}
              <Link href={clearHref("outcome")} className="hover:text-amber-900">✕</Link>
            </span>
          )}
          {/* Only the non-default stance is chipped — "resolved" is what the
              report always means, so chipping it would be permanent noise. */}
          {state === "pending" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 dark:bg-violet-950/40 border border-dashed border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 px-2 py-0.5">
              Unresolved dials only
              <Link href={clearHref("state")} className="hover:text-violet-900">✕</Link>
            </span>
          )}
        </div>
      )}

      {/* ── Summary cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard
          title={state === "pending" ? "Total unresolved dials" : "Total calls"}
          cell={r.total}
          tone="border-sky-500"
          sub={`${r.rangeLabel}${state === "resolved" ? " · resolved calls only" : state === "pending" ? " · unresolved dials only" : ""}`}
        />
        <SummaryCard title="Connected" cell={r.connected} tone="border-emerald-500" sub="a human answered" />
        <SummaryCard title="Unsuccessful" cell={r.unsuccessful} tone="border-rose-500" sub="not picked · busy · switched off · wrong number" />
        {/* UNRESOLVED DIALS — deliberately its own card, OUTSIDE Total calls and
            outside connected/unsuccessful. A dial written on tap that never came
            back with a result is not a call and must not move any call metric —
            but it must not vanish either, so it is reported here and drills to
            /call-logs?state=pending. 0 until dial-on-tap ships. */}
        <SummaryCard
          title="Dial attempts (unresolved)"
          cell={r.pendingDials}
          tone="border-violet-500"
          sub="tapped Call, no result yet · not counted as calls"
        />
        <div className="card p-4 border-l-4 border-indigo-500">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">Connect rate</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-gray-900 dark:text-slate-100">
            {r.connectRate == null ? "—" : `${r.connectRate.toFixed(1)}%`}
          </div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">connected ÷ (connected + unsuccessful)</div>
        </div>
        <div className="card p-4 border-l-4 border-slate-400">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">Records called</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-gray-900 dark:text-slate-100">
            {r.recordsTouched.toLocaleString()}
          </div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
            distinct leads + buyers · {r.recordsTouched ? (r.total.n / r.recordsTouched).toFixed(1) : "—"} calls each
          </div>
        </div>
      </div>
      {r.unclassifiedOutcome && (
        <div className="-mt-2 text-[11px] text-gray-500 dark:text-slate-400 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 px-2 py-0.5 font-medium text-slate-600 dark:text-slate-300">
            Unclassified outcome: <span className="tabular-nums ml-1">{r.unclassifiedOutcome.n}</span>
          </span>
          {r.unclassifiedOutcome.parts && <ChipRow parts={r.unclassifiedOutcome.parts} />}
          <span>— in Total, in NEITHER connected nor unsuccessful.</span>
        </div>
      )}

      {/* ── Trend chart ────────────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="font-bold text-base text-gray-900 dark:text-slate-100">
            Calls per {bucketGrain === "daily" ? "day" : bucketGrain === "weekly" ? "week" : bucketGrain === "monthly" ? "month" : "year"} (IST)
          </h2>
          <span className="text-[10px] text-gray-400 dark:text-slate-500">green = connected · click a bar to open that period&rsquo;s calls</span>
        </div>
        <div className="overflow-x-auto">
          <svg viewBox={`0 0 ${chartW} ${CH}`} width={chartW} height={CH} role="img" aria-label="Calls per period" className="text-gray-500 dark:text-slate-400">
            <line x1={padL} y1={CH - padB} x2={chartW - padL} y2={CH - padB} stroke="currentColor" strokeOpacity="0.35" />
            {bars.map((b, i) => {
              const h = Math.round((b.count.n / r.chartMax) * (innerH - 4));
              const hc = Math.round((b.connected / r.chartMax) * (innerH - 4));
              const x = padL + i * (barW + gap);
              const y = CH - padB - h;
              return (
                <Link key={b.bucket.key} href={b.count.href}>
                  <g className="cursor-pointer">
                    <title>{`${b.bucket.label} — ${b.count.n} calls (${b.connected} connected, ${b.unsuccessful} unsuccessful)`}</title>
                    <rect x={x} y={padT} width={barW} height={CH - padB - padT} fill="transparent" />
                    <rect x={x} y={y} width={barW} height={Math.max(h, b.count.n > 0 ? 2 : 0)} rx="3" fill="#64748b" fillOpacity="0.8" />
                    <rect x={x} y={CH - padB - hc} width={barW} height={hc} rx="3" fill="#10b981" fillOpacity="0.9" />
                    {bars.length <= 40 && b.count.n > 0 && (
                      <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize="9" fill="currentColor">{b.count.n}</text>
                    )}
                    {i % labelEvery === 0 && (
                      <text x={x + barW / 2} y={CH - padB + 12} textAnchor="middle" fontSize="8.5" fill="currentColor">
                        {b.bucket.label.length > 12 ? b.bucket.label.slice(0, 12) : b.bucket.label}
                      </text>
                    )}
                  </g>
                </Link>
              );
            })}
          </svg>
        </div>
      </div>

      {/* ── Connected vs Unsuccessful (per-outcome, each exact) ────────────── */}
      <div className="card p-5">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="font-bold text-base text-gray-900 dark:text-slate-100">Connected vs unsuccessful</h2>
          <span className="text-[10px] text-gray-400 dark:text-slate-500">
            connected set = the SAME outcomes the ghosting / revival auto-return engines count as a real conversation
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                <th className="py-2 pr-3">Call status</th>
                <th className="py-2 pr-3">Group</th>
                <th className="py-2 pr-3">Calls</th>
                <th className="py-2 pr-3">% of total</th>
              </tr>
            </thead>
            <tbody>
              {r.byOutcome.map((o) => (
                <tr key={o.key} className="border-b border-gray-100 dark:border-slate-800">
                  <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">{o.label}</td>
                  <td className="py-2 pr-3">
                    <span className={`chip ${
                      o.group === "connected" ? "bg-emerald-100 text-emerald-800"
                        : o.group === "unsuccessful" ? "bg-rose-100 text-rose-800"
                        : o.group === "pending" ? "bg-violet-100 text-violet-800 border border-dashed border-violet-400"
                        : "bg-slate-100 text-slate-700"
                    }`}>
                      {o.group === "connected" ? "Connected"
                        : o.group === "unsuccessful" ? "Unsuccessful"
                        : o.group === "pending" ? "Unresolved dial"
                        : "Unclassified"}
                    </span>
                  </td>
                  <td className="py-2 pr-3"><Num cell={o.count} strong /></td>
                  <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-slate-300">{o.pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Agent + Team ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <DimTable
          title="Calls by agent"
          rows={r.byAgent}
          colLabel="Agent"
          note="the actor who made/took the call · imported rows use their attributed name"
        />
        <DimTable
          title="Calls by team"
          rows={r.byTeam}
          colLabel="Team"
          note="the ACTOR's team — not the lead's"
        />
      </div>

      {/* ── Module ─────────────────────────────────────────────────────────── */}
      <DimTable
        title="Calls by module"
        rows={r.byModule}
        colLabel="Module"
        note="the working surface the call came from · never Master Data (agents have no Master Data calling UI)"
      />

      {/* ── Date-wise ──────────────────────────────────────────────────────── */}
      <div className="card p-5">
        <h2 className="font-bold text-base text-gray-900 dark:text-slate-100 mb-2">
          {bucketGrain === "daily" ? "Date" : bucketGrain === "weekly" ? "Week (Mon–Sun, IST)" : bucketGrain === "monthly" ? "Month" : "Year"}-wise calls
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[460px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                <th className="py-2 pr-3">{bucketGrain === "daily" ? "Day" : bucketGrain === "weekly" ? "Week" : bucketGrain === "monthly" ? "Month" : "Year"}</th>
                <th className="py-2 pr-3">Calls</th>
                <th className="py-2 pr-3">Connected</th>
                <th className="py-2 pr-3">Unsuccessful</th>
                <th className="py-2 pr-3">% of total</th>
              </tr>
            </thead>
            <tbody>
              {r.byBucket.map((b) => (
                <tr key={b.bucket.key} className="border-b border-gray-100 dark:border-slate-800">
                  <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">{b.bucket.label}</td>
                  <td className="py-2 pr-3"><Num cell={b.count} strong /></td>
                  <td className="py-2 pr-3 tabular-nums text-emerald-700 dark:text-emerald-400">{b.connected.toLocaleString()}</td>
                  <td className="py-2 pr-3 tabular-nums text-rose-700 dark:text-rose-400">{b.unsuccessful.toLocaleString()}</td>
                  <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-slate-300">{b.pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Source + Project ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        {canSeeSource && (
          <DimTable
            title="Calls by source"
            rows={r.bySource}
            colLabel="Source"
            max={25}
            note="verbatim source of the linked record · ≈ = /call-logs has no ?source= filter yet"
          />
        )}
        <DimTable
          title="Calls by project"
          rows={r.byProject}
          colLabel="Project"
          max={25}
          note="lead sourceDetail / buyer projectName · ≈ = /call-logs has no ?project= filter yet"
        />
      </div>

      {/* ── Attempt-wise ───────────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-baseline justify-between mb-2 gap-2">
          <h2 className="font-bold text-base text-gray-900 dark:text-slate-100">Attempt-wise (calls per record)</h2>
          <span className="text-[10px] text-gray-400 dark:text-slate-500 text-right">
            how many records sit at 1, 2, 3 … calls in this range
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                <th className="py-2 pr-3">Attempts</th>
                <th className="py-2 pr-3">Records</th>
                <th className="py-2 pr-3">Calls</th>
                <th className="py-2 pr-3">% of records</th>
              </tr>
            </thead>
            <tbody>
              {r.attemptRows.length === 0 && (
                <tr><td colSpan={4} className="py-4 text-center text-gray-400 dark:text-slate-500 text-xs">No calls in this range.</td></tr>
              )}
              {r.attemptRows.map((a) => (
                <tr key={a.label} className="border-b border-gray-100 dark:border-slate-800">
                  <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">{a.label}</td>
                  <td className="py-2 pr-3 tabular-nums font-semibold text-gray-900 dark:text-slate-100">{a.records.toLocaleString()}</td>
                  <td className="py-2 pr-3"><Num cell={a.calls} /></td>
                  <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-slate-300">
                    {r.recordsTouched ? ((a.records / r.recordsTouched) * 100).toFixed(1) : "0.0"}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-2 text-[10px] text-gray-400 dark:text-slate-500">
          METHOD: calls counted per linked record (lead or buyer) <em>within the selected filters</em> — so &ldquo;3 calls&rdquo; means
          3 calls in this range, and the Calls column sums to the headline total. This is deliberately NOT{" "}
          <code>Lead.attemptCount</code>, which is owner-specific, resets on transfer, and has no buyer equivalent — it answers
          &ldquo;attempts by the current owner&rdquo;, a different question. For that view use the Ghosting and Revival Attempt Cycles reports.
        </div>
      </div>

      {/* ── Drill-accuracy legend + notes ──────────────────────────────────── */}
      <div className="card p-4 text-[11px] text-gray-500 dark:text-slate-400 space-y-1">
        <div className="font-semibold text-gray-700 dark:text-slate-200">Reading the numbers</div>
        <div>
          A plain number opens <em>exactly</em> those calls on Call Logs. A number with a dotted underline and{" "}
          <span className="align-super text-[9px]">≈</span> opens an honest <em>superset</em> — /call-logs has no filter for that
          dimension yet, so the link never pretends to narrow further than it can. Hover any number to see which it is.
        </div>
        <div>
          Every drill carries the filters you are looking at (date range, agent, team, module, call status, call state), so a
          click always lands inside the same slice.
        </div>
        <div>
          <b>Calls vs dials.</b> Tapping the Call button writes the call record immediately, before there is any result. Those
          unresolved dials (<em>Initiated</em> / <em>Ringing</em>) are <b>not</b> counted as calls anywhere on this page — not in
          Total calls, not in Connected or Unsuccessful, and not in the connect rate — because a tap is not a conversation. They
          are reported on their own in <b>Dial attempts (unresolved)</b>, which opens the same slice filtered to those dials. A
          dial joins the call numbers only when it resolves to a real outcome.
        </div>
      </div>

      {r.flags.length > 0 && (
        <div className="card p-4 bg-amber-50/60 dark:bg-amber-950/20 border-l-4 border-amber-400">
          <div className="font-semibold text-xs text-amber-800 dark:text-amber-300 mb-1">Reconciliation notes</div>
          <ul className="list-disc pl-4 space-y-1 text-[11px] text-amber-800/90 dark:text-amber-200/80">
            {r.flags.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}
