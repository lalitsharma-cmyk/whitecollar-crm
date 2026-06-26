import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { ActivityStatus, ActivityType, AIScore, Prisma } from "@prisma/client";
import { TERMINAL_STATUSES, CLOSING_STATUSES, statusColor } from "@/lib/lead-statuses";
import { COLD_ORIGINS } from "@/lib/leadScope";
import Link from "next/link";
import { fmtIST12, fmtISTTime12 } from "@/lib/datetime";
import { waDraftLink, WA_TEMPLATES } from "@/lib/wa";

export const dynamic = "force-dynamic";

// ── Helpers ────────────────────────────────────────────────────────────
// IST midnight today / tomorrow as UTC instants. We can't rely on JS
// startOfDay() since Vercel runs in UTC — that gives us UTC midnight which
// is +5:30h off from what the team reads on their phones.
function istDayBoundaries(): { start: Date; end: Date } {
  const now = new Date();
  // Get today's IST date string then parse it as IST midnight → UTC.
  const istDate = new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Asia/Kolkata",
  }).format(now); // "2026-05-27"
  const start = new Date(`${istDate}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function fmtBudget(min: number | null, max: number | null, currency: string): string {
  if (!min && !max) return "—";
  const fmt = (v: number) => {
    if (currency === "INR") return `₹${(v / 1e7).toFixed(1)} Cr`;
    return `${currency} ${(v / 1e6).toFixed(1)} M`;
  };
  // Range only when max is a genuine upper bound (> min); garbage maxes collapse
  // to the single value so we never show "10 M – 0 M".
  if (min && max && max > min) return `${fmt(min)}–${fmt(max)}`;
  return fmt((min ?? max)!);
}

function statusChipClass(status: string | null): string {
  return statusColor(status);
}

// ── Row shape (normalised across leads and activities) ─────────────────
type Row = {
  key: string;                  // unique React key
  leadId: string;
  leadName: string;
  phone: string | null;
  currentStatus: string | null;
  budget: { min: number | null; max: number | null; currency: string };
  primary: string;              // big bold label (activity title / next step)
  meta: string;                 // small grey line (time, type, etc.)
  followupAt: Date | null;
  // priority: lower = higher priority (used to pick the Top 5)
  priority: number;
};

function leadRow(
  l: { id: string; name: string; phone: string | null; currentStatus: string | null; budgetMin: number | null; budgetMax: number | null; budgetCurrency: string; followupDate: Date | null },
  opts: { primary: string; meta: string; priority: number; keyPrefix: string },
): Row {
  return {
    key: `${opts.keyPrefix}:${l.id}`,
    leadId: l.id,
    leadName: l.name,
    phone: l.phone,
    currentStatus: l.currentStatus,
    budget: { min: l.budgetMin, max: l.budgetMax, currency: l.budgetCurrency },
    primary: opts.primary,
    meta: opts.meta,
    followupAt: l.followupDate ?? null,
    priority: opts.priority,
  };
}

function actRow(
  a: { id: string; title: string; type: ActivityType; scheduledAt: Date | null; lead: { id: string; name: string; phone: string | null; currentStatus: string | null; budgetMin: number | null; budgetMax: number | null; budgetCurrency: string; followupDate: Date | null } },
  opts: { priority: number; keyPrefix: string },
): Row {
  const when = a.scheduledAt ? `${fmtIST12(a.scheduledAt)} IST` : "no time set";
  return {
    key: `${opts.keyPrefix}:${a.id}`,
    leadId: a.lead.id,
    leadName: a.lead.name,
    phone: a.lead.phone,
    currentStatus: a.lead.currentStatus,
    budget: { min: a.lead.budgetMin, max: a.lead.budgetMax, currency: a.lead.budgetCurrency },
    primary: a.title,
    meta: `${when} · ${a.type.replaceAll("_", " ")}`,
    followupAt: a.scheduledAt,
    priority: opts.priority,
  };
}

// ── Page ───────────────────────────────────────────────────────────────
export default async function ActivitiesPage(
  { searchParams }: { searchParams: Promise<Record<string, string | undefined>> }
) {
  const sp = await searchParams;
  // ?type= accepts a SINGLE type OR a comma-separated multi-type bucket (so the
  // Dashboard "Meetings" card — which aggregates EXPO_MEETING/OFFICE_MEETING/
  // HOME_VISIT — can drill to the exact same set its count was built from).
  const typeList = (sp.type ?? "").split(",").map(s => s.trim()).filter(Boolean) as ActivityType[];
  const typeFilter: ActivityType | null = typeList.length === 1 ? typeList[0] : null;
  const typeWhere = typeList.length === 1 ? { type: typeList[0] }
    : typeList.length > 1 ? { type: { in: typeList } }
    : {};

  const me = await requireUser();
  const isAdminOrMgr = me.role === "ADMIN" || me.role === "MANAGER";
  const scope = me.role === "AGENT" ? { ownerId: me.id } : {};
  const leadScopeAsActivityFilter = me.role === "AGENT" ? { lead: { ownerId: me.id, deletedAt: null } } : { lead: { deletedAt: null } };

  // ── Dashboard "Scheduled Today" drill alignment (count == drill) ──────────
  // The Dashboard Meetings / Site Visits / Virtual Meetings tiles count Activity
  // by the SAME attribution `meActWhere` uses (dashboard/page.tsx):
  //   • AGENT          → userId = me.id (who LOGGED the activity)
  //   • ADMIN/MANAGER  → lead's team (the ?view= selector), no userId
  // …PLUS status:PLANNED and the IST-day scheduledAt window. The generic
  // /activities "Scheduled Today" section historically scoped by lead.ownerId
  // with no status filter, so its length diverged from the tile (806 of 3,685
  // activities have userId≠ownerId). When the tile links here it passes
  // ?planned=1 (+ &view= for admin), and we reproduce the tile's EXACT where so
  // the number shown == the rows opened. Without the flag the page keeps its
  // original behaviour (general action board).
  const dashDrill = sp.planned === "1";
  const teamView = sp.view === "India" || sp.view === "Dubai" ? sp.view : null;
  // Attribution that mirrors dashboard `meActWhere` for THIS user.
  const tileAttribution: Prisma.ActivityWhereInput = isAdminOrMgr
    ? { lead: { deletedAt: null, ...(teamView ? { forwardedTeam: teamView } : {}) } }
    : { userId: me.id, lead: { deletedAt: null } };
  // "Scheduled Today" where: dashboard-drill mode reproduces the tile (attribution
  // + PLANNED); otherwise the legacy lead-ownerId scope with no status filter.
  const todayScheduledWhere: Prisma.ActivityWhereInput = dashDrill
    ? { ...tileAttribution, status: ActivityStatus.PLANNED }
    : { ...leadScopeAsActivityFilter };

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
  const { start: dayStart, end: dayEnd } = istDayBoundaries();

  const leadSelect = {
    id: true, name: true, phone: true, currentStatus: true,
    budgetMin: true, budgetMax: true, budgetCurrency: true,
    followupDate: true,
  } as const;

  const activityInclude = { lead: { select: leadSelect } } as const;

  const [
    immediateOverdueActs,
    immediateOverdueLeads,
    hotFollowups,
    slipping,
    siteVisits,
    todayScheduled,
    potentialClosures,
  ] = await Promise.all([
    // 1. Immediate — overdue planned activities
    prisma.activity.findMany({
      where: {
        ...leadScopeAsActivityFilter,
        status: ActivityStatus.PLANNED,
        scheduledAt: { lt: now },
      },
      orderBy: { scheduledAt: "asc" },
      take: 10,
      include: activityInclude,
    }),
    // 1b. Immediate — leads with overdue followupDate (status not terminal)
    prisma.lead.findMany({
      where: {
        ...scope,
        deletedAt: null,
        leadOrigin: { notIn: COLD_ORIGINS },
        followupDate: { lt: now },
        currentStatus: { notIn: TERMINAL_STATUSES },
      },
      orderBy: { followupDate: "asc" },
      take: 10,
      select: leadSelect,
    }),
    // 2. Hot follow-ups in next 24h
    prisma.lead.findMany({
      where: {
        ...scope,
        deletedAt: null,
        leadOrigin: { notIn: COLD_ORIGINS },
        aiScore: AIScore.HOT,
        followupDate: { gte: now, lte: in24h },
        currentStatus: { notIn: TERMINAL_STATUSES },
      },
      orderBy: { followupDate: "asc" },
      take: 10,
      select: leadSelect,
    }),
    // 3. Slipping — last touch > 5 days ago, active stages
    prisma.lead.findMany({
      where: {
        ...scope,
        deletedAt: null,
        leadOrigin: { notIn: COLD_ORIGINS },
        lastTouchedAt: { lt: fiveDaysAgo },
        currentStatus: { notIn: TERMINAL_STATUSES },
      },
      orderBy: { lastTouchedAt: "asc" },
      take: 10,
      select: { ...leadSelect, lastTouchedAt: true },
    }),
    // 4. Site visits in next 7 days
    prisma.activity.findMany({
      where: {
        ...leadScopeAsActivityFilter,
        type: ActivityType.SITE_VISIT,
        scheduledAt: { gte: now, lte: in7d },
      },
      orderBy: { scheduledAt: "asc" },
      take: 10,
      include: activityInclude,
    }),
    // 5. Scheduled today (IST window) — optionally filtered by type (single OR
    //    multi). This is the set the Dashboard meeting/site-visit/virtual cards
    //    count: with the dashboard drill flag (?planned=1) `todayScheduledWhere`
    //    reproduces the tile's EXACT where (userId/team attribution + PLANNED),
    //    so its length == the tile number. take:200 ≥ any realistic daily count
    //    so the rendered list can't silently truncate below the tile's count.
    prisma.activity.findMany({
      where: {
        ...todayScheduledWhere,
        scheduledAt: { gte: dayStart, lt: dayEnd },
        ...typeWhere,
      },
      orderBy: { scheduledAt: "asc" },
      take: 200,
      include: activityInclude,
    }),
    // 6. Potential closures — NEGOTIATION with eoiStage set
    prisma.lead.findMany({
      where: {
        ...scope,
        deletedAt: null,
        leadOrigin: { notIn: COLD_ORIGINS },
        currentStatus: { in: CLOSING_STATUSES },
        eoiStage: { not: null },
      },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { ...leadSelect, eoiStage: true },
    }),
  ]);

  // ── Normalise into Row[] per section ────────────────────────────────
  // priority: 1 = Immediate, 2 = Hot, 3 = Site visit, 4 = Slipping, 5 = Potential closure
  // (Scheduled-today is intentionally NOT a Top-5 source — it's a calendar view.)
  const immediateRows: Row[] = [
    ...immediateOverdueActs.map((a) =>
      actRow(a, { priority: 1, keyPrefix: "imm-act" }),
    ),
    ...immediateOverdueLeads.map((l) => {
      const overdueHrs = l.followupDate
        ? Math.round((now.getTime() - l.followupDate.getTime()) / 3600_000)
        : 0;
      const overdueTxt = overdueHrs >= 24
        ? `${Math.round(overdueHrs / 24)}d overdue`
        : `${overdueHrs}h overdue`;
      return leadRow(l, {
        primary: "Follow-up overdue",
        meta: l.followupDate ? `Was due ${fmtIST12(l.followupDate)} IST · ${overdueTxt}` : "Was due (no date)",
        priority: 1,
        keyPrefix: "imm-lead",
      });
    }),
  ].slice(0, 10);

  const hotRows: Row[] = hotFollowups.map((l) =>
    leadRow(l, {
      primary: "🔥 Hot follow-up",
      meta: l.followupDate ? `Due ${fmtIST12(l.followupDate)} IST` : "Due soon",
      priority: 2,
      keyPrefix: "hot",
    }),
  );

  const slippingRows: Row[] = slipping.map((l) => {
    const daysSince = l.lastTouchedAt
      ? Math.floor((now.getTime() - l.lastTouchedAt.getTime()) / (24 * 60 * 60 * 1000))
      : 999;
    return leadRow(l, {
      primary: `Slipping — no touch for ${daysSince}d`,
      meta: `Status: ${l.currentStatus ?? "—"}`,
      priority: 4,
      keyPrefix: "slip",
    });
  });

  const siteVisitRows: Row[] = siteVisits.map((a) =>
    actRow(a, { priority: 3, keyPrefix: "sv" }),
  );

  const todayRows: Row[] = todayScheduled.map((a) =>
    actRow(a, { priority: 99, keyPrefix: "today" }),
  );

  const closureRows: Row[] = potentialClosures.map((l) =>
    leadRow(l, {
      primary: "💎 Potential closure",
      meta: `EOI stage: ${(l as { eoiStage: string | null }).eoiStage ?? "—"}`,
      priority: 5,
      keyPrefix: "close",
    }),
  );

  // ── Top 5 across sections (dedupe per lead, keep highest-priority) ──
  const pool: Row[] = [
    ...immediateRows,
    ...hotRows,
    ...siteVisitRows,
    ...slippingRows,
    ...closureRows,
  ].sort((a, b) => a.priority - b.priority);
  const seen = new Set<string>();
  const top5: Row[] = [];
  for (const r of pool) {
    if (seen.has(r.leadId)) continue;
    seen.add(r.leadId);
    top5.push(r);
    if (top5.length >= 5) break;
  }

  const sections: { title: string; rows: Row[]; empty: string; accent: string }[] = [
    { title: "🚨 Immediate Action", rows: immediateRows, empty: "Nothing overdue — you're caught up.", accent: "border-l-red-500" },
    { title: "🔥 Hot Follow-ups (next 24h)", rows: hotRows, empty: "No hot leads due in the next 24 hours.", accent: "border-l-orange-500" },
    { title: "🕒 Slipping Leads", rows: slippingRows, empty: "No leads slipping right now — great hygiene.", accent: "border-l-amber-500" },
    { title: "🏢 Site Visits (next 7 days)", rows: siteVisitRows, empty: "No site visits booked for the next 7 days.", accent: "border-l-blue-500" },
    { title: "📅 Scheduled Today", rows: todayRows, empty: "Nothing scheduled for today.", accent: "border-l-slate-400" },
    { title: "💎 Potential Closures", rows: closureRows, empty: "No deals in EOI / negotiation yet.", accent: "border-l-emerald-500" },
  ];

  return (
    <>
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Action Board</h1>
        <p className="text-xs sm:text-sm text-gray-500">
          {me.role === "AGENT" ? "Your leads, prioritised for action." : `Team-wide view (${me.role}).`} ·{" "}
          {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" })}
        </p>
      </div>

      {/* ── Type filter banner ──────────────────────────────────────── */}
      {typeList.length > 0 && (
        <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg mb-2">
          <span className="text-sm font-semibold text-blue-800">
            {todayScheduled.length} {typeList.map(t => t.replace(/_/g, " ").toLowerCase()).join(" / ")} scheduled today
          </span>
          <a href="/activities" className="ml-auto text-xs text-blue-600 hover:underline">Clear filter ×</a>
        </div>
      )}

      {/* ── Today's Top 5 strip ─────────────────────────────────────── */}
      <section className="card p-4 border-l-4 border-l-[#c9a24b] bg-amber-50/40">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <h2 className="font-bold text-base">⭐ Today's Top 5 Actions</h2>
          <span className="text-xs text-gray-500">{top5.length} picked</span>
        </div>
        {top5.length === 0 ? (
          <div className="text-sm text-gray-500 italic">Nothing urgent — focus on prospecting today.</div>
        ) : (
          <div className="space-y-2">
            {top5.map((r) => (
              <ActionRow key={`top-${r.key}`} row={r} compact />
            ))}
          </div>
        )}
      </section>

      {/* ── Sections ────────────────────────────────────────────────── */}
      {sections.map((sec) => (
        <section key={sec.title}>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <h2 className="font-bold text-base">{sec.title}</h2>
            <span className="text-sm text-gray-500">{sec.rows.length}</span>
          </div>
          {sec.rows.length === 0 ? (
            <div className="text-sm text-gray-500 italic px-1">{sec.empty}</div>
          ) : (
            <div className="space-y-2">
              {sec.rows.map((r) => (
                <div key={r.key} className={`card p-3 border-l-4 ${sec.accent}`}>
                  <ActionRow row={r} />
                </div>
              ))}
            </div>
          )}
        </section>
      ))}
    </>
  );
}

// ── Single compact row component ──────────────────────────────────────
function ActionRow({ row, compact = false }: { row: Row; compact?: boolean }) {
  const waMsg = WA_TEMPLATES.followupEN(row.leadName.split(" ")[0] ?? row.leadName);
  const waLink = row.phone ? waDraftLink(row.phone, waMsg) : "";
  const telLink = row.phone ? `tel:${row.phone.replace(/\s+/g, "")}` : "";

  return (
    <div className={`flex items-start justify-between gap-3 flex-wrap ${compact ? "p-2 rounded-lg bg-white border border-amber-200" : ""}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/leads/${row.leadId}`} className="font-bold text-[#0b1a33] hover:underline truncate">
            {row.leadName}
          </Link>
          <span className={`chip ${statusChipClass(row.currentStatus)} text-[10px]`}>
            {row.currentStatus ?? "—"}
          </span>
          <span className="text-xs text-gray-500">{fmtBudget(row.budget.min, row.budget.max, row.budget.currency)}</span>
        </div>
        <div className="text-sm font-semibold mt-0.5">{row.primary}</div>
        <div className="text-xs text-gray-500 mt-0.5">{row.meta}</div>
      </div>
      {row.phone && (
        <div className="flex items-center gap-2 shrink-0">
          <a
            href={telLink}
            className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
          >
            📞 Call
          </a>
          <a
            href={waLink}
            target="_blank"
            rel="noopener noreferrer"
            className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700"
          >
            💬 WA
          </a>
        </div>
      )}
    </div>
  );
}
