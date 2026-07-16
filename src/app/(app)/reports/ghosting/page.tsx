// 👻 Ghosting Report — leads whose CURRENT owner has tried ≥N calls (Setting
// "ghostingThreshold") with ZERO meaningful connects. Normal Leads only.
//
// count == records, by construction: every clickable figure is computed with
// the SAME where its /leads?ghost=1 drill applies (see ./ghosting.ts for the
// envelope byte-mirror). Structure follows /reports/lead-intake — single live
// view (ghosting is a current state, not a time series, so no grain tabs).
// Server-rendered, dark-mode aware, mobile-responsive.
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { buildGhostingReport } from "./ghosting";

export const dynamic = "force-dynamic";

function Num({ n, href, strong = true }: { n: number; href?: string; strong?: boolean }) {
  const inner = <span className={`tabular-nums ${strong ? "font-semibold" : ""}`}>{n}</span>;
  return href ? (
    <Link href={href} className="text-sky-700 dark:text-sky-400 hover:underline" title="Open exactly these leads">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export default async function GhostingReportPage() {
  const me = await requireUser();
  const r = await buildGhostingReport({ id: me.id, role: me.role, team: me.team });

  // Mirrors the /leads privacy gate — agents never see/filter source.
  const canSeeSource = me.role !== "AGENT";
  const isAgent = me.role === "AGENT";
  const total = r.total.n;
  const pct = (n: number) => (total ? ((n / total) * 100).toFixed(1) : "0.0");

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-gray-900 dark:text-slate-100">👻 Ghosting Report</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            {isAgent ? "Your leads" : "Leads"} with {r.threshold}+ call attempts by the current owner and zero connects — every
            number opens the exact records.
          </p>
        </div>
        <Link href="/reports" className="text-[11px] text-gray-500 dark:text-slate-400 hover:underline">
          ← All reports
        </Link>
      </div>

      {/* ── Summary cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="card p-4 border-l-4 border-violet-500">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">Total Ghosting Leads</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-gray-900 dark:text-slate-100">
            <Link href={r.total.href} className="hover:underline" title="Open exactly these leads">
              {total}
            </Link>
          </div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
            currently owned · workable status · guard re-checked live
          </div>
        </div>
        <div className="card p-4 border-l-4 border-indigo-500">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">Average Attempts</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-gray-900 dark:text-slate-100">
            {r.avgAttempts == null ? (
              "—"
            ) : (
              <Link href={r.total.href} className="hover:underline" title="Open the leads behind this average">
                {r.avgAttempts.toFixed(1)}
              </Link>
            )}
          </div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
            calls tried by the current owner, per current ghosting lead
          </div>
        </div>
        <div className="card p-4 border-l-4 border-emerald-500">
          <div className="text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400">Ghosting Conversion Rate</div>
          <div className="text-2xl font-bold tabular-nums mt-1 text-gray-900 dark:text-slate-100">
            {r.conversion.pct == null ? "—" : `${r.conversion.pct.toFixed(1)}%`}
          </div>
          <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-1">
            of leads that ever ghosted, later closed —{" "}
            <span className="tabular-nums">
              {r.conversion.closed} of {r.conversion.everGhosted}
            </span>{" "}
            still-stamped leads (closed leads live in Master Data, so this figure has no /leads drill)
          </div>
        </div>
      </div>

      {total === 0 && (
        <div className="card p-5 text-center text-sm text-gray-500 dark:text-slate-400">
          No ghosting leads right now — nobody{isAgent ? " in your book" : ""} has hit {r.threshold}+ unanswered call
          attempts. 🎉
        </div>
      )}

      {/* ── Ghosting by Agent ──────────────────────────────────────────────── */}
      <div className="card p-5">
        <div className="flex items-baseline justify-between mb-2">
          <h2 className="font-bold text-base text-gray-900 dark:text-slate-100">Ghosting by Agent</h2>
          <span className="text-[10px] text-gray-400 dark:text-slate-500">current owner · click a count to open those leads</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[480px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                <th className="py-2 pr-3">Agent</th>
                <th className="py-2 pr-3">Ghosting</th>
                <th className="py-2 pr-3">% of total</th>
                <th className="py-2 pr-3">Avg attempts</th>
              </tr>
            </thead>
            <tbody>
              {r.byAgent.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-gray-400 dark:text-slate-500 text-xs">
                    No ghosting leads.
                  </td>
                </tr>
              )}
              {r.byAgent.map((row) => (
                <tr key={row.ownerId} className="border-b border-gray-100 dark:border-slate-800 align-top">
                  <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">{row.name}</td>
                  <td className="py-2 pr-3">
                    <Num n={row.n} href={row.href} />
                  </td>
                  <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-slate-300">{pct(row.n)}%</td>
                  <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-slate-300">{row.avgAttempts.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Ghosting by Team + by Source ───────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card p-5">
          <h2 className="font-bold text-base text-gray-900 dark:text-slate-100 mb-2">Ghosting by Team</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[300px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                  <th className="py-2 pr-3">Team</th>
                  <th className="py-2 pr-3">Ghosting</th>
                  <th className="py-2 pr-3">% of total</th>
                </tr>
              </thead>
              <tbody>
                {r.byTeam.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-gray-400 dark:text-slate-500 text-xs">
                      No ghosting leads.
                    </td>
                  </tr>
                )}
                {r.byTeam.map((row) => (
                  <tr key={row.key || "__none__"} className="border-b border-gray-100 dark:border-slate-800 align-top">
                    <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">
                      {row.label}
                      {row.note && <div className="text-[10px] text-gray-400 dark:text-slate-500">{row.note}</div>}
                    </td>
                    <td className="py-2 pr-3">
                      <Num n={row.n} href={row.href} />
                    </td>
                    <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-slate-300">{pct(row.n)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {canSeeSource && (
          <div className="card p-5">
            <div className="flex items-baseline justify-between mb-2">
              <h2 className="font-bold text-base text-gray-900 dark:text-slate-100">Ghosting by Source</h2>
              <span className="text-[10px] text-gray-400 dark:text-slate-500">verbatim source values, as filterable on /leads</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[300px]">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wide text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700">
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3">Ghosting</th>
                    <th className="py-2 pr-3">% of total</th>
                  </tr>
                </thead>
                <tbody>
                  {r.bySource.length === 0 && (
                    <tr>
                      <td colSpan={3} className="py-4 text-center text-gray-400 dark:text-slate-500 text-xs">
                        No ghosting leads.
                      </td>
                    </tr>
                  )}
                  {r.bySource.map((row) => (
                    <tr key={row.key || "__unknown__"} className="border-b border-gray-100 dark:border-slate-800 align-top">
                      <td className="py-2 pr-3 text-gray-800 dark:text-slate-200">
                        {row.label}
                        {row.note && <div className="text-[10px] text-gray-400 dark:text-slate-500">{row.note}</div>}
                      </td>
                      <td className="py-2 pr-3">
                        <Num n={row.n} href={row.href} />
                      </td>
                      <td className="py-2 pr-3 tabular-nums text-gray-600 dark:text-slate-300">{pct(row.n)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* ── How this report counts (honesty notes) ─────────────────────────── */}
      <div className="card p-4 bg-violet-50/60 dark:bg-violet-950/20 border-l-4 border-violet-400">
        <div className="font-semibold text-xs text-violet-800 dark:text-violet-300 mb-1">How ghosting is counted</div>
        <ul className="list-disc pl-4 space-y-1 text-[11px] text-violet-800/90 dark:text-violet-200/80">
          <li>
            👻 is a <b>secondary tag</b> — the lead&rsquo;s status stays authoritative. It stamps when the current owner
            logs {r.threshold}+ call attempts with zero connects, and clears automatically on a connected call or a
            transfer (the new owner starts a fresh attempt cycle).
          </li>
          <li>
            Eligibility is re-checked live: a stamped lead whose status is now closed/lost or at an engaged
            meeting/visit/booking stage is <b>not</b> shown or counted (&ldquo;Follow Up&rdquo; remains eligible).
          </li>
          <li>
            Every count uses the same filter its link opens (<code>/leads?ghost=1</code>), scoped to what you can see
            — admins all leads, managers their team, agents their own.
          </li>
          <li>
            Conversion rate counts leads <b>still carrying</b> the stamp: a lead whose ghosting cleared via a connect
            before it closed is not part of &ldquo;ever ghosted&rdquo;.
          </li>
        </ul>
      </div>
    </>
  );
}
