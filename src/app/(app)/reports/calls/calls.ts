// ─────────────────────────────────────────────────────────────────────────────
// ☎️ CALL REPORT — the ONE central calling report, over the centralized CallLog
// table (lead-linked AND buyer-linked rows, from day one).
//
// THE ONE DESIGN RULE — count == records, by construction.
// Every number is computed from the SAME where-clause its DRILL TARGET
// (/call-logs) applies for the URL params the drill carries. Concretely this
// module byte-mirrors three things from src/app/(app)/call-logs/page.tsx:
//
//   1. ROLE SCOPE (scopeAnd)  — calls are scoped by the ACTOR (CallLog.userId),
//      NOT by lead ownership:
//        AGENT   → { userId: me.id }
//        MANAGER → { user: { team: <normalized team> } }, or a visibleOwnerIds()
//                  subtree fallback when the manager has no normalizable team
//        ADMIN   → no actor predicate
//   2. LIVE ENVELOPE (linkedAnd) — OR[ lead.deletedAt:null , buyer.deletedAt:null ].
//      Unlinked calls (neither lead nor buyer) are OUT of both surfaces.
//   3. FILTER PREDICATES — ?user= / ?team= / ?module= / ?outcome= / ?from= / ?to=
//      parsed exactly as the list parses them (incl. team being ADMIN-only and
//      the IST day boundaries below).
//
// DATES ARE IST, ALWAYS. /call-logs parses ?from=YYYY-MM-DD as
// `Date("<from>T00:00:00Z") - 5.5h` = IST midnight, and ?to= as that +24h
// exclusive — which is instant-for-instant identical to istDayRange(key).start /
// .end from lib/datetime. We build every bucket with istDayRange/istDateKey, so
// a bucket's number equals what its ?from=&?to= link opens. NEVER raw UTC days.
//
// SHARED HELPERS REUSED (so definitions cannot drift):
//   • activityLeadModule / buyerSourceModule / ACTIVITY_SOURCE_MODULES
//       — lib/moduleSource.ts, the canonical source_module definition.
//   • MEANINGFUL_CALL_OUTCOMES / isMeaningfulOutcome
//       — lib/ghosting.ts (re-exported by lib/callAttempts.ts), the SAME set the
//         ghosting + revival auto-return engines fire on. Connected == meaningful.
//   • effectiveSource — lib/sourceLabel.ts (verbatim sourceRaw, never a raw enum).
//   • istDayRange / istDateKey / istWeekday / isValidDateKey — lib/datetime.ts.
//   • normalizeTeam — lib/teamRouting.ts.  visibleOwnerIds — lib/leadScope.ts.
//
// RESOLVED vs UNRESOLVED (Lalit P0, 2026-07-18): every "Call" button now writes
// a CallLog the instant it is TAPPED (outcome INITIATED), and the same row is
// transitioned to a terminal outcome when the call resolves. A row still sitting
// at INITIATED / RINGING is a DIAL, not a call — counting it would inflate Total
// calls, the connect-rate denominator, every per-agent/team/module number and
// the leaderboards, by every tap that never produced a conversation. So:
//   • the report body counts RESOLVED calls only (CallParams.state defaults to
//     "resolved", carried into every drill href as ?state=resolved), and
//   • unresolved dials get their OWN headline figure (`pendingDials`, drilling
//     to ?state=pending) — excluded from the metrics, never silently dropped.
// Both stay count==records because /call-logs honours the identical ?state=
// predicate, from the same PENDING_CALL_OUTCOMES set, for every role.
//
// UNCLASSIFIED DATA (Lalit directive 2026-07-16): a call whose actor has no
// team, or whose record has no source/project, is NEVER force-bucketed. It gets
// its own visible bucket ("Unclassified (no team)" etc.), and where /call-logs
// has no filter affordance for that gap the number links to the SAME slice
// WITHOUT that narrowing — an honest superset, flagged with a note. Never a fake
// filter that would silently return a different set than the number claims.
//
// KNOWN DRILL GAPS (honest supersets today — see `exact:false` cells):
//   • Source and Project — /call-logs has NO ?source= / ?project= param.
//   • Attempt-wise       — no per-record attempt filter exists on /call-logs.
//   • Connected / Unsuccessful GROUPS — ?outcome= takes ONE enum value, so the
//     group total is a superset link; the per-outcome chips under it ARE exact
//     and sum to the group by construction.
//   • Team buckets outside Dubai/India (e.g. "HQ", no team) — ?team= only
//     accepts a normalizeTeam() value.
// Adding ?source= / ?project= to /call-logs would make the first two exact with
// no change here beyond flipping `exact` (see SOURCE_PARAM / PROJECT_PARAM).
// ─────────────────────────────────────────────────────────────────────────────
import "server-only";
import { CallOutcome, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  activityLeadModule,
  buyerSourceModule,
  ACTIVITY_SOURCE_MODULES,
  type SourceModule,
} from "@/lib/moduleSource";
import {
  MEANINGFUL_CALL_OUTCOMES,
  isMeaningfulOutcome,
  isPendingCall,
  PENDING_CALL_OUTCOMES,
} from "@/lib/ghosting";
import { effectiveSource } from "@/lib/sourceLabel";
import { istDateKey, istDayRange, istWeekday, isValidDateKey } from "@/lib/datetime";
import { normalizeTeam } from "@/lib/teamRouting";
import { visibleOwnerIds, type ScopedUser } from "@/lib/leadScope";

// ── Outcome partition ────────────────────────────────────────────────────────
// Connected = MEANINGFUL_CALL_OUTCOMES (imported — a human answered). Unsuccessful
// = the explicit 4 no-contact outcomes. Anything in the CallOutcome enum that is
// in NEITHER set becomes its own visible "Unclassified outcome" bucket + a flag,
// so adding an enum value can never be silently swallowed into "missed".
export const UNSUCCESSFUL_CALL_OUTCOMES = [
  "NOT_PICKED", "BUSY", "SWITCHED_OFF", "WRONG_NUMBER",
] as const;

