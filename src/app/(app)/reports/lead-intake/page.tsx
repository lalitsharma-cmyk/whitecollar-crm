// Lead Source Intake Report — "how many leads did we receive, from which
// source, over time?" with EVERY number clickable through to the exact records.
//
// count == records, by construction: every figure is computed with the SAME
// where-clause its drill target list applies for the URL params the link
// carries (see ./intake.ts for the per-module envelopes + the flagged
// residuals). Server-rendered, dark-mode aware, mobile-responsive.
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import {
  buildIntakeReport,
  resolveIntakeParams,
  reportHref,
  MODULE_LABELS,
  type Cell,
  type Grain,
  type IntakeParams,
} from "./intake";

export const dynamic = "force-dynamic";

// ── Small render helpers (server-side) ───────────────────────────────────────

function ChipRow({ parts }: { parts: NonNullable<Cell["parts"]> }) {
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {parts.map((pt) =>
        pt.href ? (
          <Link
            key={pt.label}
            href={pt.href}
            className="inline-flex items-center gap-1 rounded bg-gray-100 dark:bg-slate-700 px-1.5 py-0.5 text-[10px] font-medium text-gray-700 dark:text-slate-200 hover:bg-sky-100 dark:hover:bg-slate-600"
            title={`Open the ${pt.label} list for exactly these records`}
          >
            {pt.label} <span className="tabular-nums font-semibold">{pt.n}</span>
          </Link>
        ) : (
          <span
            key={pt.label}
            className="inline-flex items-center gap-1 rounded bg-gray-50 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] text-gray-400 dark:text-slate-500"
          >
            {pt.label} <span className="tabular-nums">{pt.n}</span>
          </span>
        ),
      )}
    </div>
  );
}

function CellView({ cell, strong }: { cell: Cell; strong?: boolean }) {
  const num = <span className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{cell.n}</span>;
  return (
    <div>
      {cell.href ? (
        <Link href={cell.href} className="text-sky-700 dark:text-sky-400 hover:underline" title={cell.note ?? "Open exactly these records"}>
          {num}
        </Link>
      ) : (
        <span title={cell.note}>{num}</span>
      )}
      {cell.parts && cell.parts.length > 0 && <ChipRow parts={cell.parts} />}
    </div>
  );
}

