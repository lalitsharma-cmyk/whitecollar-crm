// ═════════════════════════════════════════════════════════════════════════════
// PRESENCE SERVICE — Admin-only real-time "who is on the CRM right now" +
// last-seen / session-history. (Lalit spec, 2026-07.)
//
// Data model: PresenceSession (prisma/schema.prisma) — ONE row per browser/PWA
// instance (sessionKey minted client-side, sessionStorage-scoped). The client
// beacon (src/components/PresenceBeacon.tsx) POSTs /api/presence/heartbeat
// every 60s while the tab is VISIBLE; the server stamps all timestamps
// (client clocks are never trusted).
//
// Status derivation (server-side, from server timestamps):
//   ONLINE  — lastHeartbeatAt within 90s and recent meaningful activity
//   IDLE    — heartbeat alive (CRM open) but no interaction for 5+ min
//   OFFLINE — heartbeat stale (>90s) or the session was explicitly ended
//   NEVER_ACTIVE_TODAY — user-level only: no session at all this IST day
//   (IST day boundaries via istDayRange — NEVER UTC midnight.)
//
// PRIVACY (verbatim requirement): we record ONLY operational metadata —
// route PATHNAME (no query string — search text may contain client phone
// numbers), module label, device/browser/os, timestamps, interaction COUNT.
// Never message content, note text, phone numbers, field values, GPS, or IP.
//
// No cron (crons are intentionally disabled) — stale sessions are closed
// opportunistically inside the admin read path (closeStaleSessions).
// ═════════════════════════════════════════════════════════════════════════════

import { prisma } from "@/lib/prisma";
import { istDayRange, istDateKey, isValidDateKey } from "@/lib/datetime";

// ── Tunables (single source of truth — the beacon + UI read these too) ──────
export const HEARTBEAT_INTERVAL_MS = 60_000;      // client beat cadence (visible tabs only)
export const ONLINE_WINDOW_MS = 90_000;           // heartbeat within 90s  → CRM open
export const IDLE_AFTER_MS = 5 * 60_000;          // no interaction for 5m → Idle
export const STALE_SESSION_MS = 30 * 60_000;      // no heartbeat for 30m  → close session
export const OVERVIEW_REFRESH_MS = 30_000;        // admin page auto-refresh cadence

export type PresenceStatus = "ONLINE" | "IDLE" | "OFFLINE" | "NEVER_ACTIVE_TODAY";

/** Sort/precedence rank — lower = "more present". */
export const STATUS_RANK: Record<PresenceStatus, number> = {
  ONLINE: 0,
  IDLE: 1,
  OFFLINE: 2,
  NEVER_ACTIVE_TODAY: 3,
};

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers (no DB) — exported for reuse + regression assertions.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Derive a SESSION-level status. NEVER_ACTIVE_TODAY is a USER-level concept
 * (no sessions at all today) and is decided by the caller, not here.
 * An explicit end (endedAt) always wins, even over a fresh heartbeat.
 */
export function derivePresenceStatus(
  session: { lastHeartbeatAt: Date; lastActivityAt: Date; endedAt: Date | null },
  now: Date = new Date(),
): Exclude<PresenceStatus, "NEVER_ACTIVE_TODAY"> {
  if (session.endedAt) return "OFFLINE";
  const beatAge = now.getTime() - session.lastHeartbeatAt.getTime();
  if (beatAge > ONLINE_WINDOW_MS) return "OFFLINE";
  const activityAge = now.getTime() - session.lastActivityAt.getTime();
  if (activityAge > IDLE_AFTER_MS) return "IDLE";
  return "ONLINE";
}

/**
 * Minimal user-agent → device/os/browser labels. Deliberately tiny — this is
 * a display aid for the admin table, not fingerprinting. Order matters:
 * Edge UA contains "Chrome"+"Safari"; Chrome UA contains "Safari".
 */
