// =====================================================
// GAMIFICATION — shared constants + pure helpers
// =====================================================
// Motivates cold-calling + follow-up discipline without making the CRM
// childish. Aesthetic is premium luxury brokerage: subtle, gold-tinted,
// no confetti. All numeric thresholds are tuned for Lalit's team (small
// brokerage, ~5–15 agents, daily call volume ~30–80/agent).
//
// This module is SAFE TO IMPORT FROM CLIENT COMPONENTS — it has no
// prisma/db dependency, only constants and pure functions (level
// lookup, badge id parsing). The DB-touching helpers (awardXp, bumpStreak,
// checkAndAwardBadges) live in `gamification.server.ts` and import
// `server-only`. Split this way because XPBar.tsx (client) needs the
// LEVELS + BADGES tables and levelForXp() but must not pull in prisma.
//
// Schema fields owned by these modules (already on prisma User):
//   xp Int @default(0)
//   dailyStreak Int @default(0)
//   followupStreak Int @default(0)
//   coldCallStreak Int @default(0)
//   lastStreakDay String?    — "YYYY-MM-DD" in IST (the day the streak ticked)
//   badges String @default("")  — comma-separated badge ids

// ── XP awards per action ──────────────────────────────────────────
// Calibrated so a typical busy day (40 calls + 5 connects + 2 follow-ups)
// earns ~600 XP → roughly one level every ~2-3 working days early on,
// slowing dramatically at the upper tiers (Market Shark / White Collar Elite).
export const XP_VALUES = {
  CALL_LOGGED: 10,
  CALL_CONNECTED: 20,
  FOLLOWUP_COMPLETED: 30,
  COLD_TO_LEAD: 50,
  MEETING_BOOKED: 75,
  SITE_VISIT_COMPLETED: 100,
  NEGOTIATION_STARTED: 250,
  BOOKING_DONE: 500,
} as const;

export type XpReason = keyof typeof XP_VALUES;

// Human-readable label used in toasts ("+20 XP · Connected call").
// Keep terse — toast width is ~260px on mobile.
export const XP_LABELS: Record<XpReason, string> = {
  CALL_LOGGED: "Call logged",
  CALL_CONNECTED: "Connected call",
  FOLLOWUP_COMPLETED: "Follow-up done",
  COLD_TO_LEAD: "Cold prospect promoted",
  MEETING_BOOKED: "Meeting booked",
  SITE_VISIT_COMPLETED: "Site visit done",
  NEGOTIATION_STARTED: "Negotiation started",
  BOOKING_DONE: "Booking closed",
};

// ── Level tiers ────────────────────────────────────────────────────
// Each level has a min-XP threshold. Level lookup is linear (10 entries,
// cheaper than a binary search and easier to read).
export const LEVELS = [
  { min: 0,     name: "Rookie Broker" },
  { min: 200,   name: "Lead Hunter" },
  { min: 500,   name: "Follow-Up Fighter" },
  { min: 1000,  name: "Deal Hunter" },
  { min: 2000,  name: "Site Visit Specialist" },
  { min: 4000,  name: "Negotiation Pro" },
  { min: 7000,  name: "Luxury Advisor" },
  { min: 12000, name: "Elite Closer" },
  { min: 20000, name: "Market Shark" },
  { min: 35000, name: "White Collar Elite" },
] as const;

export type Level = (typeof LEVELS)[number];

export interface LevelInfo {
  level: Level;
  index: number;
  next: Level | null;       // null = at max level
  progressPct: number;      // 0-100 toward next level (100 if maxed)
}

/** Resolve the current level for an XP total, plus next-level threshold + progress %. */
export function levelForXp(xp: number): LevelInfo {
  const safeXp = Number.isFinite(xp) && xp > 0 ? Math.floor(xp) : 0;
  // Walk from highest down — first match wins.
  let index = 0;
  for (let i = LEVELS.length - 1; i >= 0; i--) {
    if (safeXp >= LEVELS[i].min) { index = i; break; }
  }
  const level = LEVELS[index];
  const next = index < LEVELS.length - 1 ? LEVELS[index + 1] : null;
  let progressPct = 100;
  if (next) {
    const span = next.min - level.min;
    const into = safeXp - level.min;
    progressPct = span > 0 ? Math.max(0, Math.min(100, Math.round((into / span) * 100))) : 0;
  }
  return { level, index, next, progressPct };
}

// ── Badges ─────────────────────────────────────────────────────────
// Append-only achievements. Cheaper to store as a comma-string than a
// join table (badges only grow; we never revoke). Check logic lives in
// checkAndAwardBadges() in gamification.server.ts.
export const BADGES = [
  { id: "cold_hunter",          emoji: "🧊", name: "Cold Hunter",            desc: "Logged 50+ cold calls" },
  { id: "revival_king",         emoji: "🔥", name: "Revival King",           desc: "Converted 10 cold leads to warm" },
  { id: "calling_machine",      emoji: "📞", name: "Calling Machine",        desc: "100 calls in a single day" },
  { id: "fastest_responder",    emoji: "⚡", name: "Fastest Responder",      desc: "Sub-5-min response on a hot lead" },
  { id: "followup_master",      emoji: "🎯", name: "Follow-Up Master",       desc: "10-day follow-up streak" },
  { id: "site_visit_specialist",emoji: "🏡", name: "Site Visit Specialist",  desc: "5 site visits completed" },
  { id: "meeting_maker",        emoji: "🤝", name: "Meeting Maker",          desc: "20 meetings booked" },
  { id: "monthly_closer",       emoji: "👑", name: "Monthly Closer",         desc: "Top booking count in a month" },
  { id: "consistency_beast",    emoji: "🏆", name: "Consistency Beast",      desc: "30-day login streak" },
] as const;

export type Badge = (typeof BADGES)[number];
export type BadgeId = Badge["id"];

/** Parse the comma-separated string column into a typed list of badge ids. */
export function parseBadgeIds(badges: string | null | undefined): BadgeId[] {
  if (!badges) return [];
  return badges
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as BadgeId[];
}

/** Hydrate badge ids → full Badge objects in the order they appear. */
export function badgesFromIds(ids: BadgeId[]): Badge[] {
  const map = new Map(BADGES.map((b) => [b.id, b] as const));
  const out: Badge[] = [];
  for (const id of ids) {
    const b = map.get(id);
    if (b) out.push(b);
  }
  return out;
}

// ── Result shape — used by both server (awardXp) and client (toast) ──
export interface AwardResult {
  newXp: number;
  oldLevel: string;
  newLevel: string;
  leveledUp: boolean;
  awarded: number;
  reason: XpReason;
  label: string;
}

export type StreakKind = "daily" | "followup" | "coldCall";
