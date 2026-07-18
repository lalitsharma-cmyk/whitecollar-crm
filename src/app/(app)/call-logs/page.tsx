import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { CallOutcome, Prisma } from "@prisma/client";
import Link from "next/link";
import { normalizeTeam } from "@/lib/teamRouting";
import { formatLeadName } from "@/lib/leadName";
import { visibleOwnerIds } from "@/lib/leadScope";
import { canExportData } from "@/lib/exportPerms";
import {
  activityLeadModule,
  buyerSourceModule,
  moduleHref,
  isBuyerModule,
  ACTIVITY_SOURCE_MODULES,
  type SourceModule,
} from "@/lib/moduleSource";
import { PENDING_CALL_OUTCOMES } from "@/lib/ghosting";
import CallLogFilters from "./CallLogFilters";

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

// First phone out of a BuyerRecord.phones JSON array (["+9711…", …]).
function firstBuyerPhone(phones: string | null): string | null {
  if (!phones) return null;
  try {
    const arr = JSON.parse(phones);
    if (Array.isArray(arr)) {
      const first = arr.map((p) => String(p ?? "").trim()).find(Boolean);
      return first ?? null;
    }
  } catch {
    /* not JSON — fall through */
  }
  const t = phones.trim();
  return t || null;
}

// ── Call STATE chips ─────────────────────────────────────────────────────────
// EVERY CallOutcome renders, including the two UNRESOLVED dial states added with
// the dial-on-tap change (Lalit P0, 2026-07-18). Both maps are exhaustive
// Record<CallOutcome, …>, so adding an enum value is a COMPILE error here rather
// than a silently blank chip in the list (which is exactly what the INITIATED /
// RINGING / FAILED / CANCELLED / MISSED additions produced before this fix:
// `outcomeChip[r.outcome]` was undefined → `class="chip undefined"`, empty label).
//
// Unresolved states are deliberately styled apart (violet + dashed border): a
// dial that has not resolved is NOT a call result, and must never read like one.
const outcomeChip: Record<CallOutcome, string> = {
  // Resolved — a human answered
  CONNECTED:      "bg-emerald-100 text-emerald-800",
  INTERESTED:     "bg-teal-100 text-teal-800",
  NOT_INTERESTED: "bg-slate-100 text-slate-700",
  CALLBACK:       "bg-blue-100 text-blue-800",
  // Resolved — no contact
  NOT_PICKED:     "bg-red-100 text-red-800",
  BUSY:           "bg-amber-100 text-amber-800",
  SWITCHED_OFF:   "bg-orange-100 text-orange-800",
  WRONG_NUMBER:   "bg-gray-100 text-gray-700",
  FAILED:         "bg-rose-100 text-rose-800",
  CANCELLED:      "bg-zinc-100 text-zinc-700",
  MISSED:         "bg-fuchsia-100 text-fuchsia-800",
  // UNRESOLVED — a dial with no result yet
  INITIATED:      "bg-violet-100 text-violet-800 border border-dashed border-violet-400",
  RINGING:        "bg-violet-100 text-violet-800 border border-dashed border-violet-400",
};

const outcomeLabel: Record<CallOutcome, string> = {
  CONNECTED:      "Connected",
  INTERESTED:     "Interested",
  NOT_INTERESTED: "Not Interested",
  CALLBACK:       "Callback",
  // NOT_PICKED also serves "No Answer" — the stored label stays "Not Picked" so
  // this list, /reports/calls (OUTCOME_LABELS) and the CSV export keep ONE
  // vocabulary. Renaming it here only would have made the same rows read
  // differently on three surfaces.
  NOT_PICKED:     "Not Picked",
  BUSY:           "Busy",
  SWITCHED_OFF:   "Switched Off",
  WRONG_NUMBER:   "Wrong Number",
  FAILED:         "Failed",
  CANCELLED:      "Cancelled",
  MISSED:         "Missed",
  INITIATED:      "Initiated",
  RINGING:        "Ringing",
};

// Module chip tint (matches the 5 SourceModules).
const moduleChip: Record<SourceModule, string> = {
  "Leads":            "bg-indigo-100 text-indigo-800",
  "Master Data":      "bg-slate-100 text-slate-700",
  "Revival Engine":   "bg-purple-100 text-purple-800",
  "Dubai Buyer Data": "bg-amber-100 text-amber-800",
  "India Buyer Data": "bg-cyan-100 text-cyan-800",
};