export function isUnsuccessfulOutcome(o: string | null | undefined): boolean {
  return !!o && (UNSUCCESSFUL_CALL_OUTCOMES as readonly string[]).includes(o);
}

export const OUTCOME_LABELS: Record<string, string> = {
  CONNECTED: "Connected", NOT_PICKED: "Not Picked", CALLBACK: "Callback",
  WRONG_NUMBER: "Wrong Number", BUSY: "Busy", SWITCHED_OFF: "Switched Off",
  INTERESTED: "Interested", NOT_INTERESTED: "Not Interested",
  // Terminal states added with the dial-on-tap change. Unclassified by design:
  // they resolve, so they belong in Total, but they are neither "a human
  // answered" nor one of the 4 explicit no-contact outcomes — the report shows
  // them in their own bucket rather than quietly inflating "missed".
  FAILED: "Failed", CANCELLED: "Cancelled", MISSED: "Missed",
  // UNRESOLVED dials — never part of Total (see PENDING_OUTCOMES below).
  INITIATED: "Initiated", RINGING: "Ringing",
};

/** Every CallOutcome enum value, in display order (connected set first). */
const ALL_OUTCOMES: string[] = Object.keys(CallOutcome);

// ── UNRESOLVED DIALS (Lalit P0, 2026-07-18) ──────────────────────────────────
// Every "Call" button now writes a CallLog the instant it is tapped, at
// INITIATED, and that same row is later transitioned to a terminal outcome. An
// unresolved row is a DIAL, not a call: counting it would inflate Total calls,
// the connect rate (its denominator), every per-agent/team/module number and
// the leaderboards — by every tap that never produced a conversation.
//
// So the report body counts RESOLVED calls only (see CallParams.state, defaulted
// to "resolved"), and unresolved dials get their OWN visible headline figure —
// `pendingDials` — so a pending dial is never silently dropped either. Both
// numbers drill exactly: ?state=resolved and ?state=pending on /call-logs.
//
// PENDING is NOT part of RESIDUAL_OUTCOMES: residual means "a resolved outcome
// this report has not classified yet" and raises a loud flag telling the
// operator to classify it. Pending is already classified — as not-a-call.
const PENDING_OUTCOMES: string[] = ALL_OUTCOMES.filter((o) => isPendingCall(o));
const RESIDUAL_OUTCOMES: string[] = ALL_OUTCOMES.filter(
  (o) => !isMeaningfulOutcome(o) && !isUnsuccessfulOutcome(o) && !isPendingCall(o),
);

// ── Types ────────────────────────────────────────────────────────────────────

export type Grain = "daily" | "weekly" | "monthly" | "yearly" | "custom";
export type BucketGrain = Exclude<Grain, "custom">;

/** One clickable number. `exact:false` ⇒ the href opens an honest SUPERSET of the
 *  counted rows (no list param exists for this dimension) and `note` says so. */
export interface Cell {
  n: number;
  href: string;
  exact: boolean;
  note?: string;
  parts?: { label: string; n: number; href: string; exact: boolean }[];
}

export interface Bucket { key: string; label: string; fromKey: string; toKey: string }

export interface CallParams {
  grain: Grain;
  bucketGrain: BucketGrain;
  fromKey: string; // IST "YYYY-MM-DD" inclusive
  toKey: string;   // IST "YYYY-MM-DD" inclusive
  user: string;    // "" = all — a User.id (→ /call-logs?user=)
  team: string;    // "" = all — "Dubai" | "India" (→ /call-logs?team=, ADMIN-only)
  module: string;  // "" = all — a SourceModule (→ /call-logs?module=)
  outcome: string; // "" = all — a CallOutcome (→ /call-logs?outcome=)
  /** Resolved-vs-unresolved dial split (→ /call-logs?state=).
   *  "resolved" (the DEFAULT — the report counts real calls only) · "pending"
   *  (unresolved dials only) · "" (both; only when ?outcome= already pins a
   *  pending value, which is narrower and exact on its own). */
  state: "" | "resolved" | "pending";
  /** Mirrors /leads + lead-intake: AGENTs may not see the source breakdown. */
  canSeeSource: boolean;
  /** Mirrors call-logs `showScopePickers` — AGENTs get no agent/team pickers. */
  showScopePickers: boolean;
  /** Mirrors call-logs `showTeamPicker` — ?team= is honoured for ADMIN only. */
  showTeamPicker: boolean;
}

export interface DimRow {
  key: string;
  label: string;
  count: Cell;
  connected: Cell;
  unsuccessful: Cell;
  /** connected / (connected + unsuccessful), null when the row has neither. */
  connectPct: number | null;
}

export interface CallReport {
  params: CallParams;
  rangeLabel: string;
  /** Exact total from a COUNT (never the capped row fetch). RESOLVED calls only
   *  — unresolved dials are in `pendingDials`, not here. */
  total: Cell;
  connected: Cell;
  unsuccessful: Cell;
  unclassifiedOutcome: Cell | null;
  /** Dial attempts with no result yet (INITIATED / RINGING) in the same slice.
   *  Deliberately OUTSIDE `total` and outside connected/unsuccessful: a dial is
   *  not a call. Surfaced so it is never silently dropped either — 0 today,
   *  non-zero the moment dial-on-tap ships. */
  pendingDials: Cell;
  connectRate: number | null;
  /** Distinct records (leads + buyers) touched by the counted calls. */
  recordsTouched: number;
  byAgent: DimRow[];
  byTeam: DimRow[];
  byModule: DimRow[];
  bySource: DimRow[];
  byProject: DimRow[];
  byOutcome: { key: string; label: string; group: "connected" | "unsuccessful" | "other" | "pending"; count: Cell; pct: number }[];
  /** EVERY CallOutcome, for the filter dropdown — byOutcome collapses to the
   *  pinned row when ?outcome= is active, so it cannot drive the picker. */
  outcomeOptions: { key: string; label: string }[];
  byBucket: { bucket: Bucket; count: Cell; connected: number; unsuccessful: number; pct: number }[];
  chartMax: number;
  attemptRows: { label: string; records: number; calls: Cell; note?: string }[];
  userRoster: { id: string; name: string; team: string | null }[];
  flags: string[];
}