function SummaryCard({ title, cell, tone, sub }: { title: string; cell: Cell; tone: string; sub?: string }) {
  return (
    <div className={`card p-4 border-l-4 ${tone}`}>
      <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">{title}</div>
      <div className="text-2xl font-bold tabular-nums mt-1 text-gray-900 dark:text-slate-100">
        {cell.href ? (
          <Link href={cell.href} className="hover:underline" title="Open exactly these records">
            {cell.n}
          </Link>
        ) : (
          cell.n
        )}
      </div>
      {cell.parts && cell.parts.length > 0 && <ChipRow parts={cell.parts} />}
      {(cell.note || sub) && <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">{cell.note ?? sub}</div>}
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

export default async function LeadIntakeReportPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireUser();
  const sp = await searchParams;
  const params: IntakeParams = await resolveIntakeParams(sp, me);
  const r = await buildIntakeReport(me, params);

  const { grain, bucketGrain, fromKey, toKey, team, module, source, canSeeSource, teamLocked, moduleOptions } = params;
  const isAdmin = me.role === "ADMIN";

  const grainHref = (g: Grain) =>
    g === "custom"
      ? reportHref({ grain: "custom", from: fromKey, to: toKey, team, module, source })
      : reportHref({ grain: g, team, module, source });

  // Chart geometry.
  const bars = r.chart;
  const CH = 190, padT = 18, padB = 36, barW = 30, gap = 12, padL = 10;
  const chartW = padL * 2 + bars.length * (barW + gap);
  const innerH = CH - padT - padB;
  const labelEvery = Math.max(1, Math.ceil(bars.length / 16));

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-slate-100">Lead Source Intake</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            Leads received per source over time — every number opens the exact records. {r.rangeLabel}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <>
              <a
                href={`/api/reports/lead-intake/export?format=csv&grain=${grain}&from=${fromKey}&to=${toKey}&team=${team}&module=${module}&source=${encodeURIComponent(source)}`}
                className="text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800"
              >
                Export CSV
              </a>
              <a
                href={`/api/reports/lead-intake/export?format=xlsx&grain=${grain}&from=${fromKey}&to=${toKey}&team=${team}&module=${module}&source=${encodeURIComponent(source)}`}
                className="text-[11px] px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-800"
              >
                Export Excel
              </a>
            </>
          )}
          <Link href="/reports" className="text-[11px] text-gray-500 dark:text-slate-400 hover:underline">
            ← All reports
          </Link>
        </div>
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
        {grain === "custom" && bucketGrain !== "daily" && (
          <span className="self-center text-[10px] text-gray-400 dark:text-slate-500">bucketed {bucketGrain} by span</span>
        )}
      </div>

      {/* ── Filters (plain GET form — server-component friendly) ───────────── */}
      <form method="get" action="/reports/lead-intake" className="card p-3 flex flex-wrap items-end gap-3">
        <label className="text-[11px] text-gray-500 dark:text-slate-400 flex flex-col gap-1">
          Grain
          <select name="grain" defaultValue={grain} className="rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 text-xs px-2 py-1.5">
            {GRAIN_TABS.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
        <label className="text-[11px] text-gray-500 dark:text-slate-400 flex flex-col gap-1">
          From <span className="sr-only">(used with Custom)</span>
          <input type="date" name="from" defaultValue={fromKey} className="rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 text-xs px-2 py-1" />
        </label>
        <label className="text-[11px] text-gray-500 dark:text-slate-400 flex flex-col gap-1">
          To
          <input type="date" name="to" defaultValue={toKey} className="rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 text-xs px-2 py-1" />
        </label>
        {teamLocked ? (
          <div className="text-[11px] text-gray-500 dark:text-slate-400 flex flex-col gap-1">
            Team
            <span className="px-2 py-1.5 rounded bg-gray-100 dark:bg-slate-700 text-xs text-gray-700 dark:text-slate-200">{team} (your team)</span>
          </div>
        ) : me.role === "ADMIN" ? (
          <label className="text-[11px] text-gray-500 dark:text-slate-400 flex flex-col gap-1">
            Team
            <select name="team" defaultValue={team} className="rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 text-xs px-2 py-1.5">
              <option value="all">All teams</option>
              <option value="Dubai">Dubai</option>
              <option value="India">India</option>
            </select>
          </label>
        ) : null}
        <label className="text-[11px] text-gray-500 dark:text-slate-400 flex flex-col gap-1">
          Module
          <select name="module" defaultValue={module} className="rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 text-xs px-2 py-1.5">
            {moduleOptions.map((m) => (
              <option key={m} value={m}>{MODULE_LABELS[m]}</option>
            ))}
          </select>
        </label>
        {canSeeSource && (
          <label className="text-[11px] text-gray-500 dark:text-slate-400 flex flex-col gap-1">
            Source
            <select name="source" defaultValue={source} className="rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-gray-800 dark:text-slate-200 text-xs px-2 py-1.5 max-w-[180px]">
              <option value="all">All sources</option>
              {r.sourceOptions.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        <button type="submit" className="px-3 py-1.5 rounded-lg bg-[#0b1a33] text-white dark:bg-[#c9a24b] dark:text-[#0b1a33] text-xs font-semibold">
          Apply
        </button>
      </form>

      {/* ── Active-filter chips ────────────────────────────────────────────── */}
      {(team !== "all" || module !== "all" || source !== "all") && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-gray-400 dark:text-slate-500">Active filters:</span>
          {team !== "all" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 px-2 py-0.5">
              Team: {team}
              {!teamLocked && (
                <Link href={reportHref({ grain, from: fromKey, to: toKey, module, source })} className="hover:text-indigo-900">✕</Link>
              )}
            </span>
          )}
          {module !== "all" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 px-2 py-0.5">
              Module: {MODULE_LABELS[module]}
              <Link href={reportHref({ grain, from: fromKey, to: toKey, team, source })} className="hover:text-emerald-900">✕</Link>
            </span>
          )}
          {source !== "all" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 px-2 py-0.5">
              Source: {source}
              <Link href={reportHref({ grain, from: fromKey, to: toKey, team, module })} className="hover:text-amber-900">✕</Link>
            </span>
          )}
        </div>
      )}

      {/* ── Summary cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard title="Total received" cell={r.summary.total} tone="border-sky-500" sub={r.rangeLabel} />
        <SummaryCard title="Received today" cell={r.summary.today} tone="border-emerald-500" />
        <SummaryCard title="Assigned" cell={r.summary.assigned} tone="border-blue-500" />
        <SummaryCard title={r.isBuyerView ? "In pool" : "Unassigned"} cell={r.summary.unassigned} tone="border-amber-500" />
        <SummaryCard title="Converted" cell={r.summary.converted} tone="border-green-600" />
        <SummaryCard title={r.isBuyerView ? "Rejected" : "Rejected / Lost"} cell={r.summary.lost} tone="border-rose-500" />
      </div>
      {(r.summary.lostRemainder || r.unstatused) && (
        <div className="space-y-1 -mt-2">
          {r.summary.lostRemainder && (
            <div className="text-[11px] text-gray-500 dark:text-slate-400">
              +{" "}
              {r.summary.lostRemainder.href ? (
                <Link href={r.summary.lostRemainder.href} className="text-rose-600 dark:text-rose-400 hover:underline font-medium">
                  {r.summary.lostRemainder.n} rejected
                </Link>
              ) : (
                <span className="font-medium">{r.summary.lostRemainder.n} rejected</span>
              )}{" "}
              — {r.summary.lostRemainder.note}
            </div>
          )}
          {r.unstatused && (
            // Unclassified-data directive: "Missing status" is its own visible
            // bucket — inside Total, inside NO lifecycle card; it drains
            // automatically as records get classified.
            <div className="text-[11px] text-gray-500 dark:text-slate-400 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 border border-slate-300 dark:border-slate-600 px-2 py-0.5 font-medium text-slate-600 dark:text-slate-300">
                Missing status: <span className="tabular-nums ml-1">{r.unstatused.n}</span>
              </span>
              {r.unstatused.parts && r.unstatused.parts.length > 0 && <ChipRow parts={r.unstatused.parts} />}
              <span>— {r.unstatused.note}</span>
            </div>
          )}
        </div>
      )}

      {/* ── Buyer Data strip (module = all) ────────────────────────────────── */}
      {r.buyerStrips.map((s) => (
        <div key={s.market} className="card p-4">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="font-bold text-sm text-gray-900 dark:text-slate-100">{s.label} — received in range</h2>
            <span className="text-[10px] text-gray-400 dark:text-slate-500">imported records · source date = record created date</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-sm">
            {([
              ["Total", s.total], ["In pool", s.pool], ["Assigned", s.assigned], ["Converted", s.converted], ["Rejected", s.rejected],
            ] as [string, Cell][]).map(([label, cell]) => (
              <div key={label}>
                <div className="text-[10px] uppercase tracking-wide text-gray-500 dark:text-slate-400">{label}</div>
                <CellView cell={cell} strong />
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* ── Trend chart (server-rendered SVG, every bar is a link) ─────────── */}
      <div className="card p-5">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="font-bold text-base text-gray-900 dark:text-slate-100">Received per {bucketGrain === "daily" ? "day" : bucketGrain === "weekly" ? "week" : bucketGrain === "monthly" ? "month" : "year"}</h2>
          <span className="text-[10px] text-gray-400 dark:text-slate-500">click a bar to open that {bucketGrain === "daily" ? "day" : "period"}&rsquo;s records</span>
        </div>
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${chartW} ${CH}`}
            width={chartW}
            height={CH}
            role="img"
            aria-label="Leads received per period"
            className="text-gray-500 dark:text-slate-400"
          >
            <line x1={padL} y1={CH - padB} x2={chartW - padL} y2={CH - padB} stroke="currentColor" strokeOpacity="0.35" />
            {bars.map((b, i) => {
              const h = Math.round((b.n / r.totalsByBucketMax) * (innerH - 4));
              const x = padL + i * (barW + gap);
              const y = CH - padB - h;
              return (
                <Link key={b.bucket.key} href={b.href}>
                  <g className="cursor-pointer">
                    <title>{`${b.bucket.label} — ${b.n} received`}</title>
                    {/* full-column hit area so 0-count buckets stay clickable */}
                    <rect x={x} y={padT} width={barW} height={CH - padB - padT} fill="transparent" />
                    <rect x={x} y={y} width={barW} height={Math.max(h, b.n > 0 ? 2 : 0)} rx="3" fill="#10b981" fillOpacity="0.85" />
                    {bars.length <= 40 && b.n > 0 && (
                      <text x={x + barW / 2} y={y - 4} textAnchor="middle" fontSize="9" fill="currentColor">{b.n}</text>
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

      {/* ── Source-wise table (hidden for agents — mirrors the /leads gate) ── */}
      {canSeeSource && (
        <div className="card p-5">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="font-bold text-base text-gray-900 dark:text-slate-100">Source-wise intake</h2>
            <span className="text-[10px] text-gray-400 dark:text-slate-500">verbatim source values, exactly as filterable on the lists</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                  <th className="py-2 pr-3">Source</th>
                  <th className="py-2 pr-3">Received</th>
                  <th className="py-2 pr-3">% of total</th>
                  <th className="py-2 pr-3">Converted</th>
                  <th className="py-2 pr-3">Conversion %</th>
                </tr>
              </thead>
              <tbody>
                {r.sourceRows.length === 0 && (
                  <tr><td colSpan={5} className="py-4 text-center text-gray-400 dark:text-slate-500 text-xs">No records in this range.</td></tr>
                )}
                {r.sourceRows.map((row) => (
                  <tr key={row.key || "__unknown__"} className="border-b border-gray-100 dark:border-slate-800 align-top">
                    <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">{row.label}</td>
                    <td className="py-2 pr-3"><CellView cell={row.count} strong /></td>
                    <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-slate-300">{row.pct.toFixed(1)}%</td>
                    <td className="py-2 pr-3">{row.converted ? <CellView cell={row.converted} /> : <span className="text-gray-400">—</span>}</td>
                    <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-slate-300">{row.convPct == null ? "—" : `${row.convPct.toFixed(1)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Date-wise table ────────────────────────────────────────────────── */}
      <div className="card p-5">
        <h2 className="font-bold text-base text-gray-900 dark:text-slate-100 mb-2">Date-wise intake</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[420px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                <th className="py-2 pr-3">{bucketGrain === "daily" ? "Day" : bucketGrain === "weekly" ? "Week (Mon–Sun, IST)" : bucketGrain === "monthly" ? "Month" : "Year"}</th>
                <th className="py-2 pr-3">Received</th>
                <th className="py-2 pr-3">% of total</th>
              </tr>
            </thead>
            <tbody>
              {r.dateRows.map(({ bucket, count, pct }) => (
                <tr key={bucket.key} className="border-b border-gray-100 dark:border-slate-800 align-top">
                  <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">{bucket.label}</td>
                  <td className="py-2 pr-3"><CellView cell={count} strong /></td>
                  <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-slate-300">{pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Team-wise + Module-wise ────────────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {!r.isBuyerView && (
          <div className="card p-5">
            <h2 className="font-bold text-base text-gray-900 dark:text-slate-100 mb-2">Team-wise intake</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[320px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                    <th className="py-2 pr-3">Team</th>
                    <th className="py-2 pr-3">Received</th>
                    <th className="py-2 pr-3">% of total</th>
                  </tr>
                </thead>
                <tbody>
                  {r.teamRows.length === 0 && (
                    <tr><td colSpan={3} className="py-4 text-center text-gray-400 dark:text-slate-500 text-xs">No records in this range.</td></tr>
                  )}
                  {r.teamRows.map((row) => (
                    <tr key={row.label} className="border-b border-gray-100 dark:border-slate-800 align-top">
                      <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">{row.label}</td>
                      <td className="py-2 pr-3"><CellView cell={row.count} strong /></td>
                      <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-slate-300">{row.pct.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <div className="card p-5">
          <h2 className="font-bold text-base text-gray-900 dark:text-slate-100 mb-2">Module-wise intake</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[360px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                  <th className="py-2 pr-3">Module</th>
                  <th className="py-2 pr-3">Received</th>
                </tr>
              </thead>
              <tbody>
                {r.moduleRows.map((row) => (
                  <tr key={row.id} className="border-b border-gray-100 dark:border-slate-800 align-top">
                    <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">
                      {row.label}
                      {row.note && <div className="text-[10px] text-gray-400 dark:text-slate-500">{row.note}</div>}
                    </td>
                    <td className="py-2 pr-3"><CellView cell={row.count} strong /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 text-[10px] text-gray-400 dark:text-slate-500">
            Each module row is counted with that module&rsquo;s OWN list envelope, so the number equals what its link opens. Master Data is the full sales
            database and includes the workable pipeline — module rows are lenses, not a partition.
          </div>
        </div>
      </div>

      {/* ── Reconciliation notes ───────────────────────────────────────────── */}
      {r.flags.length > 0 && (
        <div className="card p-4 bg-amber-50/60 dark:bg-amber-950/20 border-l-4 border-amber-400">
          <div className="font-semibold text-xs text-amber-800 dark:text-amber-300 mb-1">Reconciliation notes</div>
          <ul className="list-disc pl-4 space-y-1 text-[11px] text-amber-800/90 dark:text-amber-200/80">
            {r.flags.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