export function parseUserAgent(ua: string | null | undefined): { device: string; os: string; browser: string } {
  const s = ua ?? "";
  let device = "Other";
  let os = "Other";
  if (/iPad/i.test(s)) { device = "iPad"; os = "iPadOS"; }
  else if (/iPhone|iPod/i.test(s)) { device = "iPhone"; os = "iOS"; }
  else if (/Android/i.test(s)) { device = "Android"; os = "Android"; }
  else if (/Windows/i.test(s)) { device = "Windows"; os = "Windows"; }
  else if (/Macintosh|Mac OS X/i.test(s)) { device = "Mac"; os = "macOS"; }
  else if (/Linux/i.test(s)) { device = "Linux"; os = "Linux"; }

  let browser = "Other";
  if (/EdgiOS|EdgA|Edg\//i.test(s)) browser = "Edge";
  else if (/OPR\/|Opera/i.test(s)) browser = "Opera";
  else if (/SamsungBrowser/i.test(s)) browser = "Samsung Internet";
  else if (/FxiOS|Firefox\//i.test(s)) browser = "Firefox";
  else if (/CriOS|Chrome\//i.test(s)) browser = "Chrome";
  else if (/Safari\//i.test(s)) browser = "Safari";
  return { device, os, browser };
}

/**
 * Reduce whatever the client sent as "route" to a bare PATHNAME.
 * Query strings are dropped ON THE SERVER too (defence in depth — a search
 * query like ?q=98110xxxxx could contain a client phone number).
 */
export function stripToPathname(raw: string | null | undefined): string {
  let s = (raw ?? "").trim();
  if (!s) return "/";
  try {
    // Handles absolute URLs, protocol-relative, and plain paths alike.
    s = new URL(s, "http://local").pathname;
  } catch {
    s = s.split("?")[0].split("#")[0];
  }
  if (!s.startsWith("/")) s = `/${s}`;
  // Hard cap — lastRoute is operational metadata, not a data store.
  return s.slice(0, 200);
}

/** Route-prefix → CRM module label. Verified against src/app/(app)/ + (hr). */
const MODULE_MAP: Array<[prefix: string, label: string]> = [
  ["/leads", "Leads"],
  ["/master-data", "Master Data"],
  ["/cold-calls", "Revival"],
  ["/revival-engine", "Revival"],
  ["/buyer-data", "Dubai Buyer Data"],
  ["/india-buyer-data", "India Buyer Data"],
  ["/reports", "Reports"],
  ["/admin", "Admin"],
  ["/hr", "HR"],
  ["/dashboard", "Dashboard"],
  ["/action-list", "Action List"],
  ["/call-logs", "Calls"],
  ["/calls", "Calls"],
  ["/team", "Team"],
  ["/gallery", "Gallery"],
  ["/pipeline", "Pipeline"],
  ["/customers", "Customers"],
  ["/properties", "Properties"],
  ["/leaderboards", "Leaderboards"],
  ["/notifications", "Notifications"],
  ["/activities", "Activities"],
  ["/settings", "Settings"],
  ["/profile", "Profile"],
];

export function deriveModuleFromPath(pathname: string): string {
  const p = stripToPathname(pathname);
  for (const [prefix, label] of MODULE_MAP) {
    if (p === prefix || p.startsWith(`${prefix}/`)) return label;
  }
  return "Other";
}

/**
 * STRICT presence RBAC: full Admin (Super-Admin included — they carry role
 * ADMIN) and NOT an HR-only account. Nisha (hrOnly) must get 403 — presence
 * is a sales-floor management surface, not an HR one.
 */
export function canViewPresence(u: { role: string; hrOnly?: boolean | null }): boolean {
  return u.role === "ADMIN" && !u.hrOnly;
}

// ─────────────────────────────────────────────────────────────────────────────
// Write path — called from POST /api/presence/heartbeat. Must stay CHEAP:
// one updateMany (single index hit) in the common case; a create only on the
// first beat of a new browser session.
// ─────────────────────────────────────────────────────────────────────────────

export interface HeartbeatInput {
  userId: string;
  sessionKey: string;
  route: string;
  /** True when the user actually interacted (click/keydown/scroll) since the last beat. */
  isActive: boolean;
  /** Raw User-Agent header — parsed server-side. */
  userAgent?: string | null;
  /** Client hints — isPwa can ONLY come from the client (display-mode). */
  client?: { os?: string | null; browser?: string | null; isPwa?: boolean };
}

export async function recordHeartbeat(input: HeartbeatInput): Promise<void> {
  const now = new Date(); // server clock — client clocks are never trusted
  const sessionKey = input.sessionKey.trim().slice(0, 80);
  if (!sessionKey) return;
  const pathname = stripToPathname(input.route);
  const moduleLabel = deriveModuleFromPath(pathname);
  const parsed = parseUserAgent(input.userAgent);
  const device = parsed.device !== "Other" ? parsed.device : (input.client?.os ?? "Other").slice(0, 40) || "Other";
  const os = parsed.os !== "Other" ? parsed.os : (input.client?.os ?? "Other").slice(0, 40) || "Other";
  const browser = parsed.browser !== "Other" ? parsed.browser : (input.client?.browser ?? "Other").slice(0, 40) || "Other";
  const isPwa = input.client?.isPwa === true;

  const update = {
    lastHeartbeatAt: now,
    lastRoute: pathname,
    lastModule: moduleLabel,
    device,
    browser,
    os,
    isPwa,
    endedAt: null, // a returning beat revives a session closed by pagehide/staleness
    ...(input.isActive ? { lastActivityAt: now, activityCount: { increment: 1 } } : {}),
  };

  // updateMany with BOTH sessionKey AND userId: a sessionKey can never be used
  // to write into another user's presence row (ownership enforced in the WHERE).
  const res = await prisma.presenceSession.updateMany({ where: { sessionKey, userId: input.userId }, data: update });
  if (res.count > 0) return;

  try {
    await prisma.presenceSession.create({
      data: {
        userId: input.userId,
        sessionKey,
        startedAt: now,
        lastHeartbeatAt: now,
        lastActivityAt: now,
        device,
        browser,
        os,
        isPwa,
        lastRoute: pathname,
        lastModule: moduleLabel,
        activityCount: input.isActive ? 1 : 0,
      },
    });
  } catch {
    // P2002 race (two first-beats of the same key) or a key owned by another
    // user — drop silently. Presence is best-effort telemetry, never an error
    // surfaced to the user.
  }
}

/** pagehide beacon — mark the session explicitly closed. Ownership-guarded. */
export async function endPresenceSession(sessionKey: string, userId: string): Promise<void> {
  const now = new Date();
  await prisma.presenceSession
    .updateMany({
      where: { sessionKey: sessionKey.trim().slice(0, 80), userId, endedAt: null },
      // Stamp the heartbeat too so "last seen" == the real close moment.
      data: { endedAt: now, lastHeartbeatAt: now },
    })
    .catch(() => {});
}

/**
 * Opportunistic cleanup — NO cron (crons are intentionally disabled, see
 * project-cron-intentional-hold). Runs inside the admin read path: any
 * session silent for 30+ min gets endedAt = its OWN last heartbeat (raw SQL
 * so we can reference the column — endedAt lands on the true last-seen
 * moment, not "whenever an admin next opened the page"). Cheap: hits the
 * lastHeartbeatAt index, normally updates 0 rows.
 */
export async function closeStaleSessions(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_SESSION_MS);
  try {
    return await prisma.$executeRaw`UPDATE "PresenceSession" SET "endedAt" = "lastHeartbeatAt" WHERE "endedAt" IS NULL AND "lastHeartbeatAt" < ${cutoff}`;
  } catch {
    return 0; // cleanup must never break the admin view
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Read path — admin overview + per-user day history.
// All timestamps serialized to ISO strings (safe across the RSC/JSON boundary;
// the UI renders them in IST via src/lib/datetime.ts).
// ─────────────────────────────────────────────────────────────────────────────

export interface PresenceSessionView {
  id: string;
  device: string;
  browser: string;
  os: string;
  isPwa: boolean;
  currentModule: string;
  currentRoute: string;
  sessionStart: string;
  lastActivityAt: string;
  lastHeartbeatAt: string;
  endedAt: string | null;
  activityCount: number;
  durationMin: number; // (endedAt ?? lastHeartbeatAt) − startedAt
  status: Exclude<PresenceStatus, "NEVER_ACTIVE_TODAY">;
}

export interface PresenceUserRow {
  userId: string;
  name: string;
  email: string;
  team: string;
  role: string;
  status: PresenceStatus;
  /** Max lastHeartbeatAt across ALL sessions ever (not just today) — null = never seen. */
  lastSeenAt: string | null;
  /** Distinct device/browser/PWA combos seen TODAY (IST). */
  deviceCount: number;
  sessions: PresenceSessionView[]; // today's sessions, newest first
}

export interface PresenceOverview {
  generatedAt: string;
  dayKey: string; // IST calendar day the overview covers
  counts: { online: number; idle: number; offline: number; neverActiveToday: number };
  teams: string[]; // distinct teams among active users (filter options)
  users: PresenceUserRow[];
}

export interface PresenceFilters {
  status?: string | null; // ONLINE | IDLE | OFFLINE | NEVER_ACTIVE_TODAY
  team?: string | null;
  role?: string | null;   // ADMIN | MANAGER | AGENT
  q?: string | null;      // name/email substring
}

function sessionDurationMin(s: { startedAt: Date; lastHeartbeatAt: Date; endedAt: Date | null }): number {
  const end = s.endedAt ?? s.lastHeartbeatAt;
  return Math.max(0, Math.round((end.getTime() - s.startedAt.getTime()) / 60_000));
}

function toSessionView(
  s: {
    id: string; device: string | null; browser: string | null; os: string | null; isPwa: boolean;
    lastRoute: string | null; lastModule: string | null; startedAt: Date; lastActivityAt: Date;
    lastHeartbeatAt: Date; endedAt: Date | null; activityCount: number;
  },
  now: Date,
): PresenceSessionView {
  return {
    id: s.id,
    device: s.device ?? "Other",
    browser: s.browser ?? "Other",
    os: s.os ?? "Other",
    isPwa: s.isPwa,
    currentModule: s.lastModule ?? "Other",
    currentRoute: s.lastRoute ?? "/",
    sessionStart: s.startedAt.toISOString(),
    lastActivityAt: s.lastActivityAt.toISOString(),
    lastHeartbeatAt: s.lastHeartbeatAt.toISOString(),
    endedAt: s.endedAt ? s.endedAt.toISOString() : null,
    activityCount: s.activityCount,
    durationMin: sessionDurationMin(s),
    status: derivePresenceStatus(s, now),
  };
}

/**
 * The admin overview: every ACTIVE user with today's (IST) sessions + derived
 * status. Also performs the opportunistic stale-session cleanup (this IS the
 * admin read path). Filters are applied AFTER derivation, since status is a
 * derived value.
 */
export async function getPresenceOverview(filters: PresenceFilters = {}): Promise<PresenceOverview> {
  const now = new Date();
  await closeStaleSessions(now);
  const { start } = istDayRange(); // today, IST — never UTC midnight

  const [users, todaySessions, lastSeen] = await Promise.all([
    prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, email: true, role: true, team: true },
      orderBy: [{ role: "asc" }, { name: "asc" }],
    }),
    prisma.presenceSession.findMany({
      where: { lastHeartbeatAt: { gte: start } },
      orderBy: { lastHeartbeatAt: "desc" },
    }),
    prisma.presenceSession.groupBy({
      by: ["userId"],
      _max: { lastHeartbeatAt: true },
    }),
  ]);

  const lastSeenByUser = new Map<string, Date>();
  for (const g of lastSeen) {
    if (g._max.lastHeartbeatAt) lastSeenByUser.set(g.userId, g._max.lastHeartbeatAt);
  }
  const sessionsByUser = new Map<string, typeof todaySessions>();
  for (const s of todaySessions) {
    const arr = sessionsByUser.get(s.userId) ?? [];
    arr.push(s);
    sessionsByUser.set(s.userId, arr);
  }

  let rows: PresenceUserRow[] = users.map((u) => {
    const raw = sessionsByUser.get(u.id) ?? [];
    const sessions = raw.map((s) => toSessionView(s, now));
    const status: PresenceStatus =
      sessions.length === 0
        ? "NEVER_ACTIVE_TODAY"
        : sessions.reduce<PresenceStatus>(
            (best, s) => (STATUS_RANK[s.status] < STATUS_RANK[best] ? s.status : best),
            "OFFLINE",
          );
    const deviceCount = new Set(raw.map((s) => `${s.device ?? "?"}|${s.browser ?? "?"}|${s.isPwa ? 1 : 0}`)).size;
    const seen = lastSeenByUser.get(u.id);
    return {
      userId: u.id,
      name: u.name,
      email: u.email,
      team: u.team ?? "—",
      role: u.role,
      status,
      lastSeenAt: seen ? seen.toISOString() : null,
      deviceCount,
      sessions,
    };
  });

  const teams = [...new Set(users.map((u) => u.team).filter((t): t is string => !!t))].sort();

  // Counts BEFORE filtering — the summary chips always show the whole floor.
  const counts = {
    online: rows.filter((r) => r.status === "ONLINE").length,
    idle: rows.filter((r) => r.status === "IDLE").length,
    offline: rows.filter((r) => r.status === "OFFLINE").length,
    neverActiveToday: rows.filter((r) => r.status === "NEVER_ACTIVE_TODAY").length,
  };

  const status = (filters.status ?? "").trim().toUpperCase();
  if (status && status in STATUS_RANK) rows = rows.filter((r) => r.status === status);
  const team = (filters.team ?? "").trim().toLowerCase();
  if (team) rows = rows.filter((r) => r.team.toLowerCase() === team);
  const role = (filters.role ?? "").trim().toUpperCase();
  if (role) rows = rows.filter((r) => r.role === role);
  const q = (filters.q ?? "").trim().toLowerCase();
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q) || r.email.toLowerCase().includes(q));

  rows.sort((a, b) => {
    const d = STATUS_RANK[a.status] - STATUS_RANK[b.status];
    if (d !== 0) return d;
    const ta = a.lastSeenAt ?? "";
    const tb = b.lastSeenAt ?? "";
    if (ta !== tb) return tb.localeCompare(ta); // most recently seen first
    return a.name.localeCompare(b.name);
  });

  return { generatedAt: now.toISOString(), dayKey: istDateKey(now), counts, teams, users: rows };
}

