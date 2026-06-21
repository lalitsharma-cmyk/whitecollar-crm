import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CallOutcome, Prisma } from "@prisma/client";
import Link from "next/link";
import { normalizeTeam } from "@/lib/teamRouting";
import { formatLeadName } from "@/lib/leadName";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

// IST offset in ms
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function fmtIst(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const dd = String(ist.getUTCDate()).padStart(2, "0");
  const mo = ist.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const yyyy = ist.getUTCFullYear();
  const hh = String(ist.getUTCHours()).padStart(2, "0");
  const mm = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${dd} ${mo} ${yyyy}, ${hh}:${mm}`;
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

// Outcome chip colour mapping
const outcomeChip: Record<CallOutcome, string> = {
  CONNECTED:      "bg-emerald-100 text-emerald-800",
  NOT_PICKED:     "bg-red-100 text-red-800",
  CALLBACK:       "bg-blue-100 text-blue-800",
  WRONG_NUMBER:   "bg-gray-100 text-gray-700",
  BUSY:           "bg-amber-100 text-amber-800",
  SWITCHED_OFF:   "bg-orange-100 text-orange-800",
  INTERESTED:     "bg-teal-100 text-teal-800",
  NOT_INTERESTED: "bg-slate-100 text-slate-700",
};

const outcomeLabel: Record<CallOutcome, string> = {
  CONNECTED:      "Connected",
  NOT_PICKED:     "Not Picked",
  CALLBACK:       "Callback",
  WRONG_NUMBER:   "Wrong Number",
  BUSY:           "Busy",
  SWITCHED_OFF:   "Switched Off",
  INTERESTED:     "Interested",
  NOT_INTERESTED: "Not Interested",
};

export default async function CallLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireUser();

  // AGENT guard — redirect to dashboard
  if (me.role === "AGENT") {
    redirect("/dashboard");
  }

  const sp = await searchParams;

  // ── Build where clause ──────────────────────────────────────────────────
  const where: Prisma.CallLogWhereInput = {};

  // Role scoping: MANAGER sees own team's calls; ADMIN sees all
  if (me.role === "MANAGER") {
    const team = normalizeTeam(me.team ?? undefined);
    if (team) {
      where.user = { team };
    }
  }

  // Filter: by agent (userId)
  if (sp.agent) {
    where.userId = sp.agent;
  }

  // Filter: by outcome
  if (sp.outcome && Object.keys(CallOutcome).includes(sp.outcome)) {
    where.outcome = sp.outcome as CallOutcome;
  }

  // Filter: by date range (?from= and ?to= are YYYY-MM-DD in IST)
  if (sp.from || sp.to) {
    const dateFilter: Prisma.DateTimeFilter<"CallLog"> = {};
    if (sp.from) {
      // Parse as start-of-day IST → UTC
      const fromMs = new Date(`${sp.from}T00:00:00Z`).getTime() - IST_OFFSET_MS;
      dateFilter.gte = new Date(fromMs);
    }
    if (sp.to) {
      // Parse as end-of-day IST → UTC (inclusive: next midnight - 1ms)
      const toMs = new Date(`${sp.to}T00:00:00Z`).getTime() - IST_OFFSET_MS + 24 * 3600 * 1000;
      dateFilter.lt = new Date(toMs);
    }
    where.startedAt = dateFilter;
  }

  // ── Pagination ──────────────────────────────────────────────────────────
  const page = Math.max(1, parseInt(sp.page ?? "1") || 1);
  const skip = (page - 1) * PAGE_SIZE;

  // ── Fetch agents for the filter dropdown ───────────────────────────────
  const agentsQuery: Prisma.UserWhereInput = {
    active: true,
    hrOnly: false,
    role: { in: ["AGENT", "MANAGER"] },
  };
  if (me.role === "MANAGER") {
    const team = normalizeTeam(me.team ?? undefined);
    if (team) agentsQuery.team = team;
  }

  const [logs, total, agents] = await Promise.all([
    prisma.callLog.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip,
      take: PAGE_SIZE,
      include: {
        user: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true } },
      },
    }),
    prisma.callLog.count({ where }),
    prisma.user.findMany({
      where: agentsQuery,
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Build a URLSearchParams helper that preserves existing filters
  function pageUrl(p: number) {
    const params = new URLSearchParams();
    if (sp.agent) params.set("agent", sp.agent);
    if (sp.outcome) params.set("outcome", sp.outcome);
    if (sp.from) params.set("from", sp.from);
    if (sp.to) params.set("to", sp.to);
    params.set("page", String(p));
    return `/call-logs?${params.toString()}`;
  }

  const exportParams = new URLSearchParams();
  if (sp.agent) exportParams.set("agent", sp.agent);
  if (sp.outcome) exportParams.set("outcome", sp.outcome);
  if (sp.from) exportParams.set("from", sp.from);
  if (sp.to) exportParams.set("to", sp.to);

  const hasFilters = !!(sp.agent || sp.outcome || sp.from || sp.to);

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Call Logs</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            {total.toLocaleString()} call{total !== 1 ? "s" : ""}
            {me.role === "MANAGER" && me.team ? ` · ${normalizeTeam(me.team ?? undefined) ?? me.team} team` : " · all teams"}
          </p>
        </div>
        <a
          href={`/api/call-logs/export${exportParams.toString() ? `?${exportParams.toString()}` : ""}`}
          className="btn btn-ghost"
        >
          ⬇ Export CSV
        </a>
      </div>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <form method="get" action="/call-logs" className="card p-4">
        <div className="flex flex-wrap gap-3 items-end">
          {/* Agent filter */}
          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
              Agent
            </label>
            <select
              name="agent"
              defaultValue={sp.agent ?? ""}
              className="border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100"
            >
              <option value="">All agents</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>

          {/* Outcome filter */}
          <div className="flex flex-col gap-1 min-w-[160px]">
            <label className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
              Outcome
            </label>
            <select
              name="outcome"
              defaultValue={sp.outcome ?? ""}
              className="border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100"
            >
              <option value="">All outcomes</option>
              {Object.values(CallOutcome).map((o) => (
                <option key={o} value={o}>
                  {outcomeLabel[o]}
                </option>
              ))}
            </select>
          </div>

          {/* From date */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
              From
            </label>
            <input
              type="date"
              name="from"
              defaultValue={sp.from ?? ""}
              className="border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100"
            />
          </div>

          {/* To date */}
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wide">
              To
            </label>
            <input
              type="date"
              name="to"
              defaultValue={sp.to ?? ""}
              className="border border-[#e5e7eb] dark:border-slate-600 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-700 dark:text-slate-100"
            />
          </div>

          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary">
              Apply
            </button>
            {hasFilters && (
              <Link href="/call-logs" className="btn btn-ghost">
                Clear
              </Link>
            )}
          </div>
        </div>
      </form>

      {/* ── Active filter banner ────────────────────────────────────────── */}
      {hasFilters && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs text-amber-700 dark:text-amber-400 font-medium">
            ⚠ Filtered — showing {total.toLocaleString()} of all calls
          </span>
          <Link
            href="/call-logs"
            className="text-xs text-[#0b1a33] dark:text-blue-300 hover:underline font-medium"
          >
            ✕ Clear all filters
          </Link>
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="card overflow-x-auto">
        {logs.length === 0 ? (
          <div className="p-8 text-center text-gray-500 dark:text-slate-400 text-sm">
            No call logs found
            {hasFilters ? " matching your filters" : ""}.
          </div>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Date / Time (IST)</th>
                <th>Agent</th>
                <th>Lead</th>
                <th>Duration</th>
                <th>Outcome</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id}>
                  <td className="whitespace-nowrap text-xs text-gray-500 dark:text-slate-400 font-mono">
                    {fmtIst(log.startedAt)}
                  </td>
                  <td className="text-sm font-medium">
                    {log.attributedAgentName ?? log.user.name}
                  </td>
                  <td className="text-sm">
                    {log.lead ? (
                      <Link
                        href={`/leads/${log.lead.id}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        {formatLeadName(log.lead.name)}
                      </Link>
                    ) : (
                      <span className="text-gray-400 dark:text-slate-500 text-xs">—</span>
                    )}
                  </td>
                  <td className="text-sm text-gray-600 dark:text-slate-300 whitespace-nowrap">
                    {fmtDuration(log.durationSec)}
                  </td>
                  <td>
                    <span
                      className={`chip ${outcomeChip[log.outcome]}`}
                    >
                      {outcomeLabel[log.outcome]}
                    </span>
                  </td>
                  <td className="text-xs text-gray-500 dark:text-slate-400 max-w-xs truncate">
                    {log.notes ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ─────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between text-sm">
        <div className="text-gray-500 dark:text-slate-400">
          Showing {total === 0 ? 0 : skip + 1}–{Math.min(skip + PAGE_SIZE, total)} of{" "}
          {total.toLocaleString()}
        </div>
        <div className="flex gap-2">
          {page > 1 && (
            <Link href={pageUrl(page - 1)} className="btn btn-ghost">
              ‹ Prev
            </Link>
          )}
          <span className="px-3 py-2 text-xs text-gray-500 dark:text-slate-400">
            Page {page} of {totalPages}
          </span>
          {page < totalPages && (
            <Link href={pageUrl(page + 1)} className="btn btn-ghost">
              Next ›
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
