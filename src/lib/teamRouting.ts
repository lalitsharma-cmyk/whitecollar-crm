// ─────────────────────────────────────────────────────────────────────────────
// teamRouting.ts — the MANDATORY Lead Routing Layer (single source of truth)
//
// Every lead must belong to a TEAM (India | Dubai) BEFORE any assignment or
// automation runs. This module is the one place that decides a team and the one
// place that says whether a lead is allowed to be automated yet.
//
// HARD RULE (Lalit, repeated): "team" is an INTERNAL label tied to the inquired
// MARKET / property / source — NEVER to the client's phone number, country, or
// currency. An Indian (+91) investor asking about a Dubai project is a DUBAI
// lead. A UAE-resident asking about Gurgaon is an INDIA lead. So resolveTeam()
// deliberately ignores phone / country / city / currency. Do NOT "fix" this by
// adding geo inference — that is a regression, not an improvement.
//
// PURE module on purpose: no Prisma, no settings, no secrets — so it can be
// imported from server routes, the reconciler, AND plain tsx scripts. The
// testing-mode kill-switch is combined at the call site (see automationGate()).
// ─────────────────────────────────────────────────────────────────────────────

export type Team = "India" | "Dubai";

export const TEAMS: readonly Team[] = ["India", "Dubai"] as const;

/** The opposite team — used by the cross-team manual-assign warning. */
export function otherTeam(t: Team): Team {
  return t === "India" ? "Dubai" : "India";
}

/**
 * Canonicalise any user / column / API string into a real Team or null.
 * Accepts loose input ("dubai", " DUBAI ", "uae"→Dubai, "in"/"ind"→India) and
 * returns null for anything it can't confidently map. NEVER throws.
 */
export function normalizeTeam(v: string | null | undefined): Team | null {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "dubai" || s === "uae" || s === "dxb" || s === "ae") return "Dubai";
  if (s === "india" || s === "in" || s === "ind" || s === "bharat") return "India";
  return null;
}

/** True once a lead has been classified. THE pre-assignment routing gate. */
export function isTeamClassified(forwardedTeam: string | null | undefined): boolean {
  return normalizeTeam(forwardedTeam) !== null;
}

// ── Routing provenance ───────────────────────────────────────────────────────
// "manual"           — a human explicitly picked the team (lead form, admin queue)
// "import"           — a bulk-import file/column supplied the team
// "rule"             — auto-classified from an unambiguous market signal
// "round_robin_pool" — (set by the assigner, not here) routed within a team pool
// "admin_queue"      — pulled out of the awaiting-team queue and assigned
export type RoutingMethod =
  | "manual"
  | "import"
  | "rule"
  | "round_robin_pool"
  | "admin_queue";

export interface RoutingSignals {
  /** Explicit team pick: manual form, CSV "Team" column, admin queue. Highest priority. */
  forceTeam?: string | null;
  /** Where the explicit pick came from, for provenance: "manual_form" | "csv" | "admin_queue" | … */
  forceMethod?: RoutingMethod;
  /** LeadSource enum value as a string (WEBSITE, WHATSAPP, FACEBOOK_ADS, …). */
  source?: string | null;
  /** Campaign code / landing slug, e.g. "marina-may-26", "gurgaon-launch". */
  sourceDetail?: string | null;
  /** Inquired project slug/name, when known. */
  projectSlug?: string | null;
  /** Landing / referrer URL, when known. */
  url?: string | null;
  /** Free-text inquiry / notes — scanned only as a LAST resort. */
  text?: string | null;
}

export interface RoutingResult {
  /** null = could NOT classify → caller must park the lead as awaiting-team. */
  team: Team | null;
  method: RoutingMethod | null;
  /** Machine tag for routingSource, e.g. "manual_form", "csv", "website:dubai-market". */
  source: string | null;
  /** Human-readable routingReason for the audit + lead-detail display. */
  reason: string | null;
}

// ── Market keyword maps ──────────────────────────────────────────────────────
// ONLY unambiguous GEOGRAPHIC / market terms. Developer brand names that operate
// in both markets (e.g. "Sobha" → Dubai Hartland AND Bangalore) are deliberately
// EXCLUDED — they cause misroutes. Extend cautiously; when in doubt leave it out
// so the lead parks as awaiting-team and a human classifies it.
const DUBAI_TERMS = [
  "dubai", "uae", "u.a.e", "emirates", "abu dhabi", "sharjah",
  "dubai marina", "marina", "downtown dubai", "business bay", "palm jumeirah",
  "jumeirah", "jbr", "jvc", "dubai creek", "dubai hills", "dubai south",
  "damac hills", "expo city", "meydan",
  // Unambiguous Dubai developers + projects (bare "emaar"/"sobha" left OUT — they
  // also build in India; use their Dubai-specific project names instead).
  "damac", "danube", "nakheel", "aldar", "binghatti", "azizi", "ellington",
  "meraas", "sobha hartland", "sobha realty", "emaar beachfront",
];
const INDIA_TERMS = [
  "india", "bharat", "gurgaon", "gurugram", "noida", "greater noida",
  "delhi", "ncr", "mumbai", "navi mumbai", "pune", "bengaluru", "bangalore",
  "hyderabad", "chennai", "kolkata", "goa", "commercial-india", "india-commercial",
  // Unambiguous India (Gurgaon/NCR) developers + projects — route by project name
  // when the inquiry carries no city word (e.g. "Central Park Resort").
  "central park", "m3m", "dlf", "smartworld", "tarc", "signature global",
  "elan", "silverglades", "experion", "whiteland", "krisumi", "bptp", "godrej", "sohna",
];

