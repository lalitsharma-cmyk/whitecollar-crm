import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { audit, reqMeta } from "@/lib/audit";
import { leadScopeWhere } from "@/lib/leadScope";
import { TERMINAL_STATUSES, CLOSED_OUTCOME_STATUSES, LOST_STATUSES } from "@/lib/lead-statuses";
import { effectiveSource } from "@/lib/sourceLabel";
import { LeadSource, LeadStatus, AIScore, Prisma } from "@prisma/client";

// CSV export — ADMIN ONLY. Every export is audited and the CSV is watermarked
// with the downloader's email + timestamp, so a leaked file traces back to
// the person who took it.
//
// The leads case mirrors the filter logic in src/app/(app)/leads/page.tsx
// exactly, so what an admin sees on /leads (with whatever filters applied) is
// what they get in the CSV. Every filter param used is recorded in the audit
// log, so we can answer "who exported what subset, when".

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  // Quote anything containing comma, double-quote, CR, or LF — and double-up
  // any embedded quotes per RFC 4180.
  return /[,"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const lines = [headers.join(",")];
  for (const r of rows) lines.push(headers.map((h) => csvEscape(r[h])).join(","));
  // RFC 4180: CRLF line endings — Excel on Windows and macOS both prefer this.
  return lines.join("\r\n");
}

// IST = UTC+5:30. We render all timestamps in the CSV in IST ISO form
// (with a "+05:30" suffix) because the entire team operates from IST/Dubai
// and raw UTC strings have caused "off-by-day" reading errors in past exports.
const IST_OFFSET_MS = 330 * 60 * 1000;
function istIso(d: Date | null | undefined): string {
  if (!d) return "";
  const shifted = new Date(d.getTime() + IST_OFFSET_MS);
  // Drop the trailing "Z", swap in the +05:30 offset.
  return shifted.toISOString().replace(/Z$/, "+05:30");
}

// ── Master Data export — full DB, category-scoped (admin only) ──────────────
// Mirrors src/app/(app)/master-data/page.tsx so the CSV == the on-screen view,
// INCLUDING deleted/archived categories (the normal export forces deletedAt:null).
const MASTER_WORKABLE_OR: Prisma.LeadWhereInput[] = [
  { currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } },
];
function masterCatWhere(cat: string): Prisma.LeadWhereInput {
  switch (cat) {
    case "workable": return { deletedAt: null, OR: MASTER_WORKABLE_OR };
    case "closed":   return { deletedAt: null, currentStatus: { in: CLOSED_OUTCOME_STATUSES } };
    case "lost":     return { deletedAt: null, currentStatus: { in: LOST_STATUSES } };
    case "deleted":  return { deletedAt: { not: null }, OR: [{ importBatchId: null }, { importBatch: { is: { status: { not: "DELETED" } } } }] };
    case "archived": return { deletedAt: { not: null }, importBatch: { is: { status: "DELETED" } } };
    default:         return {};
  }
}
function masterDataWhere(sp: Record<string, string | undefined>): Prisma.LeadWhereInput {
  const cold: Prisma.LeadWhereInput = sp.cold === "only" ? { isColdCall: true } : sp.cold === "all" ? {} : { isColdCall: false };
  const and: Prisma.LeadWhereInput[] = [masterCatWhere(sp.cat ?? "all")];
  if (sp.team === "India" || sp.team === "Dubai") and.push({ forwardedTeam: sp.team });
  if (sp.owner === "unassigned") and.push({ ownerId: null });
  else if (sp.owner) and.push({ ownerId: sp.owner });
  if (sp.source) and.push({ source: sp.source as LeadSource });
  if (sp.q) and.push({ OR: [
    { name: { contains: sp.q, mode: "insensitive" } },
    { phone: { contains: sp.q } },
    { email: { contains: sp.q, mode: "insensitive" } },
    { company: { contains: sp.q, mode: "insensitive" } },
  ] });
  return { ...cold, AND: and };
}