// ── Per-user day history (session history, NOT attendance) ──────────────────

export interface PresenceHistoryDay {
  user: { id: string; name: string; team: string; role: string };
  date: string; // "YYYY-MM-DD" (IST)
  sessionCount: number;
  firstSeenAt: string | null; // first session start that day
  lastSeenAt: string | null;  // last heartbeat that day
  totalDurationMin: number;
  totalActivity: number;
  sessions: PresenceSessionView[];
}

/**
 * All of one user's sessions overlapping a single IST calendar day.
 * `day` = "YYYY-MM-DD" (validated by caller via isValidDateKey) or undefined
 * for today. Overlap rule: startedAt < dayEnd AND lastHeartbeatAt >= dayStart,
 * so a session spanning midnight shows on both days it touched.
 */
export async function getPresenceHistory(userId: string, day?: string): Promise<PresenceHistoryDay | null> {
  const dayKey = day && isValidDateKey(day) ? day : istDateKey();
  const { start, end } = istDayRange(dayKey);
  const now = new Date();

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, team: true, role: true },
  });
  if (!user) return null;

  const sessions = await prisma.presenceSession.findMany({
    where: { userId, startedAt: { lt: end }, lastHeartbeatAt: { gte: start } },
    orderBy: { startedAt: "asc" },
  });

  const views = sessions.map((s) => toSessionView(s, now));
  const firstSeen = sessions.length ? sessions[0].startedAt : null;
  const lastBeat = sessions.length
    ? sessions.reduce<Date>((max, s) => (s.lastHeartbeatAt > max ? s.lastHeartbeatAt : max), sessions[0].lastHeartbeatAt)
    : null;

  return {
    user: { id: user.id, name: user.name, team: user.team ?? "—", role: user.role },
    date: dayKey,
    sessionCount: views.length,
    firstSeenAt: firstSeen ? firstSeen.toISOString() : null,
    lastSeenAt: lastBeat ? lastBeat.toISOString() : null,
    totalDurationMin: views.reduce((n, v) => n + v.durationMin, 0),
    totalActivity: views.reduce((n, v) => n + v.activityCount, 0),
    sessions: views,
  };
}
