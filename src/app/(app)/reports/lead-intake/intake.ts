// ─────────────────────────────────────────────────────────────────────────────
// Lead Source Intake Report — shared builder (page + export route).
//
// THE ONE DESIGN RULE — count == records, by construction.
// Every number this module produces is computed with the SAME where-clause the
// number's DRILL TARGET list applies for the URL params the drill carries:
//
//   • "Leads" module      → /leads. That page hand-replicates its filters inline
//     (it does NOT call leadFilterWhere): dateFrom/dateTo are parsed as IST day
//     boundaries (T00:00:00+05:30 / T23:59:59+05:30, leads/page.tsx ~471-477),
//     ?source= is sourceRaw verbatim (ignored for AGENTs), ?team= is
//     forwardedTeam, ?filter=closed|lost pins CLOSED_OUTCOME/LOST statuses, and
//     the page's base envelope is leadScopeWhere(me) + isColdCall:false +
//     leadOrigin notIn COLD_ORIGINS + the workable-status OR (unless a status
//     filter is present). Every /leads drill also carries followup=all (else the
//     page defaults to the "Today + Overdue" narrowing) and seg=all (else an
//     ADMIN lands on "My Leads"). The ?bucket= engine param is IGNORED on /leads.
//   • "Master Data" module → /master-data (ADMIN-only console). cat=all →
//     {deletedAt:null} + isColdCall:false + leadOrigin notIn COLD_ORIGINS +
//     leadFilterWhere(sp) — including the ?bucket=lost|converted|assigned|
//     unassigned lifecycle drill param.
//   • "Revival" module    → /cold-calls. baseScope (admin/mgr: {}, agent:
//     {ownerId}) + {deletedAt:null, rejectedAt:null, OR:[origin cold |
//     isColdCall:true]} + leadFilterWhere(sp minus status). bucket= works here
//     too, but the page base already pins rejectedAt:null, so bucket=lost there
//     means "LOST status, not rejected" — our revival Lost count uses exactly
//     that composition.
//   • Buyer modules       → /buyer-data + /india-buyer-data. Both parse
//     ?dateFrom/?dateTo via istDayRange (IST days, end-exclusive) + ?source=
//     verbatim BuyerRecord.source equality, and the list's ?tab=all|pool|
//     assigned|converted|rejected selects the poolStatus slice.
//
// Date bucketing is IST (istDayRange / istDateKey), weeks Mon-start IST.
// The shared engine (leadFilterWhere) now parses ?dateFrom/?dateTo through the
// SAME istDayRange boundaries ({gte: start-of-from-day, lt: end-of-to-day,
// exclusive}), /leads parses the params as IST inline, and the buyer lists use
// istDayRange too — so this report's istWindow() equals every drill target's
// window instant-for-instant.
//
// UNCLASSIFIED DATA (Lalit directive 2026-07-16): records with a missing/
// unusable source, team, or status are never silently force-bucketed. They
// surface as their own visible buckets — "Unclassified (no source)",
// "Unclassified (no team)", "Missing status" — excluded from every named
// category's count, so they update automatically once classified. Where no
// list affordance exists for the gap, the bucket links to the list WITHOUT
// that filter (an honest superset) or stays unlinked — never a fake filter.
// ─────────────────────────────────────────────────────────────────────────────
import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { leadFilterWhere } from "@/lib/leadFilterWhere";
import { leadScopeWhere, COLD_ORIGINS, WORKABLE_STATUS_OR } from "@/lib/leadScope";
import {
  buyerScopeWhereForMarket,
  canAccessBuyerMarket,
  teamForBuyerMarket,
  type BuyerMarket,
} from "@/lib/buyerScope";
import { CLOSED_OUTCOME_STATUSES, LOST_STATUSES } from "@/lib/lead-statuses";
import { istDateKey, istDayRange, istWeekday, isValidDateKey } from "@/lib/datetime";
import { effectiveSource } from "@/lib/sourceLabel";
import { normalizeTeam } from "@/lib/teamRouting";

// ── Types ────────────────────────────────────────────────────────────────────

export type Grain = "daily" | "weekly" | "monthly" | "yearly" | "custom";
export type ModuleId = "all" | "leads" | "master" | "revival" | "dubai-buyer" | "india-buyer";
export type TeamId = "all" | "Dubai" | "India";

export interface IntakeUser {
  id: string;
  role: "ADMIN" | "MANAGER" | "AGENT" | string;
  team?: string | null;
}

export interface IntakeParams {
  grain: Grain;
  /** Effective bucket grain (custom resolves to a real grain by span). */
  bucketGrain: Exclude<Grain, "custom">;
  fromKey: string; // IST "YYYY-MM-DD" inclusive
  toKey: string;   // IST "YYYY-MM-DD" inclusive
  team: TeamId;    // MANAGER is locked to their own team
  module: ModuleId;
  source: string;  // "all" or a verbatim sourceRaw value
  /** Mirrors the /leads privacy gate: AGENTs may not filter/see source. */
  canSeeSource: boolean;
  teamLocked: boolean;
  moduleOptions: ModuleId[];
}

/** One clickable number. `parts` render as per-module chips when the number is
 *  a cross-module sum (module=all) — each part IS an exact drill. */
export interface Cell {
  n: number;
  href?: string;
  note?: string;
  parts?: { label: string; n: number; href?: string }[];
}

export interface Bucket {
  key: string;
  label: string;
  fromKey: string; // clamped to the report range → drill == counted rows
  toKey: string;
}

export interface SourceRow {
  key: string;          // verbatim sourceRaw ("" = unknown bucket)
  label: string;
  count: Cell;
  pct: number;
  converted: Cell | null; // null → "—" (buyer modules)
  convPct: number | null;
}

export interface TableRow { label: string; count: Cell; pct: number; }