export default async function CallLogsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const me = await requireUser();
  const sp = await searchParams;

  const managerTeam = me.role === "MANAGER" ? normalizeTeam(me.team ?? undefined) : null;

  // ── ROLE SCOPE (server-enforced) ─────────────────────────────────────────
  // Call logs are scoped by the ACTOR (CallLog.userId — the agent who made/took
  // the call), NOT by lead ownership, so an agent sees exactly the calls they
  // performed and a manager sees their team's calls.
  //   AGENT   → userId = me.id                       (only their own calls)
  //   MANAGER → user.team = <their team>             (their whole team)
  //   ADMIN   → no actor restriction                 (all calls)
  // Mirrors the CSV-export route's scoping so the on-screen list and the export
  // can never diverge. visibleOwnerIds() is reused as the org-membership source.
  const scopeAnd: Prisma.CallLogWhereInput[] = [];
  if (me.role === "AGENT") {
    scopeAnd.push({ userId: me.id });
  } else if (me.role === "MANAGER") {
    if (managerTeam) {
      scopeAnd.push({ user: { team: managerTeam } });
    } else {
      // Manager without a team configured → fall back to their org subtree so they
      // still see something rather than the whole company.
      const ids = await visibleOwnerIds(me);
      if (ids) scopeAnd.push({ userId: { in: ids } });
    }
  }
  // ADMIN → no scope predicate.

  // ── Cross-module inclusion ───────────────────────────────────────────────
  // The ONE line that makes this page centralized: include a call whose linked
  // Lead is live OR whose linked Buyer is live (the old page dropped buyer-only
  // calls by filtering `lead:{deletedAt:null}`). Unlinked calls (neither) stay
  // out. This is pure read-time aggregation — no schema change, no dual-write.
  const linkedAnd: Prisma.CallLogWhereInput = {
    OR: [{ lead: { deletedAt: null } }, { buyer: { deletedAt: null } }],
  };

  // ── User / Team filters (from the URL) ───────────────────────────────────
  const filterAnd: Prisma.CallLogWhereInput[] = [];

  // User filter (a specific actor). Applied within the role scope, so a manager
  // can only ever narrow to a user already inside their team.
  if (sp.user) filterAnd.push({ userId: sp.user });

  // Team filter (ADMIN only meaningfully; a manager is already team-locked).
  const teamFilter = normalizeTeam(sp.team ?? undefined);
  if (teamFilter && me.role === "ADMIN") {
    filterAnd.push({ user: { team: teamFilter } });
  }

  // Call Status (outcome).
  if (sp.outcome && (Object.keys(CallOutcome) as string[]).includes(sp.outcome)) {
    filterAnd.push({ outcome: sp.outcome as CallOutcome });
  }

  // ── Call STATE (?state=) — resolved vs unresolved dial (Lalit P0 2026-07-18) ──
  // PENDING = INITIATED | RINGING: a CallLog written the instant the Call button
  // was tapped, before any result. "resolved" = every other outcome.
  //
  // HONOURED FOR EVERY ROLE — deliberately NOT gated like ?team= (ADMIN-only).
  // /reports/calls drills carry ?state=resolved on every call number and
  // ?state=pending on the unresolved-dials figure; if this predicate were
  // role-gated, an agent or manager clicking their own number would land on a
  // WIDER set than the number claimed, breaking the report's count==records
  // contract for exactly the users who check it most. The role SCOPE above still
  // constrains which rows they can see — this only narrows within that scope.
  const stateParam = sp.state === "pending" || sp.state === "resolved" ? sp.state : "";
  if (stateParam === "pending") {
    filterAnd.push({ outcome: { in: [...PENDING_CALL_OUTCOMES] } });
  } else if (stateParam === "resolved") {
    filterAnd.push({ outcome: { notIn: [...PENDING_CALL_OUTCOMES] } });
  }

  // Date range (?from / ?to are YYYY-MM-DD in IST).
  if (sp.from || sp.to) {
    const dateFilter: Prisma.DateTimeFilter<"CallLog"> = {};
    if (sp.from) {
      const fromMs = new Date(`${sp.from}T00:00:00Z`).getTime() - IST_OFFSET_MS;
      dateFilter.gte = new Date(fromMs);
    }
    if (sp.to) {
      const toMs = new Date(`${sp.to}T00:00:00Z`).getTime() - IST_OFFSET_MS + 24 * 3600 * 1000;
      dateFilter.lt = new Date(toMs);
    }
    filterAnd.push({ startedAt: dateFilter });
  }

  // Module filter — the 4 ACTIVITY modules. A module maps to a predicate on the
  // linked record: buyer modules → buyer.market; lead modules → leadOrigin/isColdCall.
  // A CALL's module is the WORKING SURFACE it was performed from — never "Master
  // Data" (agents don't call from the read-only archive). So the filter offers only
  // the 4 activity modules; a master-origin lead's calls fall under "Leads" (the
  // queue the agent worked it from), matching the per-row activityLeadModule label.
  const moduleParam = (sp.module ?? "") as SourceModule | "";
  if (moduleParam && ACTIVITY_SOURCE_MODULES.includes(moduleParam as SourceModule)) {
    const m = moduleParam as SourceModule;
    if (isBuyerModule(m)) {
      const market = m === "India Buyer Data" ? "India" : "Dubai";
      filterAnd.push({ buyer: { is: { market, deletedAt: null } } });
    } else if (m === "Revival Engine") {
      filterAnd.push({
        lead: { is: { deletedAt: null, OR: [{ leadOrigin: { in: ["COLD", "REVIVAL"] } }, { isColdCall: true }] } },
      });
    } else {
      // "Leads" = every NON-revival lead call (master-origin INCLUDED — an activity on
      // a master-origin lead is worked from the Leads queue, so it never labels as
      // "Master Data"). Only cold/revival is carved out (that's the Revival module).
      filterAnd.push({
        lead: {
          is: {
            deletedAt: null,
            isColdCall: false,
            leadOrigin: { notIn: ["COLD", "REVIVAL"] },
          },
        },
      });
    }
  }

  // Search — customer name (lead.name / buyer.clientName), mobile (call number,
  // lead.phone, buyer.phones), or agent name (user.name / attributedAgentName).
  const rawQ = (sp.q ?? "").trim();
  if (rawQ) {
    const mode = "insensitive" as const;
    filterAnd.push({
      OR: [
        { lead: { is: { name: { contains: rawQ, mode } } } },
        { lead: { is: { phone: { contains: rawQ, mode } } } },
        { buyer: { is: { clientName: { contains: rawQ, mode } } } },
        { buyer: { is: { phones: { contains: rawQ, mode } } } },
        { phoneNumber: { contains: rawQ, mode } },
        { user: { is: { name: { contains: rawQ, mode } } } },
        { attributedAgentName: { contains: rawQ, mode } },
      ],
    });
  }

  const where: Prisma.CallLogWhereInput = {
    AND: [...scopeAnd, linkedAnd, ...filterAnd],
  };

  // ── Pagination ───────────────────────────────────────────────────────────
  const page = Math.max(1, parseInt(sp.page ?? "1") || 1);
  const skip = (page - 1) * PAGE_SIZE;

  // ── User roster for the filter dropdown ──────────────────────────────────
  // Every active, non-HR CRM user per the caller's permissions (Lalit / super
  // admins / admins / managers / agents). ADMIN → all; MANAGER → their team;
  // AGENT → none (they don't get scope pickers). Team travels with each user so
  // the client can do the Team→User cascade without another request.
  let userRoster: { id: string; name: string; team: string | null }[] = [];
  if (me.role !== "AGENT") {
    const rosterWhere: Prisma.UserWhereInput = { active: true, hrOnly: false };
    if (me.role === "MANAGER") {
      if (managerTeam) rosterWhere.team = managerTeam;
      else {
        const ids = await visibleOwnerIds(me);
        if (ids) rosterWhere.id = { in: ids };
      }
    }
    userRoster = await prisma.user.findMany({
      where: rosterWhere,
      orderBy: { name: "asc" },
      select: { id: true, name: true, team: true },
    });
  }

  const [logs, total] = await Promise.all([
    prisma.callLog.findMany({
      where,
      orderBy: { startedAt: "desc" },
      skip,
      take: PAGE_SIZE,
      include: {
        user: { select: { id: true, name: true } },
        lead: { select: { id: true, name: true, phone: true, leadOrigin: true, isColdCall: true } },
        buyer: { select: { id: true, clientName: true, phones: true, market: true } },
      },
    }),
    prisma.callLog.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Derive the display row (name · mobile · module · href) for each call.
  const rows = logs.map((log) => {
    let name = "—";
    let mobile = log.phoneNumber || "—";
    let module: SourceModule | null = null;
    let href: string | null = null;

    if (log.lead) {
      name = formatLeadName(log.lead.name);
      mobile = log.lead.phone || log.phoneNumber || "—";
      // source_module for a lead-linked CALL = the working surface it was performed
      // from (activityLeadModule) — Leads or Revival, NEVER "Master Data" (agents have
      // no Master Data calling UI; a master-origin lead is worked from the Leads queue).
      module = activityLeadModule(log.lead.leadOrigin, log.lead.isColdCall);
      href = moduleHref(module, log.lead.id);
    } else if (log.buyer) {
      name = formatLeadName(log.buyer.clientName);
      mobile = firstBuyerPhone(log.buyer.phones) || log.phoneNumber || "—";
      // source_module for a buyer-linked call = the buyer's buyerSourceModule.
      module = buyerSourceModule(log.buyer.market);
      // Both Dubai + India buyers open the SHARED buyer detail at /buyer-data/[id]
      // (the India list links there too — there is no /india-buyer-data/[id] route).
      href = `/buyer-data/${log.buyer.id}`;
    }

    return {
      id: log.id,
      startedAt: log.startedAt,
      agent: log.attributedAgentName ?? log.user?.name ?? "Unknown Agent",
      name,
      mobile,
      module,
      href,
      durationSec: log.durationSec,
      outcome: log.outcome,
      notes: log.notes,
    };
  });

  // Preserve filters when paginating.
  function pageUrl(p: number) {
    const params = new URLSearchParams();
    for (const k of ["user", "team", "module", "outcome", "state", "from", "to", "q"] as const) {
      if (sp[k]) params.set(k, sp[k]!);
    }
    params.set("page", String(p));
    return `/call-logs?${params.toString()}`;
  }

  const hasFilters = !!(sp.user || sp.team || sp.module || sp.outcome || stateParam || sp.from || sp.to || sp.q);

  // CSV export params (export route is Super-Admin only; button hidden otherwise).
  // Forward EVERY active filter under the page's own param names so the download
  // is exactly the slice on screen. (It used to send only user/from/to, so an
  // export taken while filtered by Module / Call Status / Search silently returned
  // a wider set than the operator was looking at.)
  // ?state= is forwarded here AND parsed by src/app/api/call-logs/export/route.ts
  // using the identical predicate, so a CSV taken while filtered to Pending /
  // Resolved matches the screen exactly. (Before that route learned the param it
  // ignored it and returned the wider set — measured at 5,387 extra rows.) If you
  // add a filter to this page, add it to that route in the same change.
  const exportParams = new URLSearchParams();
  for (const k of ["user", "team", "module", "outcome", "state", "from", "to", "q"] as const) {
    if (sp[k]) exportParams.set(k, sp[k]!);
  }
  const canExport = canExportData(me);

  const outcomeOpts = (Object.keys(CallOutcome) as CallOutcome[]).map((o) => ({
    value: o,
    label: outcomeLabel[o],
  }));

  const scopeLabel =
    me.role === "AGENT"
      ? " · my calls"
      : me.role === "MANAGER" && managerTeam
      ? ` · ${managerTeam} team`
      : me.role === "MANAGER"
      ? " · my team"
      : " · all modules & teams";

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold">Call Logs</h1>
          <p className="text-xs sm:text-sm text-gray-500 dark:text-slate-400">
            Centralized call history across all modules ·{" "}
            {total.toLocaleString()}{" "}
            {stateParam === "pending"
              ? `unresolved dial${total !== 1 ? "s" : ""}`
              : `${`call${total !== 1 ? "s" : ""}`}${stateParam === "resolved" ? " (resolved)" : ""}`}
            {scopeLabel}
          </p>
        </div>
        {canExport && (
          <a
            href={`/api/call-logs/export${exportParams.toString() ? `?${exportParams.toString()}` : ""}`}
            className="btn btn-ghost"
          >
            ⬇ Export CSV
          </a>
        )}
      </div>

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <CallLogFilters
        users={userRoster}
        outcomes={outcomeOpts}
        showScopePickers={me.role !== "AGENT"}
        showTeamPicker={me.role === "ADMIN"}
      />

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <div className="card overflow-x-auto">
        {rows.length === 0 ? (
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
                <th>Customer</th>
                <th>Mobile</th>
                <th>Module</th>
                <th>Duration</th>
                <th>Call Status</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-xs text-gray-500 dark:text-slate-400 font-mono">
                    {fmtIst(r.startedAt)}
                  </td>
                  <td className="text-sm font-medium">{r.agent}</td>
                  <td className="text-sm">
                    {r.href ? (
                      <Link
                        href={r.href}
                        className="text-blue-600 dark:text-blue-400 hover:underline font-medium"
                      >
                        {r.name}
                      </Link>
                    ) : (
                      <span className="text-gray-700 dark:text-slate-200">{r.name}</span>
                    )}
                  </td>
                  <td className="text-sm text-gray-600 dark:text-slate-300 whitespace-nowrap font-mono">
                    {r.mobile}
                  </td>
                  <td>
                    {r.module ? (
                      <span className={`chip ${moduleChip[r.module]}`}>{r.module}</span>
                    ) : (
                      <span className="text-gray-400 dark:text-slate-500 text-xs">—</span>
                    )}
                  </td>
                  <td className="text-sm text-gray-600 dark:text-slate-300 whitespace-nowrap">
                    {fmtDuration(r.durationSec)}
                  </td>
                  <td>
                    <span className={`chip ${outcomeChip[r.outcome]}`}>{outcomeLabel[r.outcome]}</span>
                  </td>
                  <td className="text-xs text-gray-500 dark:text-slate-400 max-w-xs truncate">
                    {r.notes ?? "—"}
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