export async function GET(req: NextRequest) {
  const me = await requireRole("ADMIN");
  const url = new URL(req.url);
  const sp = Object.fromEntries(url.searchParams.entries()) as Record<string, string | undefined>;
  const type = sp.type ?? "leads";

  let csv = "", filename = "export.csv", rowCount = 0;
  let appliedFilters: Record<string, string> = {};

  if (type === "leads") {
    // ── Mirror /leads/page.tsx where-clause construction ──────────────────
    // Admin sees all (leadScopeWhere returns {} for ADMIN), but we still
    // call it so any future ownership rules stay in sync automatically.
    const scope = await leadScopeWhere(me);
    const where: Prisma.LeadWhereInput = sp.showCold === "1"
      ? { ...scope }
      : { ...scope, isColdCall: false };

    // Mirror the working Leads view: export WORKABLE leads only by default
    // (both rejected/lost AND closed outcomes are excluded — they belong to
    // Master Data), and honour the My/India/Dubai/All segment selector. An
    // explicit ?filter=closed|lost exports that bucket; ?cstatus= overrides.
    const seg = sp.seg ?? "mine";
    if (seg === "mine") where.ownerId = me.id;
    else if (seg === "india") where.forwardedTeam = "India";
    else if (seg === "dubai") where.forwardedTeam = "Dubai";

    const filterTab = sp.filter ?? "all";
    if (sp.cstatus) {
      const vals = sp.cstatus.split(",").map((s) => s.trim()).filter(Boolean);
      where.currentStatus = vals.length === 1 ? vals[0] : { in: vals };
    } else if (filterTab === "closed" || filterTab === "booked" || filterTab === "won" || filterTab === "bookings") {
      where.currentStatus = { in: CLOSED_OUTCOME_STATUSES };
    } else if (filterTab === "lost" || filterTab === "rejected") {
      where.currentStatus = { in: LOST_STATUSES };
    } else {
      // WORKABLE default — include null/blank-status (fresh) leads. A plain
      // notIn drops NULLs in SQL, which would hide unclassified leads.
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : []),
        { OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: TERMINAL_STATUSES } }] },
      ];
    }

    if (sp.q) {
      where.OR = [
        { name: { contains: sp.q, mode: "insensitive" } },
        { phone: { contains: sp.q } },
        { email: { contains: sp.q, mode: "insensitive" } },
        { company: { contains: sp.q, mode: "insensitive" } },
      ];
    }
    // Admin can always filter by source (the /leads guard against AGENT
    // doesn't apply here — this endpoint is ADMIN-only).
    if (sp.source) where.source = sp.source as LeadSource;
    if (sp.status) where.status = sp.status as LeadStatus;
    if (sp.ai) where.aiScore = sp.ai as AIScore;
    if (sp.team) where.forwardedTeam = sp.team;
    if (sp.owner === "unassigned") where.ownerId = null;
    else if (sp.owner) where.ownerId = sp.owner;
    if (sp.when === "24h") where.createdAt = { gte: new Date(Date.now() - 24 * 3600 * 1000) };
    else if (sp.when === "7d") where.createdAt = { gte: new Date(Date.now() - 7 * 24 * 3600 * 1000) };
    else if (sp.when === "30d") where.createdAt = { gte: new Date(Date.now() - 30 * 24 * 3600 * 1000) };
    else if (sp.when === "overdue") where.lastTouchedAt = { lt: new Date(Date.now() - 5 * 24 * 3600 * 1000) };

    // EOI filters
    if (sp.eoi === "active") where.eoiStage = { not: null };
    else if (sp.eoi === "kyc_pending") where.kycStatus = "PENDING";
    else if (sp.eoi === "approval_needed") where.eoiApprovalRequired = true;
    else if (sp.eoi === "stuck") {
      where.bookingDoneAt = null;
      where.eoiCollectedAt = { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000), not: null };
    }

    // not-picked-N-days filter
    const notPickedDays = sp.notPicked ? parseInt(sp.notPicked) : null;
    if (notPickedDays && [2, 3, 5, 7, 14].includes(notPickedDays)) {
      const since = new Date(Date.now() - notPickedDays * 24 * 3600 * 1000);
      where.callLogs = {
        some: {
          outcome: { in: ["NOT_PICKED", "SWITCHED_OFF", "BUSY"] },
          startedAt: { gte: since },
        },
        none: {
          outcome: { in: ["CONNECTED", "INTERESTED"] },
          startedAt: { gte: since },
        },
      };
    }

    // ── Follow-up date filter (with the same "default to today" behaviour
    //    as /leads — so an admin who hits Export with no params gets the
    //    same set they're looking at on the page). ──
    const nowISTBoundary = new Date(Date.now() + IST_OFFSET_MS);
    const istMidnight = new Date(nowISTBoundary); istMidnight.setUTCHours(0, 0, 0, 0);
    const istWindow = (offsetDays: number) => {
      const start = new Date(istMidnight); start.setUTCDate(start.getUTCDate() + offsetDays);
      const end = new Date(start); end.setUTCDate(end.getUTCDate() + 1);
      return {
        gte: new Date(start.getTime() - IST_OFFSET_MS),
        lt:  new Date(end.getTime()   - IST_OFFSET_MS),
      };
    };

    const hasOtherFilter = !!(sp.q || sp.source || sp.status || sp.owner || sp.team || sp.score || sp.notPicked || sp.eoi);
    const effectiveFollowup = sp.followup ?? (hasOtherFilter ? "all" : "today");

    if (effectiveFollowup === "today") {
      where.followupDate = istWindow(0);
    } else if (effectiveFollowup === "tomorrow") {
      where.followupDate = istWindow(1);
    } else if (effectiveFollowup === "overdue") {
      where.followupDate = { lt: new Date(), not: null };
    } else if (effectiveFollowup === "week") {
      where.followupDate = { gte: new Date(), lte: new Date(Date.now() + 7 * 24 * 3600 * 1000) };
    } else if (effectiveFollowup === "month") {
      where.followupDate = { gte: new Date(), lte: new Date(Date.now() + 30 * 24 * 3600 * 1000) };
    }

    // Smart-filter presets — must AND with everything else, never replace.
    const smartAnd: Prisma.LeadWhereInput[] = [];
    if (sp.smart === "hot_today") {
      smartAnd.push({ aiScore: AIScore.HOT });
      smartAnd.push({ createdAt: { gte: istWindow(0).gte } });
    } else if (sp.smart === "ghosting") {
      smartAnd.push({ lastTouchedAt: { lt: new Date(Date.now() - 7 * 24 * 3600 * 1000) } });
      smartAnd.push({ status: { notIn: [LeadStatus.WON, LeadStatus.LOST] } });
    } else if (sp.smart === "visit_potential") {
      smartAnd.push({ status: { in: [LeadStatus.QUALIFIED, LeadStatus.SITE_VISIT] } });
    } else if (sp.smart === "high_budget") {
      smartAnd.push({
        OR: [
          { budgetCurrency: "AED", budgetMin: { gte: 5_000_000 } },
          { budgetCurrency: "INR", budgetMin: { gte: 30_000_000 } },
        ],
      });
    }
    if (smartAnd.length > 0) {
      where.AND = where.AND ? [...(Array.isArray(where.AND) ? where.AND : [where.AND]), ...smartAnd] : smartAnd;
    }

    // Tag filter — comma-separated `tags` column → substring match.
    if (sp.tag) {
      const tagFilter: Prisma.LeadWhereInput = { tags: { contains: sp.tag } };
      where.AND = where.AND
        ? [...(Array.isArray(where.AND) ? where.AND : [where.AND]), tagFilter]
        : [tagFilter];
    }

    // Capture filter params for the audit log (only those actually applied,
    // not the noise of empty/undefined values).
    const filterKeys = ["q","source","status","ai","team","owner","when","eoi","notPicked","followup","smart","tag","showCold"] as const;
    appliedFilters = Object.fromEntries(
      filterKeys.flatMap((k) => (sp[k] ? [[k, String(sp[k])]] : []))
    );
    // Record the *effective* followup too (it differs from sp.followup when
    // the default-to-today behaviour kicks in).
    appliedFilters._effectiveFollowup = effectiveFollowup;

    // Master Data export (admin) bypasses the workable/seg/followup defaults and
    // exports exactly the requested category — including deleted/archived.
    const effectiveWhere = sp.master === "1" ? masterDataWhere(sp) : where;
    const leads = await prisma.lead.findMany({
      where: effectiveWhere,
      include: { owner: true },
      orderBy: { createdAt: "desc" },
    });
    rowCount = leads.length;
    csv = toCsv(leads.map((l) => ({
      id: l.id,
      name: l.name,
      phone: l.phone,
      altPhone: l.altPhone,
      email: l.email,
      company: l.company,
      profession: l.profession,
      city: l.city,
      country: l.country,
      team: l.forwardedTeam,
      source: effectiveSource(l.sourceRaw, l.source),
      currentStatus: l.currentStatus,
      status: l.status,
      aiScore: l.aiScore,
      aiScoreValue: l.aiScoreValue,
      bantStatus: l.bantStatus,
      budgetMin: l.budgetMin,
      budgetMax: l.budgetMax,
      budgetCurrency: l.budgetCurrency,
      configuration: l.configuration,
      ownerName: l.owner?.name ?? "",
      tags: l.tags,
      followupDate: istIso(l.followupDate),
      lastTouchedAt: istIso(l.lastTouchedAt),
      createdAt: istIso(l.createdAt),
      linkedInUrl: l.linkedInUrl,
      rejectionReason: l.rejectionReason,
      rejectedAt: istIso(l.rejectedAt),
    })));
    filename = `wcr-leads-filtered-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}.csv`;
  } else if (type === "calls") {
    // Per Lalit's feedback (2026-06): the CSV export must NOT carry an
    // "Agents" / agent-name column — exports were getting forwarded to
    // brokers and partners, and agent attribution was leaking. We still
    // pull `user` for any future auditing, but omit it from the rendered row.
    const calls = await prisma.callLog.findMany({ include: { lead: true, user: true } });
    rowCount = calls.length;
    csv = toCsv(calls.map(c => ({
      id: c.id, startedAt: c.startedAt.toISOString(), lead: c.lead?.name ?? c.phoneNumber,
      direction: c.direction, outcome: c.outcome, durationSec: c.durationSec,
      notes: c.notes,
    })));
    filename = `calls-${new Date().toISOString().slice(0, 10)}.csv`;
  } else {
    return NextResponse.json({ error: "Unknown type" }, { status: 400 });
  }

  // Watermark — first 3 lines are a comment header. Excel ignores them as long
  // as they start with "#"; lets us trace any leaked CSV back to the downloader.
  const stamp = new Date().toISOString();
  const filterSummary = type === "leads" && Object.keys(appliedFilters).length > 0
    ? Object.entries(appliedFilters).map(([k, v]) => `${k}=${v}`).join(" · ")
    : "(no filters)";
  const watermark = [
    `# Confidential export from White Collar Realty CRM`,
    `# Downloaded by: ${me.email} (${me.name}) at ${stamp}`,
    `# Type: ${type}  ·  Rows: ${rowCount}  ·  Sharing this file outside the company breaches the Data Handling policy.`,
    ...(type === "leads" ? [`# Filters: ${filterSummary}`] : []),
    "",
  ].join("\r\n");

  // End-of-file watermark row — required so a CSV that's been truncated
  // (e.g. attached to an email with a chunk dropped) still carries the
  // exporter's name. Kept distinct from the header watermark so even a
  // copy-paste of just the rows loses the trail unless the bottom row stays.
  const footer = `\r\n# Exported by ${me.name} at ${stamp} — confidential\r\n`;

  await audit({
    userId: me.id,
    action: `export.${type}`,
    entity: type === "leads" ? "Lead" : "CallLog",
    meta: {
      rowCount,
      filename,
      ...(type === "leads" ? { filters: appliedFilters } : {}),
    },
    request: reqMeta(req),
  });

  return new Response(watermark + csv + footer, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