export interface IntakeReport {
  params: IntakeParams;
  rangeLabel: string;
  buckets: Bucket[];
  summary: {
    total: Cell;
    today: Cell;
    assigned: Cell;
    unassigned: Cell;
    converted: Cell;
    lost: Cell;               // status-lost part (linked) …
    lostRemainder: Cell | null; // … + rejected-only remainder (separate, per contract)
  };
  /** Buyer strip under module=all (each market the viewer can access). */
  buyerStrips: {
    market: BuyerMarket;
    label: string;
    total: Cell; pool: Cell; assigned: Cell; converted: Cell; rejected: Cell;
  }[];
  sourceRows: SourceRow[];   // hidden for AGENTs by the page
  dateRows: { bucket: Bucket; count: Cell; pct: number }[];
  chart: { bucket: Bucket; n: number; href: string }[];
  teamRows: TableRow[];
  moduleRows: { id: ModuleId; label: string; count: Cell; note?: string }[];
  /** "Missing status" visible bucket (Lalit's unclassified-data directive) —
   *  records with no currentStatus. Counted in Total, in NO lifecycle card. */
  unstatused: Cell | null;
  /** Source × date-bucket cross-tab (same envelopes as the page) for the export. */
  sourceBucketMatrix: {
    label: string;
    perBucket: number[];
    total: number;
    converted: number | null;
    convPct: number | null;
  }[];
  sourceOptions: string[];
  flags: string[];
  isBuyerView: boolean;
  totalsByBucketMax: number;
}