// ── Date-key helpers (calendar math on "YYYY-MM-DD" keys is TZ-free) ─────────

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const minKey = (a: string, b: string) => (a < b ? a : b);
const maxKey = (a: string, b: string) => (a > b ? a : b);

function addDaysKey(key: string, n: number): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function mondayOf(key: string): string {
  const wd = istWeekday(new Date(`${key}T00:00:00+05:30`)); // 0=Sun…6=Sat
  return addDaysKey(key, wd === 0 ? -6 : 1 - wd);
}
function monthStart(key: string): string { return `${key.slice(0, 7)}-01`; }
function addMonthsKey(key: string, n: number): string {
  const y = parseInt(key.slice(0, 4)), m = parseInt(key.slice(5, 7));
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}-01`;
}
function monthEnd(key: string): string { return addDaysKey(addMonthsKey(monthStart(key), 1), -1); }
function fmtDay(key: string): string { return `${parseInt(key.slice(8, 10))} ${MONTHS[parseInt(key.slice(5, 7)) - 1]}`; }
function spanDays(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000) + 1;
}

/** The IST bucket key an instant falls in, at a given grain. */
function bucketKeyFor(dateKey: string, grain: BucketGrain): string {
  if (grain === "daily") return dateKey;
  if (grain === "weekly") return mondayOf(dateKey);
  if (grain === "monthly") return dateKey.slice(0, 7);
  return dateKey.slice(0, 4);
}

/** Buckets spanning [fromKey, toKey], each CLAMPED to the range so a bucket's
 *  ?from=&?to= drill opens exactly the rows counted into it (never the whole
 *  calendar week/month that overhangs the range edge). */
function buildBuckets(grain: BucketGrain, fromKey: string, toKey: string): Bucket[] {
  const out: Bucket[] = [];
  const push = (b: Bucket) => { if (out.length < 400) out.push(b); };
  if (grain === "daily") {
    for (let k = fromKey; k <= toKey; k = addDaysKey(k, 1)) push({ key: k, label: fmtDay(k), fromKey: k, toKey: k });
  } else if (grain === "weekly") {
    for (let mon = mondayOf(fromKey); mon <= toKey; mon = addDaysKey(mon, 7)) {
      const sun = addDaysKey(mon, 6);
      const f = maxKey(mon, fromKey), t = minKey(sun, toKey);
      push({ key: mon, label: `${fmtDay(f)}–${fmtDay(t)}`, fromKey: f, toKey: t });
    }
  } else if (grain === "monthly") {
    for (let ms = monthStart(fromKey); ms <= toKey; ms = addMonthsKey(ms, 1)) {
      push({
        key: ms.slice(0, 7),
        label: `${MONTHS[parseInt(ms.slice(5, 7)) - 1]} ${ms.slice(0, 4)}`,
        fromKey: maxKey(ms, fromKey), toKey: minKey(monthEnd(ms), toKey),
      });
    }
  } else {
    for (let y = parseInt(fromKey.slice(0, 4)); y <= parseInt(toKey.slice(0, 4)); y++) {
      push({
        key: String(y), label: String(y),
        fromKey: maxKey(`${y}-01-01`, fromKey), toKey: minKey(`${y}-12-31`, toKey),
      });
    }
  }
  return out;
}

// ── The drill-URL contract (ONE place) ───────────────────────────────────────
// Every drill opens /call-logs carrying the report's ACTIVE filters, with the
// drilled dimension overriding its own key. `null` in `override` REMOVES a key
// (used for the honest supersets). Param names are the list's own:
//   user · team · module · outcome · state · from · to
// Note: /call-logs honours ?team= for ADMIN only — a MANAGER is already
// team-locked server-side to that exact team, so the opened set is identical
// either way (still count==records for them). ?state= by contrast is honoured
// for EVERY role precisely so these drills stay exact for agents and managers.

type DrillKey = "user" | "team" | "module" | "outcome" | "state" | "from" | "to";
const DRILL_KEYS: DrillKey[] = ["user", "team", "module", "outcome", "state", "from", "to"];

/** Param names /call-logs would need for exact Source / Project drills. When
 *  the list gains them, set these + flip `exact` in the two builders below. */
export const SOURCE_PARAM: string | null = null;
export const PROJECT_PARAM: string | null = null;

function drillHref(p: CallParams, override: Partial<Record<DrillKey, string | null>> = {}): string {
  const base: Record<DrillKey, string> = {
    user: p.user, team: p.team, module: p.module, outcome: p.outcome,
    // Every drill inherits the report's resolved/pending stance, so a number
    // computed over resolved calls opens exactly the resolved calls.
    state: p.state,
    from: p.fromKey, to: p.toKey,
  };
  const u = new URLSearchParams();
  for (const k of DRILL_KEYS) {
    const v = k in override ? override[k] : base[k];
    if (v) u.set(k, v);
  }
  return `/call-logs?${u.toString()}`;
}

/** Report-self href (filter bar links / grain tabs) — same param names, so the
 *  report's own URL and its drills stay one vocabulary. */
export function reportHref(p: Partial<Record<DrillKey | "grain", string>>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) u.set(k, v);
  const q = u.toString();
  return `/reports/calls${q ? `?${q}` : ""}`;
}

// ── Param resolution ─────────────────────────────────────────────────────────

export async function resolveCallParams(
  sp: Record<string, string | undefined>,
  me: ScopedUser,
): Promise<CallParams> {
  const role = me.role;
  const canSeeSource = role !== "AGENT";      // mirrors /leads + lead-intake
  const showScopePickers = role !== "AGENT";  // mirrors call-logs
  const showTeamPicker = role === "ADMIN";    // mirrors call-logs (?team= is ADMIN-only)

  // Team — ADMIN may pick Dubai/India; a MANAGER is locked to their own team
  // (and the server scope pins it anyway); an AGENT gets none.
  let team = "";
  if (showTeamPicker) team = normalizeTeam(sp.team) ?? "";
  else if (role === "MANAGER") team = normalizeTeam(me.team) ?? "";

  // Agent — an AGENT can only ever be themselves (the server scope pins it).
  const user = role === "AGENT" ? "" : (sp.user ?? "").trim();

  // Module — the 4 ACTIVITY modules (never "Master Data": agents have no Master
  // Data calling UI). Ungated by market, exactly like the /call-logs filter, so
  // the report and its drill target can't disagree about what a module opens.
  const module = ACTIVITY_SOURCE_MODULES.includes(sp.module as SourceModule) ? sp.module! : "";
  const outcome = ALL_OUTCOMES.includes(sp.outcome ?? "") ? sp.outcome! : "";

  // Call STATE — the report counts RESOLVED calls by default, so an unresolved
  // dial can never inflate a call number. Two explicit escapes:
  //   ?state=pending  → the unresolved-dials slice (what the headline figure links to)
  //   ?outcome=INITIATED|RINGING → the user pinned a pending outcome, which is
  //     narrower AND exact on its own; forcing "resolved" on top would AND the
  //     two into the empty set and show a confusing 0. Clearing state here (and
  //     therefore in every drill href) keeps the report and /call-logs agreeing.
  const state: CallParams["state"] =
    isPendingCall(outcome) ? "" : sp.state === "pending" ? "pending" : "resolved";

  const grain: Grain = (["daily", "weekly", "monthly", "yearly", "custom"] as const)
    .includes(sp.grain as Grain) ? (sp.grain as Grain) : "daily";

  const todayKey = istDateKey();
  let fromKey: string, toKey: string;
  if (isValidDateKey(sp.from) && isValidDateKey(sp.to)) {
    // An explicit range always wins (that's what a drill-back carries).
    fromKey = minKey(sp.from, sp.to);
    toKey = maxKey(sp.from, sp.to);
  } else if (grain === "weekly") {
    fromKey = addDaysKey(mondayOf(todayKey), -77);          // 12 weeks incl. current
    toKey = todayKey;
  } else if (grain === "monthly") {
    fromKey = addMonthsKey(monthStart(todayKey), -11);      // 12 months incl. current
    toKey = todayKey;
  } else if (grain === "yearly") {
    // All years — from the earliest call the viewer could possibly count.
    const first = await prisma.callLog.aggregate({ _min: { startedAt: true } });
    fromKey = first._min.startedAt ? istDateKey(first._min.startedAt) : todayKey;
    toKey = todayKey;
  } else {
    fromKey = addDaysKey(todayKey, -29);                    // last 30 days
    toKey = todayKey;
  }

  // Effective bucket grain — a custom/huge range escalates so the chart + table
  // stay bounded (≤ ~130 buckets).
  const days = spanDays(fromKey, toKey);
  let bucketGrain: BucketGrain =
    grain === "custom" ? "daily" : (grain as BucketGrain);
  if (bucketGrain === "daily" && days > 92) bucketGrain = "weekly";
  if (bucketGrain === "weekly" && days > 730) bucketGrain = "monthly";
  if (bucketGrain === "monthly" && days > 3800) bucketGrain = "yearly";

  return { grain, bucketGrain, fromKey, toKey, user, team, module, outcome, state, canSeeSource, showScopePickers, showTeamPicker };
}

// ── Where-clause construction (byte-mirrors /call-logs) ──────────────────────

/** IST day window as the /call-logs page computes it — identical instants. */
function istWindow(fromKey: string, toKey: string): Prisma.DateTimeFilter<"CallLog"> {
  return { gte: istDayRange(fromKey).start, lt: istDayRange(toKey).end };
}

/**
 * The report's where == the list's where for the same params.
 * Returns the composed clause plus the role-scope pieces the caller may reuse.
 */
export async function callWhere(me: ScopedUser, p: CallParams): Promise<Prisma.CallLogWhereInput> {
  // 1. ROLE SCOPE — by ACTOR (call-logs scopeAnd, byte-mirrored).
  const scopeAnd: Prisma.CallLogWhereInput[] = [];
  const managerTeam = me.role === "MANAGER" ? normalizeTeam(me.team) : null;
  if (me.role === "AGENT") {
    scopeAnd.push({ userId: me.id });
  } else if (me.role === "MANAGER") {
    if (managerTeam) scopeAnd.push({ user: { team: managerTeam } });
    else {
      const ids = await visibleOwnerIds(me);
      if (ids) scopeAnd.push({ userId: { in: ids } });
    }
  }

  // 2. LIVE ENVELOPE — the ONE line that makes the surface centralized: a call
  //    counts when its lead is live OR its buyer is live. Buyer-linked rows work
  //    from day one; unlinked calls stay out of both surfaces.
  const linkedAnd: Prisma.CallLogWhereInput = {
    OR: [{ lead: { deletedAt: null } }, { buyer: { deletedAt: null } }],
  };

  // 3. FILTERS — parsed exactly as the list parses them.
  const filterAnd: Prisma.CallLogWhereInput[] = [];
  if (p.user) filterAnd.push({ userId: p.user });
  // ?team= is ADMIN-only on the list; a MANAGER is already scoped to that team
  // above, so replicating the ADMIN-only gate keeps the two sets identical.
  if (p.team && me.role === "ADMIN") filterAnd.push({ user: { team: p.team } });
  if (p.outcome) filterAnd.push({ outcome: p.outcome as CallOutcome });
  // ?state= — byte-mirrors the /call-logs predicate (same param, same two arms,
  // same PENDING set imported from lib/ghosting), and like the list it applies
  // to EVERY role. This is what keeps "Total calls" == the rows its link opens
  // once dial-on-tap starts writing unresolved rows.
  if (p.state === "pending") {
    filterAnd.push({ outcome: { in: [...PENDING_CALL_OUTCOMES] } });
  } else if (p.state === "resolved") {
    filterAnd.push({ outcome: { notIn: [...PENDING_CALL_OUTCOMES] } });
  }
  filterAnd.push({ startedAt: istWindow(p.fromKey, p.toKey) });
  const mod = moduleWhere(p.module);
  if (mod) filterAnd.push(mod);

  return { AND: [...scopeAnd, linkedAnd, ...filterAnd] };
}

/** The list's ?module= predicate, byte-mirrored (call-logs/page.tsx). */
function moduleWhere(module: string): Prisma.CallLogWhereInput | null {
  if (!module || !ACTIVITY_SOURCE_MODULES.includes(module as SourceModule)) return null;
  const m = module as SourceModule;
  if (m === "India Buyer Data" || m === "Dubai Buyer Data") {
    const market = m === "India Buyer Data" ? "India" : "Dubai";
    return { buyer: { is: { market, deletedAt: null } } };
  }
  if (m === "Revival Engine") {
    return { lead: { is: { deletedAt: null, OR: [{ leadOrigin: { in: ["COLD", "REVIVAL"] } }, { isColdCall: true }] } } };
  }
  // "Leads" = every NON-revival lead call (master-origin INCLUDED — an activity
  // on a master-origin lead is worked from the Leads queue).
  return { lead: { is: { deletedAt: null, isColdCall: false, leadOrigin: { notIn: ["COLD", "REVIVAL"] } } } };
}

// ── The builder ──────────────────────────────────────────────────────────────

/** Hard cap on the aggregation fetch. The TOTAL always comes from a COUNT, so a
 *  cap can never silently understate the headline — it raises a loud flag. */
const MAX_ROWS = 60_000;

export async function buildCallReport(me: ScopedUser, p: CallParams): Promise<CallReport> {
  const where = await callWhere(me, p);
  // UNRESOLVED DIALS — the same slice (scope · team · user · module · date) with
  // the outcome pin dropped and state forced to pending. Counted SEPARATELY and
  // shown as its own headline figure: excluded from every call number above, but
  // never silently discarded. Its drill drops ?outcome= too, so the link opens
  // exactly the rows this number counts (count==records holds for it as well).
  const pendingWhere = await callWhere(me, { ...p, state: "pending", outcome: "" });
  const flags: string[] = [];

  const [total, pendingN, rows, userRoster] = await Promise.all([
    prisma.callLog.count({ where }),
    prisma.callLog.count({ where: pendingWhere }),
    // ONE bounded fetch feeds EVERY table — agent/team/module/source/project/
    // outcome/date/attempt all partition the SAME rows, so they reconcile by
    // construction (no per-table query can drift from the headline).
    prisma.callLog.findMany({
      where,
      take: MAX_ROWS,
      orderBy: { startedAt: "desc" },
      select: {
        userId: true, outcome: true, startedAt: true, attributedAgentName: true,
        leadId: true, buyerId: true,
        user: { select: { name: true, team: true } },
        lead: { select: { leadOrigin: true, isColdCall: true, sourceRaw: true, source: true, sourceDetail: true } },
        buyer: { select: { market: true, source: true, projectName: true } },
      },
    }),
    rosterFor(me),
  ]);

  if (rows.length >= MAX_ROWS && total > rows.length) {
    flags.push(
      `Range holds ${total.toLocaleString()} calls — breakdown tables are computed over the most recent ${MAX_ROWS.toLocaleString()}. Narrow the date range for exact per-dimension numbers (the headline total is exact).`,
    );
  }

  // ── Single-pass aggregation ────────────────────────────────────────────────
  type Agg = { n: number; connected: number; unsuccessful: number };
  const blank = (): Agg => ({ n: 0, connected: 0, unsuccessful: 0 });
  const add = (m: Map<string, Agg>, k: string, connected: boolean, unsuccessful: boolean) => {
    const a = m.get(k) ?? blank();
    a.n++; if (connected) a.connected++; if (unsuccessful) a.unsuccessful++;
    m.set(k, a);
  };

  const agentAgg = new Map<string, Agg>();
  const agentIds = new Map<string, Set<string | null>>(); // display name → userIds seen
  const perUserId = new Map<string, number>();            // userId → rows (leak check)
  const teamAgg = new Map<string, Agg>();
  const moduleAgg = new Map<string, Agg>();
  const sourceAgg = new Map<string, Agg>();
  const projectAgg = new Map<string, Agg>();
  const outcomeAgg = new Map<string, number>();
  const bucketAgg = new Map<string, Agg>();
  const perRecord = new Map<string, number>();

  let connectedN = 0, unsuccessfulN = 0, residualN = 0;

  for (const r of rows) {
    const connected = isMeaningfulOutcome(r.outcome);
    const unsuccessful = isUnsuccessfulOutcome(r.outcome);
    if (connected) connectedN++; else if (unsuccessful) unsuccessfulN++; else residualN++;

    // AGENT — display attribution mirrors the list exactly:
    // attributedAgentName ?? user.name ?? "Unknown Agent".
    const agentName = r.attributedAgentName ?? r.user?.name ?? "Unknown Agent";
    add(agentAgg, agentName, connected, unsuccessful);
    const seen = agentIds.get(agentName) ?? new Set<string | null>();
    seen.add(r.userId); agentIds.set(agentName, seen);
    if (r.userId) perUserId.set(r.userId, (perUserId.get(r.userId) ?? 0) + 1);

    // TEAM — the ACTOR's team (the list filters `user.team`), verbatim so a
    // "HQ" / null team is its own visible bucket rather than folded away.
    add(teamAgg, r.user?.team ?? "", connected, unsuccessful);

    // MODULE / SOURCE / PROJECT — derived per row from the LINKED record.
    // Lead wins when a row somehow carries both (mirrors the list's render).
    if (r.lead) {
      add(moduleAgg, activityLeadModule(r.lead.leadOrigin, r.lead.isColdCall), connected, unsuccessful);
      add(sourceAgg, effectiveSource(r.lead.sourceRaw, r.lead.source).trim(), connected, unsuccessful);
      add(projectAgg, (r.lead.sourceDetail ?? "").trim(), connected, unsuccessful);
    } else if (r.buyer) {
      add(moduleAgg, buyerSourceModule(r.buyer.market), connected, unsuccessful);
      add(sourceAgg, (r.buyer.source ?? "").trim(), connected, unsuccessful);
      add(projectAgg, (r.buyer.projectName ?? "").trim(), connected, unsuccessful);
    }

    outcomeAgg.set(r.outcome, (outcomeAgg.get(r.outcome) ?? 0) + 1);
    add(bucketAgg, bucketKeyFor(istDateKey(r.startedAt), p.bucketGrain), connected, unsuccessful);

    const rec = r.leadId ? `L:${r.leadId}` : r.buyerId ? `B:${r.buyerId}` : null;
    if (rec) perRecord.set(rec, (perRecord.get(rec) ?? 0) + 1);
  }

  // ── Cell factories ─────────────────────────────────────────────────────────
  const exactCell = (n: number, o: Partial<Record<DrillKey, string | null>>): Cell =>
    ({ n, href: drillHref(p, o), exact: true });
  const supersetCell = (n: number, note: string, o: Partial<Record<DrillKey, string | null>> = {}): Cell =>
    ({ n, href: drillHref(p, o), exact: false, note });

  // Connected / Unsuccessful groups: ?outcome= takes ONE value, so the GROUP is a
  // superset link and each member chip is exact. Σ(chips) == group, by construction.
  const groupCell = (n: number, members: readonly string[], what: string): Cell => {
    const parts = members
      .filter((o) => (outcomeAgg.get(o) ?? 0) > 0)
      .map((o) => ({
        label: OUTCOME_LABELS[o] ?? o,
        n: outcomeAgg.get(o) ?? 0,
        href: drillHref(p, { outcome: o }),
        exact: true,
      }));
    // When the report is ALREADY pinned to one outcome, the group containing it
    // IS the whole slice — the plain slice link is then exact. The other group is
    // necessarily 0, and no URL can express an empty set, so it stays a superset.
    if (p.outcome) {
      const contains = members.includes(p.outcome);
      return {
        n,
        href: drillHref(p),
        exact: contains,
        note: contains
          ? undefined
          : `the slice is filtered to ${OUTCOME_LABELS[p.outcome] ?? p.outcome}, so it holds no ${what} calls — this link opens the filtered slice (superset of the 0 counted)`,
        parts,
      };
    }
    return {
      n,
      href: drillHref(p, { outcome: null }),
      exact: false,
      note: `/call-logs?outcome= takes one value — this opens all outcomes in the slice. The ${what} chips below are exact and sum to ${n.toLocaleString()}.`,
      parts,
    };
  };

  // ── By AGENT ───────────────────────────────────────────────────────────────
  // A bucket drills exactly ONLY when it maps 1:1 to a single userId AND that
  // userId contributes no rows to any OTHER bucket (an imported call carrying
  // attributedAgentName can display under a different name than its userId).
  const byAgent: DimRow[] = [...agentAgg.entries()]
    .map(([name, a]) => {
      const ids = [...(agentIds.get(name) ?? [])];
      const onlyId = ids.length === 1 ? ids[0] : null;
      const clean = onlyId !== null && perUserId.get(onlyId) === a.n;
      return {
        key: name,
        label: name,
        count: clean
          ? exactCell(a.n, { user: onlyId! })
          : supersetCell(
              a.n,
              onlyId === null && ids.length === 1
                ? "these calls have no CRM user (Unknown Agent) — no ?user= value exists; opens the whole slice (superset)"
                : "name attributed from imported remarks (attributedAgentName) — it does not map 1:1 to a ?user= id; opens the whole slice (superset)",
              { user: null },
            ),
        connected: clean
          ? supersetCell(a.connected, "connected = 4 outcomes; ?outcome= takes one — opens this agent's full slice", { user: onlyId!, outcome: null })
          : supersetCell(a.connected, "no exact ?user= value for this bucket (superset)", { user: null, outcome: null }),
        unsuccessful: clean
          ? supersetCell(a.unsuccessful, "unsuccessful = 4 outcomes; ?outcome= takes one — opens this agent's full slice", { user: onlyId!, outcome: null })
          : supersetCell(a.unsuccessful, "no exact ?user= value for this bucket (superset)", { user: null, outcome: null }),
        connectPct: a.connected + a.unsuccessful > 0 ? (a.connected / (a.connected + a.unsuccessful)) * 100 : null,
      };
    })
    .sort((x, y) => y.count.n - x.count.n);

  // ── By TEAM ────────────────────────────────────────────────────────────────
  // ?team= only accepts a normalizeTeam() value AND is honoured for ADMIN only,
  // so a "HQ"/blank team (or any non-admin viewer) gets an honest superset.
  const byTeam: DimRow[] = [...teamAgg.entries()]
    .map(([key, a]) => {
      const linkable = !!normalizeTeam(key) && p.showTeamPicker;
      const note = !normalizeTeam(key)
        ? "no ?team= value exists for this team (the list accepts Dubai / India only) — opens the whole slice (superset)"
        : "?team= is applied for ADMIN only on /call-logs; your view is already scoped to your team, so the link opens the same rows";
      return {
        key,
        label: key === "" ? "Unclassified (no team)" : key === "Dubai" || key === "India" ? `${key} team` : key,
        count: linkable ? exactCell(a.n, { team: key }) : supersetCell(a.n, note, { team: null }),
        connected: supersetCell(a.connected, "connected = 4 outcomes; ?outcome= takes one — opens the team slice", linkable ? { team: key, outcome: null } : { team: null, outcome: null }),
        unsuccessful: supersetCell(a.unsuccessful, "unsuccessful = 4 outcomes; ?outcome= takes one — opens the team slice", linkable ? { team: key, outcome: null } : { team: null, outcome: null }),
        connectPct: a.connected + a.unsuccessful > 0 ? (a.connected / (a.connected + a.unsuccessful)) * 100 : null,
      };
    })
    .sort((x, y) => y.count.n - x.count.n);

  // ── By MODULE ──────────────────────────────────────────────────────────────
  // Every ACTIVITY module is shown (even at 0) so a module going quiet is visible
  // rather than absent — and buyer modules are present from day one.
  //
  // EXCEPT when ?module= already pins the slice: the other modules are then
  // trivially 0, and their drill (which would OVERRIDE the pinned module) would
  // open a non-empty set — "0" linking to 3,419 rows. A pinned dimension collapses
  // to its own row so no number can ever contradict what its link opens.
  const moduleKeys = p.module
    ? ACTIVITY_SOURCE_MODULES.filter((m) => m === p.module)
    : ACTIVITY_SOURCE_MODULES;
  const byModule: DimRow[] = moduleKeys.map((m) => {
    const a = moduleAgg.get(m) ?? blank();
    return {
      key: m,
      label: m,
      count: exactCell(a.n, { module: m }),
      connected: supersetCell(a.connected, "connected = 4 outcomes; ?outcome= takes one — opens the module slice", { module: m, outcome: null }),
      unsuccessful: supersetCell(a.unsuccessful, "unsuccessful = 4 outcomes; ?outcome= takes one — opens the module slice", { module: m, outcome: null }),
      connectPct: a.connected + a.unsuccessful > 0 ? (a.connected / (a.connected + a.unsuccessful)) * 100 : null,
    };
  }).sort((x, y) => y.count.n - x.count.n);

  // ── By SOURCE / PROJECT ────────────────────────────────────────────────────
  // /call-logs has NO ?source= / ?project= param, so every row here is an honest
  // SUPERSET of the counted calls: the link opens the same filtered slice without
  // the source/project narrowing, and says so. A fake ?source= would be silently
  // IGNORED by the list and return a different set than the number claims — the
  // exact failure mode this report exists to prevent.
  //
  // TO MAKE THESE EXACT: add the param to /call-logs, set SOURCE_PARAM /
  // PROJECT_PARAM above, and swap supersetCell → exactCell here. Nothing else
  // changes — the aggregation is already keyed on the verbatim value the param
  // would carry (lead sourceRaw via effectiveSource / buyer source; lead
  // sourceDetail / buyer projectName).
  const dimNoParam = (m: Map<string, Agg>, blankLabel: string, gap: string): DimRow[] =>
    [...m.entries()]
      .map(([k, a]) => {
        const note = k === ""
          ? `${blankLabel} — and ${gap}; opens the whole slice (superset)`
          : `${gap}; opens the whole slice (superset)`;
        return {
          key: k,
          label: k === "" ? blankLabel : k,
          count: supersetCell(a.n, note),
          connected: supersetCell(a.connected, note),
          unsuccessful: supersetCell(a.unsuccessful, note),
          connectPct: a.connected + a.unsuccessful > 0 ? (a.connected / (a.connected + a.unsuccessful)) * 100 : null,
        };
      })
      .sort((x, y) => y.count.n - x.count.n);

  const bySource = dimNoParam(sourceAgg, "Unclassified (no source)", "/call-logs has no ?source= filter");
  const byProject = dimNoParam(projectAgg, "Unclassified (no project)", "/call-logs has no ?project= filter");

  // ── By OUTCOME (each one exact) ────────────────────────────────────────────
  const orderedOutcomes = ([
    ...MEANINGFUL_CALL_OUTCOMES, ...UNSUCCESSFUL_CALL_OUTCOMES, ...RESIDUAL_OUTCOMES,
    ...PENDING_OUTCOMES,
  ] as string[])
    // Same rule as byModule: a pinned ?outcome= collapses this table to its own
    // row, so a synthetic 0 can never link to a non-empty set.
    .filter((o) => !p.outcome || o === p.outcome)
    // Pending states are excluded from the report body, so they would otherwise
    // sit here as permanent 0-rows implying "no dials ever". They appear only
    // when they actually carry counts — i.e. when ?outcome= pinned one of them.
    // The headline `pendingDials` figure is where unresolved dials are reported.
    .filter((o) => !isPendingCall(o) || (outcomeAgg.get(o) ?? 0) > 0);
  const byOutcome = orderedOutcomes.map((o) => {
    const n = outcomeAgg.get(o) ?? 0;
    return {
      key: o,
      label: OUTCOME_LABELS[o] ?? o,
      group: (isPendingCall(o) ? "pending"
        : isMeaningfulOutcome(o) ? "connected"
        : isUnsuccessfulOutcome(o) ? "unsuccessful" : "other") as
        "connected" | "unsuccessful" | "other" | "pending",
      count: exactCell(n, { outcome: o }),
      pct: rows.length ? (n / rows.length) * 100 : 0,
    };
  });

  // ── By DATE bucket (each one exact via ?from=&?to=) ────────────────────────
  const buckets = buildBuckets(p.bucketGrain, p.fromKey, p.toKey);
  const byBucket = buckets.map((bucket) => {
    const a = bucketAgg.get(bucket.key) ?? blank();
    return {
      bucket,
      count: exactCell(a.n, { from: bucket.fromKey, to: bucket.toKey }),
      connected: a.connected,
      unsuccessful: a.unsuccessful,
      pct: rows.length ? (a.n / rows.length) * 100 : 0,
    };
  });
  const chartMax = Math.max(1, ...byBucket.map((b) => b.count.n));

  // ── ATTEMPT-WISE ───────────────────────────────────────────────────────────
  // METHOD: calls-per-linked-record COUNTED IN THIS SLICE (group CallLog by
  // leadId/buyerId, then distribute records by how many calls they received).
  // Chosen over Lead.attemptCount because (a) it works identically for BUYER
  // records, which have no comparable owner-cycle counter on the call table,
  // (b) it respects the report's own filters, and (c) Lead.attemptCount is
  // OWNER-SPECIFIC and reset by assignLeadTo (lib/ghosting.resetAttemptCycleData),
  // so it answers a different question ("attempts by the CURRENT owner") and
  // would not reconcile with the calls shown here. Σ(bucket calls) == total calls.
  const dist = new Map<number, number>();
  for (const n of perRecord.values()) dist.set(n, (dist.get(n) ?? 0) + 1);
  const attemptNote = "no per-record attempt filter exists on /call-logs — opens the whole slice (superset)";
  const attemptRows: { label: string; records: number; calls: Cell; note?: string }[] = [];
  let tailRecords = 0, tailCalls = 0;
  for (const [calls, recs] of [...dist.entries()].sort((a, b) => a[0] - b[0])) {
    if (calls <= 9) {
      attemptRows.push({
        label: `${calls} call${calls === 1 ? "" : "s"}`,
        records: recs,
        calls: supersetCell(calls * recs, attemptNote),
      });
    } else { tailRecords += recs; tailCalls += calls * recs; }
  }
  if (tailRecords) {
    attemptRows.push({ label: "10+ calls", records: tailRecords, calls: supersetCell(tailCalls, attemptNote) });
  }

  // ── Headline cells ─────────────────────────────────────────────────────────
  if (residualN > 0) {
    flags.push(
      `${residualN.toLocaleString()} call(s) carry an outcome outside both the connected and unsuccessful sets — shown as their own bucket rather than folded into "missed". Classify the new CallOutcome value in reports/calls/calls.ts.`,
    );
  }
  if (total !== rows.length && rows.length < MAX_ROWS) {
    flags.push(`Internal check: headline count (${total}) and aggregated rows (${rows.length}) disagree — report this.`);
  }
  // Unresolved dials are expected to be a thin sliver: a row sits at INITIATED /
  // RINGING only between the tap and the result. A large share means dials are
  // NOT being transitioned — a telephony/webhook fault — and those calls are
  // missing from every call metric until it is fixed. Loud, with the fix target.
  if (pendingN > 0 && pendingN > (total + pendingN) * 0.05) {
    flags.push(
      `${pendingN.toLocaleString()} dial(s) in this range never resolved (${((pendingN / (total + pendingN)) * 100).toFixed(1)}% of all dials) — they are counted in "Dial attempts (unresolved)" and in NO call metric. A share this high usually means the call-state transition is not firing; check the telephony webhook / call-state update path.`,
    );
  }

  const rangeLabel = p.fromKey === p.toKey
    ? `${fmtDay(p.fromKey)} ${p.fromKey.slice(0, 4)} (IST)`
    : `${fmtDay(p.fromKey)} ${p.fromKey.slice(0, 4)} – ${fmtDay(p.toKey)} ${p.toKey.slice(0, 4)} (IST)`;

  return {
    params: p,
    rangeLabel,
    total: { n: total, href: drillHref(p), exact: true },
    connected: groupCell(connectedN, MEANINGFUL_CALL_OUTCOMES, "connected"),
    unsuccessful: groupCell(unsuccessfulN, UNSUCCESSFUL_CALL_OUTCOMES, "unsuccessful"),
    unclassifiedOutcome: residualN > 0
      ? groupCell(residualN, RESIDUAL_OUTCOMES, "unclassified")
      : null,
    pendingDials: { n: pendingN, href: drillHref(p, { state: "pending", outcome: null }), exact: true },
    connectRate: connectedN + unsuccessfulN > 0 ? (connectedN / (connectedN + unsuccessfulN)) * 100 : null,
    recordsTouched: perRecord.size,
    byAgent, byTeam, byModule, bySource, byProject, byOutcome, byBucket, chartMax,
    outcomeOptions: ([
      ...MEANINGFUL_CALL_OUTCOMES, ...UNSUCCESSFUL_CALL_OUTCOMES, ...RESIDUAL_OUTCOMES,
      ...PENDING_OUTCOMES,
    ] as string[])
      .map((o) => ({ key: o, label: OUTCOME_LABELS[o] ?? o })),
    attemptRows, userRoster, flags,
  };
}

/** Agent picker roster — byte-mirrors the /call-logs roster query so the report
 *  can never offer an agent the list would refuse to filter by. */
async function rosterFor(me: ScopedUser): Promise<{ id: string; name: string; team: string | null }[]> {
  if (me.role === "AGENT") return [];
  const rosterWhere: Prisma.UserWhereInput = { active: true, hrOnly: false };
  if (me.role === "MANAGER") {
    const managerTeam = normalizeTeam(me.team);
    if (managerTeam) rosterWhere.team = managerTeam;
    else {
      const ids = await visibleOwnerIds(me);
      if (ids) rosterWhere.id = { in: ids };
    }
  }
  return prisma.user.findMany({
    where: rosterWhere,
    orderBy: { name: "asc" },
    select: { id: true, name: true, team: true },
  });
}