function hay(...parts: Array<string | null | undefined>): string {
  return parts.map((p) => (p ?? "")).join("  ").toLowerCase();
}
function hits(text: string, terms: string[]): boolean {
  // Word-ish boundary so "marina" doesn't match inside an unrelated word and
  // "india" doesn't match "indiana"-style noise. Terms may contain spaces.
  return terms.some((t) => new RegExp(`(^|[^a-z])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(text));
}

/**
 * Decide a lead's team from the available signals.
 *
 * Priority:
 *   1. Explicit forceTeam (human pick / import column) — always wins.
 *   2. An UNAMBIGUOUS market keyword in projectSlug / sourceDetail / url / text.
 *      If both markets match, or neither does, we DO NOT guess.
 *   3. null → awaiting-team. (Generic source/portal is intentionally NOT routed:
 *      WCR advertises Dubai property on Indian portals too, so the portal alone
 *      is not a reliable market signal.)
 *
 * Never uses phone / country / city / currency. See the HARD RULE up top.
 */
export function resolveTeam(signals: RoutingSignals): RoutingResult {
  // 1. Explicit pick.
  const forced = normalizeTeam(signals.forceTeam);
  if (forced) {
    const method = signals.forceMethod ?? "manual";
    return {
      team: forced,
      method,
      source: method === "import" ? "csv" : method === "admin_queue" ? "admin_queue" : "manual_form",
      reason: `Team ${forced} set explicitly (${method.replace(/_/g, " ")})`,
    };
  }

  // 2. Unambiguous market keyword.
  const text = hay(signals.projectSlug, signals.sourceDetail, signals.url, signals.text);
  const isDubai = hits(text, DUBAI_TERMS);
  const isIndia = hits(text, INDIA_TERMS);
  if (isDubai && !isIndia) {
    return { team: "Dubai", method: "rule", source: "market:dubai", reason: "Auto-routed: Dubai market signal in inquiry/landing" };
  }
  if (isIndia && !isDubai) {
    return { team: "India", method: "rule", source: "market:india", reason: "Auto-routed: India market signal in inquiry/landing" };
  }

  // 3. Could not classify — park as awaiting-team.
  return { team: null, method: null, source: null, reason: null };
}

/** Convenience: map a RoutingResult onto the three Lead routing columns. */
export function routingFieldsFor(r: RoutingResult): {
  routingMethod: string | null;
  routingSource: string | null;
  routingReason: string | null;
} {
  return { routingMethod: r.method, routingSource: r.source, routingReason: r.reason };
}

// ── Manual-assignment cross-team guard (DECISION: warn, but ALLOW) ────────────
// Lalit chose soft enforcement: a manager CAN move a lead across teams, but the
// UI/API must surface a clear warning and record it. Returns a warning string
// when the actor's team differs from the lead's team, else null.
export function crossTeamWarning(
  actorTeam: string | null | undefined,
  leadTeam: string | null | undefined,
): string | null {
  const a = normalizeTeam(actorTeam);
  const l = normalizeTeam(leadTeam);
  if (!a || !l) return null;       // unknown either side → nothing to warn about
  if (a === l) return null;
  return `Cross-team assignment: this is a ${l} lead being assigned by a ${a}-team user. Allowed, but please confirm this is intentional.`;
}

// ── The full automation gate (team + testing-mode) ───────────────────────────
// THE mandatory rule: NO automation (round-robin, auto-assign, speed-to-lead,
// SLA escalation, auto-WA, workflow triggers, AI scoring) may run before a lead
// has a team. testingMode is the separate global pause kill-switch. Call sites
// pass their already-loaded testingMode value so this stays a pure function.
export interface AutomationGate {
  ok: boolean;
  /** Why automation is blocked — for logging / awaiting-team notifications. */
  reason: string | null;
}
export function automationGate(
  forwardedTeam: string | null | undefined,
  testingModeEnabled: boolean,
): AutomationGate {
  if (!isTeamClassified(forwardedTeam)) {
    return { ok: false, reason: "awaiting team classification — automation suppressed until a team is assigned" };
  }
  if (testingModeEnabled) {
    return { ok: false, reason: "testing mode is ON — automation paused globally" };
  }
  return { ok: true, reason: null };
}
