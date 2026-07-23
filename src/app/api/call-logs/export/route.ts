import { type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/auth";
import { canExportData, EXPORT_DENIED } from "@/lib/exportPerms";
import { normalizeTeam } from "@/lib/teamRouting";
import { visibleOwnerIds } from "@/lib/leadScope";
import { formatLeadName } from "@/lib/leadName";
import { audit, reqMeta } from "@/lib/audit";
import { CallOutcome, Prisma } from "@prisma/client";
import { PENDING_CALL_OUTCOMES } from "@/lib/ghosting";
import {
  activityLeadModule,
  buyerSourceModule,
  isBuyerModule,
  ACTIVITY_SOURCE_MODULES,
  type SourceModule,
} from "@/lib/moduleSource";

// CSV export for call logs — the download of EXACTLY what the Call Logs page shows.
//
// ── CROSS-MODULE (2026-07-18) ────────────────────────────────────────────────
// CallLog is the ONE central call table: Leads / Master Data / Revival write it
// via leadId, Buyer Data via buyerId. This export used to `include: { lead }`
// only, so every buyer-linked call exported as a blank name + blank phone (and
// there was no Module column at all). It now renders BOTH linkages:
//   • lead-linked  → lead.name / lead.phone   · module = activityLeadModule()
//   • buyer-linked → buyer.clientName / first buyer phone · module = buyerSourceModule()
// A row linked to NEITHER (unmatched telephony) is excluded by the same
// `linkedAnd` predicate the page uses, and would still render safely if it
// somehow appeared — every field is optional-chained.
//
// ── KEEP IN SYNC WITH src/app/(app)/call-logs/page.tsx ───────────────────────
// The role scope, the linked-record predicate, the 7 filters and the IST date
// math below are a deliberate MIRROR of the page's query. If the two diverge,
// "Export CSV" silently returns a different set than the operator is looking at
// — which is exactly the class of bug this file just had. Change both together.
// (Follow-up worth doing: extract the shared builder into src/lib/ so the mirror
// is impossible to break — see the report.)
//
// ROLE SCOPE (server-enforced, by ACTOR — CallLog.userId, not lead ownership):
//   AGENT   → their own calls   MANAGER → their team's   ADMIN → everything
// Note the route is ALSO gated to Super Admin by canExportData(), so in practice
// only the owner reaches it; the scope branches are defence in depth.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // 330 minutes

/** Hard cap on exported rows (memory + response-size guard). Truncation is audited. */
const MAX_ROWS = 50000;

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  // RFC 4180: wrap in double-quotes if value contains comma, quote, CR or LF.
  // Escape embedded double-quotes by doubling them.
  return /[,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toIstDate(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  const mo = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const day = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

function toIstTime(d: Date): string {
  const ist = new Date(d.getTime() + IST_OFFSET_MS);
  const h = String(ist.getUTCHours()).padStart(2, "0");
  const m = String(ist.getUTCMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

// Mirror of call-logs/page.tsx firstBuyerPhone — BuyerRecord.phones is a JSON
// array of strings (["+9715…", …]); tolerate a bare string for legacy rows.
function firstBuyerPhone(phones: string | null): string | null {
  if (!phones) return null;
  try {
    const arr = JSON.parse(phones);
    if (Array.isArray(arr)) {
      const first = arr.map((p) => String(p ?? "").trim()).find(Boolean);
      return first ?? null;
    }
  } catch {
    /* not JSON — fall through to the raw string */
  }
  const t = phones.trim();
  return t || null;
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) {
    return new Response("Unauthorized", { status: 401 });
  }
  // Owner-only (Super Admin). Call logs are sensitive customer-contact data — a
  // regular ADMIN (e.g. Sameer), MANAGER, or AGENT must NOT export, even via URL.
  if (!canExportData(me)) {
    return new Response(EXPORT_DENIED, { status: 403 });
  }

  const url = new URL(req.url);
  const sp = url.searchParams;
  // ── DATE WINDOW — byte-mirror of call-logs/page.tsx (Lalit P0, 2026-07-18) ──
  // That page now DEFAULTS TO TODAY when no range is given, and forwards the
  // RESOLVED dates here. This fallback covers a hand-typed or older saved URL
  // that carries neither: without it such a request would export all time from a
  // screen that shows one day — the same export-vs-screen divergence that was
  // just closed for ?state= (measured at 5,387 leaked rows). ?range=all is the
  // explicit unbounded view and must stay unbounded on both sides.
  const rangeAll = sp.get("range") === "all";
  const istToday = new Date(Date.now() + IST_OFFSET_MS).toISOString().slice(0, 10);
  const rawFrom = sp.get("from");
  const rawTo = sp.get("to");
  const fromParam = rangeAll ? null : rawFrom || (rawTo ? null : istToday);
  const toParam = rangeAll ? null : rawTo || (rawFrom ? null : istToday);
  // `user` is the page's own param name; `userId` is kept for older saved links.
  const userParam = sp.get("user") ?? sp.get("userId") ?? undefined;
  const teamParam = sp.get("team") ?? undefined;
  const moduleParam = (sp.get("module") ?? "") as SourceModule | "";
  const outcomeParam = sp.get("outcome") ?? undefined;
  // ?state= — byte-mirror of call-logs/page.tsx. "pending" and "resolved" pin those
  // sets; ANY other value (including an ABSENT param) is the DEFAULT which — exactly
  // like the page — EXCLUDES unresolved dials (a PENDING dial counts as nothing, so it
  // is never in the default table/CSV). Only the "Unresolved Dials" view
  // (?state=pending) surfaces them. The export must match the screen.
  const stateRaw = sp.get("state");
  const stateParam = stateRaw === "pending" || stateRaw === "resolved" ? stateRaw : "";
  const rawQ = (sp.get("q") ?? "").trim();

  const managerTeam = me.role === "MANAGER" ? normalizeTeam(me.team ?? undefined) : null;

  // ── ROLE SCOPE ───────────────────────────────────────────────────────────
  const scopeAnd: Prisma.CallLogWhereInput[] = [];
  if (me.role === "AGENT") {
    scopeAnd.push({ userId: me.id });
  } else if (me.role === "MANAGER") {
    if (managerTeam) {
      scopeAnd.push({ user: { team: managerTeam } });
    } else {
      const ids = await visibleOwnerIds(me);
      if (ids) scopeAnd.push({ userId: { in: ids } });
    }
  }
  // ADMIN → no scope predicate.

  // ── Cross-module inclusion — a call counts when its linked Lead OR its linked
  // Buyer is live. Unlinked calls stay out (same rule as the page). ──
  const linkedAnd: Prisma.CallLogWhereInput = {
    OR: [{ lead: { deletedAt: null } }, { buyer: { deletedAt: null } }],
  };

  // ── Filters (mirror of the page) ─────────────────────────────────────────
  const filterAnd: Prisma.CallLogWhereInput[] = [];

  if (userParam) filterAnd.push({ userId: userParam });

  const teamFilter = normalizeTeam(teamParam);
  if (teamFilter && me.role === "ADMIN") filterAnd.push({ user: { team: teamFilter } });

  if (outcomeParam && (Object.keys(CallOutcome) as string[]).includes(outcomeParam)) {
    filterAnd.push({ outcome: outcomeParam as CallOutcome });
  }

  // ── Call STATE (?state=) — resolved vs unresolved dial ────────────────────
  // PENDING = INITIATED | RINGING: a CallLog written the instant the Call button
  // was tapped, before any result. "resolved" = every other outcome.
  //
  // The page FORWARDS ?state= on the Export CSV link; this route used to ignore
  // it, so a CSV taken while filtered to Pending/Resolved silently returned the
  // WIDER set the operator was NOT looking at. Applied for every role, exactly as
  // the page applies it (deliberately NOT gated like ?team=, which is ADMIN-only).
  //
  // Independent of ?outcome= above — pinning a status does NOT clear the state,
  // in this route or on the page. `?outcome=CONNECTED&state=pending` therefore
  // ANDs to zero rows on BOTH surfaces. That is the honest mirror: an empty CSV
  // for an on-screen empty list. Special-casing it here would REINTRODUCE the very
  // divergence this block exists to remove.
  if (stateParam === "pending") {
    filterAnd.push({ outcome: { in: [...PENDING_CALL_OUTCOMES] } });
  } else {
    // DEFAULT + "resolved" → exclude unresolved dials (mirrors the page: a pending
    // dial counts as nothing, so it is never in the default CSV; ?state=pending shows it).
    filterAnd.push({ outcome: { notIn: [...PENDING_CALL_OUTCOMES] } });
  }

  // Date range — ?from / ?to are YYYY-MM-DD in IST, matching the page's filter
  // bar. No implicit default window: the export returns exactly the page's set,
  // so an unfiltered export is the full (capped) history rather than a silent
  // last-30-days slice that hid every historical buyer call.
  if (fromParam || toParam) {
    const dateFilter: Prisma.DateTimeFilter<"CallLog"> = {};
    if (fromParam) {
      dateFilter.gte = new Date(new Date(`${fromParam}T00:00:00Z`).getTime() - IST_OFFSET_MS);
    }
    if (toParam) {
      dateFilter.lt = new Date(
        new Date(`${toParam}T00:00:00Z`).getTime() - IST_OFFSET_MS + 24 * 3600 * 1000,
      );
    }
    filterAnd.push({ startedAt: dateFilter });
  }

  // Module filter — the 4 ACTIVITY modules. Buyer modules → buyer.market;
  // lead modules → leadOrigin/isColdCall. A CALL is never "Master Data" (agents
  // have no Master Data calling UI), so a master-origin lead's calls fall under
  // "Leads" — matching the per-row label below.
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
      filterAnd.push({
        lead: { is: { deletedAt: null, isColdCall: false, leadOrigin: { notIn: ["COLD", "REVIVAL"] } } },
      });
    }
  }

  // Search — customer name (lead.name / buyer.clientName), mobile (call number,
  // lead.phone, buyer.phones), or agent name (user.name / attributedAgentName).
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

  const where: Prisma.CallLogWhereInput = { AND: [...scopeAnd, linkedAnd, ...filterAnd] };

  const [logs, matched] = await Promise.all([
    prisma.callLog.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: MAX_ROWS,
      include: {
        user: { select: { name: true } },
        lead: { select: { name: true, phone: true, leadOrigin: true, isColdCall: true } },
        buyer: { select: { clientName: true, phones: true, market: true } },
      },
    }),
    prisma.callLog.count({ where }),
  ]);

  const HEADER =
    "Date,Time,Agent,Module,Customer Name,Phone,Direction,Outcome,Duration (sec),Recording,Notes";

  const rows = logs.map((log) => {
    // Derive customer + module from whichever record the call is linked to.
    // Defensive: a call linked to NEITHER still exports as a blank-customer row
    // with an empty Module rather than throwing.
    let customer = "";
    let phone = log.phoneNumber ?? "";
    let module = "";

    if (log.lead) {
      customer = formatLeadName(log.lead.name);
      phone = log.lead.phone || log.phoneNumber || "";
      module = activityLeadModule(log.lead.leadOrigin, log.lead.isColdCall);
    } else if (log.buyer) {
      customer = formatLeadName(log.buyer.clientName);
      phone = firstBuyerPhone(log.buyer.phones) || log.phoneNumber || "";
      module = buyerSourceModule(log.buyer.market);
    }

    return [
      toIstDate(log.startedAt),
      toIstTime(log.startedAt),
      log.attributedAgentName ?? log.user?.name ?? "Unknown Agent",
      module,
      customer,
      phone,
      log.direction,
      log.outcome,
      log.durationSec != null ? String(log.durationSec) : "",
      log.recordingUrl ?? "",
      log.notes ?? "",
    ]
      .map(csvEscape)
      .join(",");
  });

  const csvString = [HEADER, ...rows].join("\r\n");

  // Audit the export (who · when · IP · device · row count · every filter that
  // shaped it) — this is a real exfiltration surface, so the audit records the
  // exact slice taken, plus whether the row cap truncated it.
  await audit({
    userId: me.id,
    action: "data.export.call-logs",
    entity: "CallLog",
    meta: {
      rowCount: logs.length,
      matchedRows: matched,
      truncated: matched > logs.length,
      filename: "call-logs.csv",
      from: fromParam ?? null,
      to: toParam ?? null,
      userIdFilter: userParam ?? null,
      teamFilter: teamParam ?? null,
      moduleFilter: moduleParam || null,
      outcomeFilter: outcomeParam ?? null,
      stateFilter: stateParam || null,
      search: rawQ || null,
    },
    request: reqMeta(req),
  });

  return new Response(csvString, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="call-logs.csv"',
    },
  });
}