// ── Small date-key helpers (calendar math on "YYYY-MM-DD" keys is TZ-free) ───

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function addDaysKey(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function mondayOf(key: string): string {
  // istWeekday of the instant that starts this IST day == the key's weekday.
  const wd = istWeekday(new Date(`${key}T00:00:00+05:30`)); // 0=Sun…6=Sat
  return addDaysKey(key, wd === 0 ? -6 : 1 - wd);
}
function monthStart(key: string): string { return `${key.slice(0, 7)}-01`; }
function addMonthsKey(key: string, n: number): string {
  const y = parseInt(key.slice(0, 4)), m = parseInt(key.slice(5, 7));
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}-01`;
}
function monthEnd(key: string): string { return addDaysKey(addMonthsKey(monthStart(key), 1), -1); }
function fmtDayShort(key: string): string { return `${parseInt(key.slice(8, 10))} ${MONTHS_SHORT[parseInt(key.slice(5, 7)) - 1]}`; }
function fmtDayFull(key: string): string { return `${fmtDayShort(key)} ${key.slice(0, 4)}`; }
const minKey = (a: string, b: string) => (a < b ? a : b);
const maxKey = (a: string, b: string) => (a > b ? a : b);

function bucketKeyFor(dateKey: string, grain: Exclude<Grain, "custom">): string {
  if (grain === "daily") return dateKey;
  if (grain === "weekly") return mondayOf(dateKey);
  if (grain === "monthly") return dateKey.slice(0, 7);
  return dateKey.slice(0, 4);
}

function buildBuckets(grain: Exclude<Grain, "custom">, fromKey: string, toKey: string): Bucket[] {
  const out: Bucket[] = [];
  if (grain === "daily") {
    for (let k = fromKey; k <= toKey; k = addDaysKey(k, 1)) {
      out.push({ key: k, label: fmtDayShort(k), fromKey: k, toKey: k });
      if (out.length > 400) break; // hard safety; range resolution caps earlier
    }
  } else if (grain === "weekly") {
    for (let mon = mondayOf(fromKey); mon <= toKey; mon = addDaysKey(mon, 7)) {
      const sun = addDaysKey(mon, 6);
      out.push({
        key: mon,
        label: `${fmtDayShort(maxKey(mon, fromKey))}–${fmtDayShort(minKey(sun, toKey))}`,
        fromKey: maxKey(mon, fromKey),
        toKey: minKey(sun, toKey),
      });
      if (out.length > 400) break;
    }
  } else if (grain === "monthly") {
    for (let ms = monthStart(fromKey); ms <= toKey; ms = addMonthsKey(ms, 1)) {
      out.push({
        key: ms.slice(0, 7),
        label: `${MONTHS_SHORT[parseInt(ms.slice(5, 7)) - 1]} ${ms.slice(0, 4)}`,
        fromKey: maxKey(ms, fromKey),
        toKey: minKey(monthEnd(ms), toKey),
      });
      if (out.length > 400) break;
    }
  } else {
    for (let y = parseInt(fromKey.slice(0, 4)); y <= parseInt(toKey.slice(0, 4)); y++) {
      out.push({
        key: String(y),
        label: String(y),
        fromKey: maxKey(`${y}-01-01`, fromKey),
        toKey: minKey(`${y}-12-31`, toKey),
      });
    }
  }
  return out;
}

function spanDays(fromKey: string, toKey: string): number {
  return Math.round((Date.parse(`${toKey}T00:00:00Z`) - Date.parse(`${fromKey}T00:00:00Z`)) / 86400000) + 1;
}

// ── Param resolution (role-gated exactly like the drill targets) ─────────────

export async function resolveIntakeParams(
  sp: Record<string, string | undefined>,
  me: IntakeUser,
): Promise<IntakeParams> {
  const role = me.role;
  const canSeeSource = role !== "AGENT"; // mirrors /leads: agents can't see/filter source

  // Team — mirrors /reports: MANAGER locked to own team; ADMIN free; AGENT n/a
  // (their leadScopeWhere already pins ownership).
  let team: TeamId = "all";
  let teamLocked = false;
  if (role === "MANAGER") {
    team = (normalizeTeam(me.team) as TeamId | null) ?? "all";
    teamLocked = true;
  } else if (role === "ADMIN" && (sp.team === "Dubai" || sp.team === "India")) {
    team = sp.team;
  }

  // Module — only offer what the role's drill target would let them open.
  const moduleOptions: ModuleId[] = ["all", "leads"];
  if (role === "ADMIN") moduleOptions.push("master"); // /master-data is ADMIN-only
  moduleOptions.push("revival");
  if (canAccessBuyerMarket(me as { role: "ADMIN" | "MANAGER" | "AGENT"; team?: string | null }, "Dubai")) moduleOptions.push("dubai-buyer");
  if (canAccessBuyerMarket(me as { role: "ADMIN" | "MANAGER" | "AGENT"; team?: string | null }, "India")) moduleOptions.push("india-buyer");
  const module: ModuleId = moduleOptions.includes(sp.module as ModuleId) ? (sp.module as ModuleId) : "all";

  const source = canSeeSource && sp.source && sp.source !== "all" ? sp.source : "all";

  const grain: Grain = (["daily", "weekly", "monthly", "yearly", "custom"] as const).includes(sp.grain as Grain)
    ? (sp.grain as Grain)
    : "daily";

  const todayKey = istDateKey();
  let fromKey: string, toKey: string;
  if (grain === "custom" && isValidDateKey(sp.from) && isValidDateKey(sp.to)) {
    fromKey = minKey(sp.from, sp.to);
    toKey = maxKey(sp.from, sp.to);
  } else if (grain === "weekly") {
    fromKey = addDaysKey(mondayOf(todayKey), -77); // 12 weeks incl. current
    toKey = todayKey;
  } else if (grain === "monthly") {
    fromKey = addMonthsKey(monthStart(todayKey), -11); // 12 months incl. current
    toKey = todayKey;
  } else if (grain === "yearly") {
    // All years — from the earliest record the viewer could count.
    const [lMin, bMin] = await Promise.all([
      prisma.lead.aggregate({ _min: { createdAt: true }, where: { deletedAt: null } }),
      prisma.buyerRecord.aggregate({ _min: { createdAt: true }, where: { deletedAt: null } }),
    ]);
    const mins = [lMin._min.createdAt, bMin._min.createdAt].filter((d): d is Date => !!d);
    fromKey = mins.length ? istDateKey(new Date(Math.min(...mins.map((d) => d.getTime())))) : todayKey;
    toKey = todayKey;
  } else {
    // daily (also the fallback for custom without valid from/to)
    fromKey = addDaysKey(todayKey, -13); // last 14 days
    toKey = todayKey;
  }

  // Effective bucket grain — custom auto-picks by span; oversized ranges escalate
  // so the chart/table stay bounded (≤ ~130 buckets).
  const days = spanDays(fromKey, toKey);
  let bucketGrain: Exclude<Grain, "custom">;
  if (grain === "custom") bucketGrain = days <= 31 ? "daily" : days <= 190 ? "weekly" : days <= 740 ? "monthly" : "yearly";
  else bucketGrain = grain;
  if (bucketGrain === "daily" && days > 130) bucketGrain = "weekly";
  if (bucketGrain === "weekly" && days > 910) bucketGrain = "monthly";
  if (bucketGrain === "monthly" && days > 3700) bucketGrain = "yearly";

  return { grain, bucketGrain, fromKey, toKey, team, module, source, canSeeSource, teamLocked, moduleOptions };
}

// ── Drill URL builders (the param contract, in one place) ────────────────────

function qs(params: Record<string, string | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : "";
}

type LeadModule = "leads" | "master" | "revival";
const LEAD_MODULE_PATH: Record<LeadModule, string> = {
  leads: "/leads",
  master: "/master-data",
  revival: "/cold-calls",
};
export const MODULE_LABELS: Record<ModuleId, string> = {
  all: "All modules",
  leads: "Leads",
  master: "Master Data",
  revival: "Revival Engine",
  "dubai-buyer": "Dubai Buyer Data",
  "india-buyer": "India Buyer Data",
};

interface DrillBase { fromKey: string; toKey: string; team: TeamId; source: string; }

/** A lead-list drill URL. `opts.filter` (/leads) and `opts.bucket`
 *  (/master-data + /cold-calls via leadFilterWhere) are the lifecycle pins;
 *  `opts.status` is /cold-calls' chip-tab param (its "__fresh__" sentinel is
 *  the only no-status affordance any list has); `opts.source: null` drops the
 *  source param (the Unclassified bucket has no no-source affordance — the
 *  link intentionally opens the unfiltered list). */
function leadDrill(
  mod: LeadModule,
  base: DrillBase,
  opts?: { filter?: string; bucket?: string; owner?: string; status?: string; source?: string | null },
): string {
  const src = opts?.source === null ? undefined : (opts?.source ?? (base.source !== "all" ? base.source : undefined));
  const common = {
    dateFrom: base.fromKey,
    dateTo: base.toKey,
    dateField: "createdAt", // pin every drill to the CREATED date — never import-time surrogates
    team: base.team !== "all" ? base.team : undefined,
    source: src,
  };
  if (mod === "leads") {
    // /leads needs followup=all (else the page narrows to Today+Overdue) and
    // seg=all (else an ADMIN lands on "My Leads"). bucket= is IGNORED there.
    return `/leads${qs({ ...common, followup: "all", seg: "all", filter: opts?.filter, owner: opts?.owner })}`;
  }
  return `${LEAD_MODULE_PATH[mod]}${qs({ ...common, bucket: opts?.bucket, status: opts?.status, owner: opts?.owner })}`;
}

function buyerDrill(market: BuyerMarket, base: DrillBase, tab: string, source?: string | null): string {
  const path = market === "India" ? "/india-buyer-data" : "/buyer-data";
  const src = source === null ? undefined : (source ?? (base.source !== "all" ? base.source : undefined));
  return `${path}${qs({ dateFrom: base.fromKey, dateTo: base.toKey, source: src, tab })}`;
}

/** The report's own URL (self-drill for module=all chart bars). */
export function reportHref(p: {
  grain?: Grain; from?: string; to?: string; team?: TeamId; module?: ModuleId; source?: string;
}): string {
  return `/reports/lead-intake${qs({
    grain: p.grain,
    from: p.from,
    to: p.to,
    team: p.team && p.team !== "all" ? p.team : undefined,
    module: p.module && p.module !== "all" ? p.module : undefined,
    source: p.source && p.source !== "all" ? p.source : undefined,
  })}`;
}

// ── Envelopes (byte-mirrors of each drill target's base where) ───────────────

const NOT_COLD: Prisma.LeadWhereInput = { isColdCall: false, leadOrigin: { notIn: COLD_ORIGINS } };

/** leadFilterWhere translation for ONLY the params our drills carry (team +
 *  source). Date windows are applied directly in IST (see header note) and the
 *  lifecycle pins are added per-envelope, exactly as each page composes them. */
function engineAnd(team: TeamId, source: string): Prisma.LeadWhereInput[] {
  return leadFilterWhere({
    team: team !== "all" ? team : undefined,
    source: source !== "all" ? source : undefined,
  });
}

/** IST window used for COUNTING every module. For /leads the page's own parse
 *  is gte T00:00:00+05:30 / lte T23:59:59+05:30 — identical to this window save
 *  the final 999ms of the last day; istDayRange end is exclusive so we use lt. */
function istWindow(fromKey: string, toKey: string): { gte: Date; lt: Date } {
  return { gte: istDayRange(fromKey).start, lt: istDayRange(toKey).end };
}

// ── Row fetch + aggregation ──────────────────────────────────────────────────

interface LeadRowLite {
  createdAt: Date;
  sourceRaw: string | null;
  forwardedTeam: string | null;
  ownerId: string | null;
  currentStatus: string | null;
  rejectedAt: Date | null;
}
const LEAD_LITE_SELECT = {
  createdAt: true, sourceRaw: true, forwardedTeam: true,
  ownerId: true, currentStatus: true, rejectedAt: true,
} as const;

interface BuyerRowLite { createdAt: Date; source: string | null; poolStatus: string; }

const CLOSED_SET = new Set(CLOSED_OUTCOME_STATUSES);
const LOST_SET = new Set(LOST_STATUSES);

interface LeadAgg {
  total: number;
  assigned: number;
  unassignedStrict: number; // ownerId null AND rejectedAt null (= /leads ?owner=unassigned)
  unassignedRaw: number;    // ownerId null (= engine ?bucket=unassigned)
  converted: number;        // currentStatus in CLOSED_OUTCOME_STATUSES
  lostStatus: number;       // currentStatus in LOST_STATUSES
  lostFull: number;         // LOST status OR rejectedAt != null (= engine ?bucket=lost)
  rejectedRemainder: number;// rejectedAt != null AND status NOT in LOST
  noStatus: number;         // currentStatus null/blank — the visible "Missing status" bucket
  bySource: Map<string, { n: number; converted: number }>;
  byBucket: Map<string, number>;
  byTeam: Map<string, number>;
  bySourceBucket: Map<string, Map<string, number>>; // source → bucket → n (export matrix)
}

function newLeadAgg(): LeadAgg {
  return {
    total: 0, assigned: 0, unassignedStrict: 0, unassignedRaw: 0,
    converted: 0, lostStatus: 0, lostFull: 0, rejectedRemainder: 0, noStatus: 0,
    bySource: new Map(), byBucket: new Map(), byTeam: new Map(), bySourceBucket: new Map(),
  };
}

function aggregateLeadRows(rows: LeadRowLite[], grain: Exclude<Grain, "custom">): LeadAgg {
  const a = newLeadAgg();
  for (const r of rows) {
    a.total++;
    if (r.ownerId) a.assigned++;
    else { a.unassignedRaw++; if (!r.rejectedAt) a.unassignedStrict++; }
    const st = (r.currentStatus ?? "").trim();
    if (st === "") a.noStatus++;
    const isLostStatus = st !== "" && LOST_SET.has(st);
    const isClosed = st !== "" && CLOSED_SET.has(st);
    if (isClosed) a.converted++;
    if (isLostStatus) a.lostStatus++;
    if (isLostStatus || r.rejectedAt) a.lostFull++;
    if (r.rejectedAt && !isLostStatus) a.rejectedRemainder++;
    const srcKey = (r.sourceRaw ?? "").trim();
    const s = a.bySource.get(srcKey) ?? { n: 0, converted: 0 };
    s.n++; if (isClosed) s.converted++;
    a.bySource.set(srcKey, s);
    const bk = bucketKeyFor(istDateKey(r.createdAt), grain);
    a.byBucket.set(bk, (a.byBucket.get(bk) ?? 0) + 1);
    let sb = a.bySourceBucket.get(srcKey);
    if (!sb) { sb = new Map(); a.bySourceBucket.set(srcKey, sb); }
    sb.set(bk, (sb.get(bk) ?? 0) + 1);
    const t = r.forwardedTeam === "Dubai" || r.forwardedTeam === "India" ? r.forwardedTeam : "";
    a.byTeam.set(t, (a.byTeam.get(t) ?? 0) + 1);
  }
  return a;
}

interface BuyerAgg {
  total: number; pool: number; assigned: number; converted: number; rejected: number;
  bySource: Map<string, { n: number }>;
  byBucket: Map<string, number>;
  bySourceBucket: Map<string, Map<string, number>>; // source → bucket → n (export matrix)
}
function aggregateBuyerRows(rows: BuyerRowLite[], grain: Exclude<Grain, "custom">): BuyerAgg {
  const a: BuyerAgg = { total: 0, pool: 0, assigned: 0, converted: 0, rejected: 0, bySource: new Map(), byBucket: new Map(), bySourceBucket: new Map() };
  for (const r of rows) {
    a.total++;
    if (r.poolStatus === "ADMIN_POOL") a.pool++;
    else if (r.poolStatus === "ASSIGNED") a.assigned++;
    else if (r.poolStatus === "CONVERTED") a.converted++;
    else if (r.poolStatus === "REJECTED") a.rejected++;
    const k = (r.source ?? "").trim();
    const s = a.bySource.get(k) ?? { n: 0 };
    s.n++; a.bySource.set(k, s);
    const bk = bucketKeyFor(istDateKey(r.createdAt), grain);
    a.byBucket.set(bk, (a.byBucket.get(bk) ?? 0) + 1);
    let sb = a.bySourceBucket.get(k);
    if (!sb) { sb = new Map(); a.bySourceBucket.set(k, sb); }
    sb.set(bk, (sb.get(bk) ?? 0) + 1);
  }
  return a;
}

// ── The builder ──────────────────────────────────────────────────────────────

export async function buildIntakeReport(me: IntakeUser, p: IntakeParams): Promise<IntakeReport> {
  const { fromKey, toKey, team, source, module, bucketGrain } = p;
  const todayKey = istDateKey();
  const win = istWindow(fromKey, toKey);
  const todayWin = istWindow(todayKey, todayKey);
  const base: DrillBase = { fromKey, toKey, team, source };
  const todayBase: DrillBase = { fromKey: todayKey, toKey: todayKey, team, source };
  const flags: string[] = [];

  const isAdmin = me.role === "ADMIN";
  const isAdminOrMgr = me.role === "ADMIN" || me.role === "MANAGER";
  const scope = await leadScopeWhere({ id: me.id, role: me.role as "ADMIN" | "MANAGER" | "AGENT", team: me.team });
  const engine = engineAnd(team, source);

  // ── Per-module envelopes — each mirrors its drill page byte-for-byte ──────
  // /leads default (workable view): scope + notCold + workable OR + filters.
  const leadsBase = (dateWin: { gte: Date; lt: Date }): Prisma.LeadWhereInput => ({
    ...scope,
    ...NOT_COLD,
    createdAt: dateWin,
    AND: [...engine, { OR: WORKABLE_STATUS_OR }],
  });
  // /leads?filter=closed|lost — the status pin REPLACES the workable envelope
  // (leads/page.tsx lines ~71-74), everything else identical.
  const leadsStatusPinned = (dateWin: { gte: Date; lt: Date }, statuses: string[]): Prisma.LeadWhereInput => ({
    ...scope,
    ...NOT_COLD,
    createdAt: dateWin,
    currentStatus: { in: statuses },
    AND: [...engine],
  });
  // /master-data cat=all (ADMIN-only console — NOT leadScope'd; the page gates by role).
  const masterBase = (dateWin: { gte: Date; lt: Date }): Prisma.LeadWhereInput => ({
    deletedAt: null,
    ...NOT_COLD,
    createdAt: dateWin,
    AND: [...engine],
  });
  // /cold-calls: role base + originCold envelope + engine filters.
  const revivalRole: Prisma.LeadWhereInput = isAdminOrMgr ? {} : { ownerId: me.id };
  const revivalBase = (dateWin: { gte: Date; lt: Date }): Prisma.LeadWhereInput => ({
    AND: [
      revivalRole,
      { deletedAt: null, rejectedAt: null, OR: [{ leadOrigin: { in: COLD_ORIGINS } }, { isColdCall: true }] },
      { createdAt: dateWin },
      ...engine,
    ],
  });

  // Which buyer markets participate (module + team + access gates).
  const buyerMarkets: BuyerMarket[] = (["Dubai", "India"] as BuyerMarket[]).filter((m) => {
    const id: ModuleId = m === "Dubai" ? "dubai-buyer" : "india-buyer";
    if (!p.moduleOptions.includes(id)) return false;
    if (module !== "all" && module !== id) return false;
    if (team !== "all" && teamForBuyerMarket(m) !== team) return false;
    return true;
  });

  // ── Bounded query set (rows once per module — never a query per cell) ─────
  const wantLeads = module === "all" || module === "leads";
  const wantMaster = isAdmin && (module === "all" || module === "master");
  const wantRevival = module === "all" || module === "revival";

  const [leadsRows, masterRows, revivalRows, ...buyerRowSets] = await Promise.all([
    wantLeads
      ? prisma.lead.findMany({ where: leadsBase(win), select: LEAD_LITE_SELECT })
      : Promise.resolve([] as LeadRowLite[]),
    wantMaster
      ? prisma.lead.findMany({ where: masterBase(win), select: LEAD_LITE_SELECT })
      : Promise.resolve([] as LeadRowLite[]),
    wantRevival
      ? prisma.lead.findMany({ where: revivalBase(win), select: LEAD_LITE_SELECT })
      : Promise.resolve([] as LeadRowLite[]),
    ...buyerMarkets.map(async (m) => {
      const bScope = await buyerScopeWhereForMarket(
        { id: me.id, role: me.role as "ADMIN" | "MANAGER" | "AGENT", team: me.team }, m,
      );
      const bWhere: Prisma.BuyerRecordWhereInput = {
        AND: [
          bScope as Prisma.BuyerRecordWhereInput,
          { createdAt: win },
          ...(source !== "all" ? [{ source }] : []),
        ],
      };
      return prisma.buyerRecord.findMany({
        where: bWhere,
        select: { createdAt: true, source: true, poolStatus: true },
      });
    }),
  ]);

  // /leads hides terminal statuses, so the Leads module's Converted / Lost /
  // per-source-converted come from the SAME status-pinned envelope its
  // ?filter=closed / ?filter=lost drills apply (3 aux queries, still bounded).
  const [leadsConvBySource, leadsLost, leadsRejRemainder, leadsConvToday] = wantLeads
    ? await Promise.all([
        prisma.lead.groupBy({
          by: ["sourceRaw"],
          where: leadsStatusPinned(win, CLOSED_OUTCOME_STATUSES),
          _count: { _all: true },
        }),
        prisma.lead.count({ where: leadsStatusPinned(win, LOST_STATUSES) }),
        // rejectedAt set but status NOT lost — the /leads?filter=lost drill can't
        // show these (no rejectedAt affordance on /leads); surfaced separately.
        prisma.lead.count({
          where: {
            ...scope, ...NOT_COLD, createdAt: win, rejectedAt: { not: null },
            AND: [...engine, { OR: [{ currentStatus: null }, { currentStatus: "" }, { currentStatus: { notIn: LOST_STATUSES } }] }],
          },
        }),
        prisma.lead.count({ where: leadsStatusPinned(todayWin, CLOSED_OUTCOME_STATUSES) }),
      ])
    : [[], 0, 0, 0] as [Array<{ sourceRaw: string | null; _count: { _all: number } }>, number, number, number];

  // "Received today" — independent of the selected range; tiny per-module counts.
  const [leadsToday, masterToday, revivalToday, ...buyerToday] = await Promise.all([
    wantLeads ? prisma.lead.count({ where: leadsBase(todayWin) }) : Promise.resolve(0),
    wantMaster ? prisma.lead.count({ where: masterBase(todayWin) }) : Promise.resolve(0),
    wantRevival ? prisma.lead.count({ where: revivalBase(todayWin) }) : Promise.resolve(0),
    ...buyerMarkets.map(async (m) => {
      const bScope = await buyerScopeWhereForMarket(
        { id: me.id, role: me.role as "ADMIN" | "MANAGER" | "AGENT", team: me.team }, m,
      );
      return prisma.buyerRecord.count({
        where: { AND: [bScope as Prisma.BuyerRecordWhereInput, { createdAt: todayWin }, ...(source !== "all" ? [{ source }] : [])] },
      });
    }),
  ]);

  // Source picker options — lead modules: DISTINCT verbatim sourceRaw (the same
  // options query /leads builds); buyer modules: distinct BuyerRecord.source.
  let sourceOptions: string[] = [];
  if (p.canSeeSource) {
    if (module === "dubai-buyer" || module === "india-buyer") {
      const market = module === "dubai-buyer" ? "Dubai" : "India";
      const rows = await prisma.buyerRecord.groupBy({ by: ["source"], where: { market, deletedAt: null, source: { not: null } } });
      sourceOptions = rows.map((r) => r.source!).filter(Boolean).sort((a, b) => a.localeCompare(b));
    } else {
      const rows = await prisma.lead.findMany({
        where: { deletedAt: null, sourceRaw: { not: null } },
        distinct: ["sourceRaw"],
        select: { sourceRaw: true },
        orderBy: { sourceRaw: "asc" },
      });
      sourceOptions = rows.map((r) => r.sourceRaw!).filter(Boolean);
    }
  }

  // ── Aggregate ──────────────────────────────────────────────────────────────
  const leadsAgg = aggregateLeadRows(leadsRows as LeadRowLite[], bucketGrain);
  // Fold the aux converted numbers into the Leads agg (rows exclude terminal).
  leadsAgg.converted = leadsConvBySource.reduce((s, r) => s + r._count._all, 0);
  leadsAgg.lostStatus = leadsLost;
  leadsAgg.lostFull = leadsLost + leadsRejRemainder;
  leadsAgg.rejectedRemainder = leadsRejRemainder;
  const leadsConvSourceMap = new Map<string, number>(
    leadsConvBySource.map((r): [string, number] => [(r.sourceRaw ?? "").trim(), r._count._all]),
  );

  const masterAgg = aggregateLeadRows(masterRows as LeadRowLite[], bucketGrain);
  const revivalAgg = aggregateLeadRows(revivalRows as LeadRowLite[], bucketGrain);
  const buyerAggs = buyerMarkets.map((m, i) => ({ market: m, agg: aggregateBuyerRows(buyerRowSets[i] as BuyerRowLite[], bucketGrain) }));

  // ── The active composition (which module envelopes feed the tables) ───────
  // module=all: ADMIN → Master console + Revival (DISJOINT: /master-data
  // excludes cold origins + isColdCall rows; /cold-calls is exactly those, minus
  // rejected — flagged). MANAGER/AGENT → Leads (workable) + Revival (they cannot
  // open /master-data, so their sum is what THEY can drill).
  interface Part {
    id: LeadModule;
    label: string;
    agg: LeadAgg;
    today: number;
    drill: (b: DrillBase, o?: { filter?: string; bucket?: string; owner?: string; source?: string | null }) => string;
    lifecycle: { converted: (b: DrillBase, src?: string | null) => string; lost: (b: DrillBase) => string; assigned?: (b: DrillBase) => string; unassigned?: (b: DrillBase) => string };
    unassignedN: number;
    convertedToday?: number;
  }
  const leadsPart: Part = {
    id: "leads", label: "Leads", agg: leadsAgg, today: leadsToday,
    drill: (b, o) => leadDrill("leads", b, o),
    lifecycle: {
      converted: (b, src) => leadDrill("leads", b, { filter: "closed", source: src }),
      lost: (b) => leadDrill("leads", b, { filter: "lost" }),
      // /leads has no "any owner" affordance — Assigned stays unlinked there.
      unassigned: (b) => leadDrill("leads", b, { owner: "unassigned" }),
    },
    unassignedN: leadsAgg.unassignedStrict,
    convertedToday: leadsConvToday,
  };
  const masterPart: Part = {
    id: "master", label: "Master", agg: masterAgg, today: masterToday,
    drill: (b, o) => leadDrill("master", b, o),
    lifecycle: {
      converted: (b, src) => leadDrill("master", b, { bucket: "converted", source: src }),
      lost: (b) => leadDrill("master", b, { bucket: "lost" }),
      assigned: (b) => leadDrill("master", b, { bucket: "assigned" }),
      unassigned: (b) => leadDrill("master", b, { bucket: "unassigned" }),
    },
    unassignedN: masterAgg.unassignedRaw, // engine bucket=unassigned is RAW ownerId:null
  };
  const revivalPart: Part = {
    id: "revival", label: "Revival", agg: revivalAgg, today: revivalToday,
    drill: (b, o) => leadDrill("revival", b, o),
    lifecycle: {
      converted: (b, src) => leadDrill("revival", b, { bucket: "converted", source: src }),
      lost: (b) => leadDrill("revival", b, { bucket: "lost" }),
      assigned: (b) => leadDrill("revival", b, { bucket: "assigned" }),
      unassigned: (b) => leadDrill("revival", b, { bucket: "unassigned" }),
    },
    unassignedN: revivalAgg.unassignedRaw, // base pins rejectedAt:null → raw == strict
  };

  let activeParts: Part[];
  if (module === "leads") activeParts = [leadsPart];
  else if (module === "master") activeParts = [masterPart];
  else if (module === "revival") activeParts = [revivalPart];
  else if (module === "all") activeParts = isAdmin ? [masterPart, revivalPart] : [leadsPart, revivalPart];
  else activeParts = []; // buyer module — tables come from the buyer agg below

  const isBuyerView = module === "dubai-buyer" || module === "india-buyer";
  const activeBuyer = isBuyerView ? buyerAggs.find((b) => (b.market === "Dubai") === (module === "dubai-buyer")) : undefined;

  // ── Cell builder helpers ───────────────────────────────────────────────────
  const cellFromParts = (
    parts: { label: string; n: number; href?: string }[],
    note?: string,
  ): Cell => {
    const n = parts.reduce((s, x) => s + x.n, 0);
    const nonZero = parts.filter((x) => x.n > 0 && x.href);
    if (parts.length === 1) return { n, href: parts[0].href, note };
    if (nonZero.length === 1 && parts.every((x) => x.n === 0 || x.href)) return { n, href: nonZero[0].href, note };
    return { n, parts: parts.filter((x) => x.n > 0), note };
  };

  // sourceRaw containing a comma can't round-trip (?source= is comma-split by
  // both /leads and the engine) — link suppressed, flagged.
  const sourceLinkable = (key: string) => key !== "" && !key.includes(",");

  // ── Summary cards ──────────────────────────────────────────────────────────
  let summary: IntakeReport["summary"];
  if (isBuyerView && activeBuyer) {
    const m = activeBuyer.market;
    const a = activeBuyer.agg;
    const bToday = buyerToday[buyerMarkets.indexOf(m)] ?? 0;
    summary = {
      total: { n: a.total, href: buyerDrill(m, base, "all") },
      today: { n: bToday, href: buyerDrill(m, todayBase, "all") },
      assigned: { n: a.assigned, href: buyerDrill(m, base, "assigned") },
      unassigned: { n: a.pool, href: buyerDrill(m, base, "pool"), note: "Admin Pool" },
      converted: { n: a.converted, href: buyerDrill(m, base, "converted") },
      lost: { n: a.rejected, href: buyerDrill(m, base, "rejected"), note: "Rejected (returned)" },
      lostRemainder: null,
    };
  } else {
    summary = {
      total: cellFromParts(activeParts.map((pt) => ({ label: pt.label, n: pt.agg.total, href: pt.drill(base) }))),
      today: cellFromParts(activeParts.map((pt) => ({ label: pt.label, n: pt.today, href: pt.drill(todayBase) }))),
      assigned: cellFromParts(
        activeParts.map((pt) => ({
          label: pt.label,
          n: pt.agg.assigned,
          href: pt.lifecycle.assigned ? pt.lifecycle.assigned(base) : undefined,
        })),
        activeParts.some((pt) => !pt.lifecycle.assigned)
          ? "Leads-module part not clickable — /leads has no ‘any owner’ filter yet"
          : undefined,
      ),
      unassigned: cellFromParts(
        activeParts.map((pt) => ({ label: pt.label, n: pt.unassignedN, href: pt.lifecycle.unassigned?.(base) })),
      ),
      converted: cellFromParts(activeParts.map((pt) => ({ label: pt.label, n: pt.agg.converted, href: pt.lifecycle.converted(base) }))),
      lost: cellFromParts(
        activeParts.map((pt) => ({
          label: pt.label,
          // master's bucket=lost drill includes rejectedAt rows → use lostFull
          // there; /leads?filter=lost and cold's bucket=lost are status-only.
          n: pt.id === "master" ? pt.agg.lostFull : pt.agg.lostStatus,
          href: pt.lifecycle.lost(base),
        })),
      ),
      lostRemainder: null,
    };
    // Rejected-but-not-LOST-status remainder for the Leads module — a separate,
    // honestly-labelled pointer (NOT folded into the /leads-linked number).
    const remainder = activeParts.filter((pt) => pt.id === "leads").reduce((s, pt) => s + pt.agg.rejectedRemainder, 0);
    if (remainder > 0) {
      summary.lostRemainder = {
        n: remainder,
        href: isAdmin ? leadDrill("master", base, { bucket: "lost" }) : undefined,
        note: isAdmin
          ? "rejected leads still carrying a workable status — opens Master Data’s full Lost bucket (a superset)"
          : "rejected leads still carrying a workable status — not listable on /leads",
      };
    }
  }

  // ── Source-wise table ──────────────────────────────────────────────────────
  let sourceRows: SourceRow[] = [];
  if (isBuyerView && activeBuyer) {
    const m = activeBuyer.market;
    const a = activeBuyer.agg;
    sourceRows = [...a.bySource.entries()]
      .map(([key, v]) => ({
        key,
        // Unclassified directive: blank source = its OWN visible bucket, never
        // folded into a named source; it empties automatically once classified.
        label: key === "" ? "Unclassified (no source)" : key,
        count: {
          n: v.n,
          href: key !== "" ? buyerDrill(m, base, "all", key) : buyerDrill(m, base, "all", null),
          note: key === "" ? "no ‘blank source’ filter exists on the buyer list — link opens the list without a source filter (superset)" : undefined,
        },
        pct: a.total ? (v.n / a.total) * 100 : 0,
        converted: null, // conversion % is a lead-module metric ("where available")
        convPct: null,
      }))
      .sort((x, y) => y.count.n - x.count.n);
  } else {
    const keys = new Set<string>();
    for (const pt of activeParts) for (const k of pt.agg.bySource.keys()) keys.add(k);
    const totalAll = activeParts.reduce((s, pt) => s + pt.agg.total, 0);
    sourceRows = [...keys]
      .map((key) => {
        const parts = activeParts.map((pt) => ({
          label: pt.label,
          n: pt.agg.bySource.get(key)?.n ?? 0,
          href: sourceLinkable(key) ? pt.drill(base, { source: key }) : pt.drill(base, { source: null }),
        }));
        const convParts = activeParts.map((pt) => ({
          label: pt.label,
          n: pt.id === "leads" ? (leadsConvSourceMap.get(key) ?? 0) : (pt.agg.bySource.get(key)?.converted ?? 0),
          href: sourceLinkable(key) ? pt.lifecycle.converted(base, key) : undefined,
        }));
        const count = cellFromParts(parts, key === "" ? "no ‘blank source’ filter exists on the lists — links open the list without a source filter (superset)" : (!sourceLinkable(key) ? "source value contains a comma — the ?source= filter would split it, link opens unfiltered" : undefined));
        const conv = cellFromParts(convParts);
        return {
          key,
          // Unclassified directive: blank sourceRaw = its OWN visible bucket,
          // never folded into "Other"/"Website"; empties once classified.
          label: key === "" ? "Unclassified (no source)" : effectiveSource(key, null),
          count,
          pct: totalAll ? (count.n / totalAll) * 100 : 0,
          converted: conv,
          convPct: count.n ? (conv.n / count.n) * 100 : 0,
        };
      })
      .sort((x, y) => y.count.n - x.count.n);
  }

  // ── Date-wise table + chart ────────────────────────────────────────────────
  const buckets = buildBuckets(bucketGrain, fromKey, toKey);
  const bucketCount = (bk: string): { n: number; parts: { label: string; n: number; href?: string }[] } => {
    if (isBuyerView && activeBuyer) {
      const n = activeBuyer.agg.byBucket.get(bk) ?? 0;
      return { n, parts: [] };
    }
    const b = buckets.find((x) => x.key === bk)!;
    const dBase: DrillBase = { fromKey: b.fromKey, toKey: b.toKey, team, source };
    const parts = activeParts.map((pt) => ({ label: pt.label, n: pt.agg.byBucket.get(bk) ?? 0, href: pt.drill(dBase) }));
    return { n: parts.reduce((s, x) => s + x.n, 0), parts };
  };

  const grandTotal = isBuyerView && activeBuyer ? activeBuyer.agg.total : activeParts.reduce((s, pt) => s + pt.agg.total, 0);
  const dateRows = buckets.map((b) => {
    const { n, parts } = bucketCount(b.key);
    let cell: Cell;
    if (isBuyerView && activeBuyer) {
      cell = { n, href: buyerDrill(activeBuyer.market, { fromKey: b.fromKey, toKey: b.toKey, team, source }, "all") };
    } else {
      cell = cellFromParts(parts);
    }
    return { bucket: b, count: cell, pct: grandTotal ? (n / grandTotal) * 100 : 0 };
  });

  // Chart bars carry ONE link each: single-module views link straight to the
  // list; module=all links to this report re-scoped to the bucket (grain=custom)
  // where each per-module chip is one more click to the exact records.
  const chart = dateRows.map(({ bucket, count }) => ({
    bucket,
    n: count.n,
    href:
      count.href ??
      reportHref({ grain: "custom", from: bucket.fromKey, to: bucket.toKey, team, module, source }),
  }));
  const totalsByBucketMax = Math.max(1, ...chart.map((c) => c.n));

  // ── Team-wise table (lead modules only — BuyerRecord has no team field) ────
  let teamRows: TableRow[] = [];
  if (!isBuyerView) {
    const teamsPresent = new Set<string>();
    for (const pt of activeParts) for (const k of pt.agg.byTeam.keys()) teamsPresent.add(k);
    teamRows = [...teamsPresent]
      .map((t) => {
        // Unclassified directive: team-less leads are their OWN visible bucket,
        // excluded from the Dubai/India rows. No ?team=<none> affordance exists,
        // so the bucket links to the list WITHOUT a team filter (honest superset).
        const parts = activeParts.map((pt) => ({
          label: pt.label,
          n: pt.agg.byTeam.get(t) ?? 0,
          href: pt.drill({ fromKey, toKey, team: t === "" ? "all" : (t as TeamId), source }),
        }));
        const cell = cellFromParts(parts, t === "" ? "awaiting team classification — no ?team= value exists for team-less leads, links open the list without a team filter (superset)" : undefined);
        return { label: t === "" ? "Unclassified (no team)" : `${t} team`, count: cell, pct: grandTotal ? (cell.n / grandTotal) * 100 : 0 };
      })
      .sort((x, y) => y.count.n - x.count.n);
  }

  // ── Module-wise table — every module the viewer can open, own envelope each ─
  const moduleRows: IntakeReport["moduleRows"] = [];
  if (p.moduleOptions.includes("leads") && wantLeads) {
    moduleRows.push({ id: "leads", label: "Leads (workable pipeline — as /leads shows it)", count: { n: leadsAgg.total, href: leadDrill("leads", base) } });
  }
  if (p.moduleOptions.includes("master") && wantMaster) {
    moduleRows.push({
      id: "master",
      label: "Master Data (full sales database — includes the workable pipeline rows)",
      count: { n: masterAgg.total, href: leadDrill("master", base) },
      note: "console view: every non-Revival lead, any status",
    });
  }
  if (wantRevival) {
    moduleRows.push({ id: "revival", label: "Revival Engine", count: { n: revivalAgg.total, href: leadDrill("revival", base) } });
  }
  for (const { market, agg } of buyerAggs) {
    moduleRows.push({
      id: market === "Dubai" ? "dubai-buyer" : "india-buyer",
      label: MODULE_LABELS[market === "Dubai" ? "dubai-buyer" : "india-buyer"],
      count: { n: agg.total, href: buyerDrill(market, base, "all") },
    });
  }

  // ── Buyer strips (module=all) ──────────────────────────────────────────────
  const buyerStrips = (module === "all" ? buyerAggs : []).map(({ market, agg }) => ({
    market,
    label: MODULE_LABELS[market === "Dubai" ? "dubai-buyer" : "india-buyer"],
    total: { n: agg.total, href: buyerDrill(market, base, "all") } as Cell,
    pool: { n: agg.pool, href: buyerDrill(market, base, "pool") } as Cell,
    assigned: { n: agg.assigned, href: buyerDrill(market, base, "assigned") } as Cell,
    converted: { n: agg.converted, href: buyerDrill(market, base, "converted") } as Cell,
    rejected: { n: agg.rejected, href: buyerDrill(market, base, "rejected") } as Cell,
  }));

  // ── Unclassified visible buckets (Lalit directive) ─────────────────────────
  // "Missing status" — records with no currentStatus at all. Counted in Total,
  // deliberately in NO lifecycle card (Converted/Lost), shown as its own line so
  // it drains automatically as statuses get set. Only /cold-calls has a
  // no-status affordance (?status=__fresh__ → currentStatus null/blank), so the
  // Revival part links there; Leads/Master parts stay unlinked (no fake filter).
  let unstatused: Cell | null = null;
  if (!isBuyerView) {
    const parts = activeParts.map((pt) => ({
      label: pt.label,
      n: pt.agg.noStatus,
      href: pt.id === "revival" ? leadDrill("revival", base, { status: "__fresh__" }) : undefined,
    }));
    const n = parts.reduce((s, x) => s + x.n, 0);
    unstatused = n > 0 ? cellFromParts(parts, "no status recorded yet — counted in Total, in no lifecycle card; only the Revival list can filter blank statuses (?status=__fresh__)") : null;
  }

  // ── Source × date cross-tab (export matrix — same envelopes as the page) ──
  const sourceBucketMatrix: IntakeReport["sourceBucketMatrix"] = sourceRows.map((row) => ({
    label: row.label,
    perBucket: buckets.map((b) =>
      isBuyerView && activeBuyer
        ? activeBuyer.agg.bySourceBucket.get(row.key)?.get(b.key) ?? 0
        : activeParts.reduce((s, pt) => s + (pt.agg.bySourceBucket.get(row.key)?.get(b.key) ?? 0), 0),
    ),
    total: row.count.n,
    converted: row.converted ? row.converted.n : null,
    convPct: row.convPct,
  }));

  // ── Reconciliation flags (rendered on-page; also the report's honesty note) ─
  if (!isBuyerView) {
    if (module === "all") {
      flags.push(
        isAdmin
          ? "All-modules totals = Master Data console + Revival Engine (disjoint). Rejected Revival records are excluded from /cold-calls by design and are not listable there — they appear inside Master Data’s Lost bucket."
          : "All-modules totals = Leads (workable view) + Revival Engine — the lists your role can open. Closed/Lost pipeline records live in the admin-only Master Data console and are not included.",
      );
    }
    if (module === "all" || module === "leads") {
      flags.push(
        "The Leads module mirrors the /leads working view (workable statuses only); its Converted / Lost cards use the same ?filter=closed / ?filter=lost views the drills open. ‘Assigned’ has no /leads URL filter yet (no ‘any owner’ value) — that part of the card is not clickable.",
      );
    }
  }
  if (sourceRows.some((r) => r.key === "")) {
    flags.push("‘Unclassified (no source)’ is its own visible bucket (never folded into a named source) and drains automatically once sources are set. No list has a ‘blank source’ filter yet, so its links open the list without a source filter (a superset).");
  }
  if (isBuyerView || buyerStrips.length > 0) {
    flags.push("Buyer lists load at most 5,000 records server-side; a drill inside a larger scoped set could show fewer rows than counted.");
  }

  const rangeLabel = `${fmtDayShort(fromKey)}${fromKey.slice(0, 4) !== toKey.slice(0, 4) ? ` ${fromKey.slice(0, 4)}` : ""} – ${fmtDayFull(toKey)} · IST`;

  return {
    params: p,
    rangeLabel,
    buckets,
    summary,
    buyerStrips,
    sourceRows,
    dateRows,
    chart,
    teamRows,
    moduleRows,
    unstatused,
    sourceBucketMatrix,
    sourceOptions,
    flags,
    isBuyerView,
    totalsByBucketMax,
  };
}
