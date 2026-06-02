// Festival calendar for WCR CRM festive mode.
//
// Lalit: "Festive mode — Like tomorrow is EID so EID festive vibe should be on it."
//
// Covers the festivals that matter for White Collar Realty's customer base:
// Islamic (Dubai team), Indian (India team), shared (Christmas, New Year).
// Banner shows from `daysBefore` BEFORE the date through the day itself —
// so an EID greeting can land in the agent's view the evening before, while
// the team is still preparing morning messages.
//
// Add/remove festivals here as the year progresses. Lunar dates (Eid, Diwali,
// Holi) shift yearly — update by hand each year, no auto-calc.

// ─────────────────────────────────────────────────────────────────────────────
// ACCENT PRESETS — the named accent colours the user can pick in the Theme menu
// (ThemeToggle.tsx). AccentPainter.tsx reads `wcr.accent` from localStorage and
// resolves it via resolveAccent() below, which accepts EITHER a raw #hex (from
// the custom colour input) OR one of these preset keys. Default = gold.
//
// Lalit's ask: "More accent colours" beyond the original gold/Eid/Diwali set.
// Keys are stable strings so the picker UI + painter stay in sync.
// ─────────────────────────────────────────────────────────────────────────────
export interface AccentPreset {
  /** Stable key persisted to localStorage (`wcr.accent`). */
  key: string;
  /** Display name shown in the picker. */
  name: string;
  /** Base accent hex. */
  hex: string;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { key: "gold",       name: "Brand gold", hex: "#c9a24b" }, // default
  { key: "royal-blue", name: "Royal blue", hex: "#2563eb" },
  { key: "emerald",    name: "Emerald",    hex: "#10b981" },
  { key: "violet",     name: "Violet",     hex: "#7c3aed" },
  { key: "rose",       name: "Rose",       hex: "#e11d48" },
  { key: "teal",       name: "Teal",       hex: "#0d9488" },
  { key: "orange",     name: "Orange",     hex: "#f97316" },
  { key: "indigo",     name: "Indigo",     hex: "#6366f1" },
  { key: "sky",        name: "Sky",        hex: "#0ea5e9" },
  { key: "amber",      name: "Amber",      hex: "#f59e0b" },
  { key: "fuchsia",    name: "Fuchsia",    hex: "#d946ef" },
  { key: "slate",      name: "Slate",      hex: "#475569" },
];

/** Default accent hex (brand gold) — mirrors globals.css :root. */
export const DEFAULT_ACCENT_HEX = "#c9a24b";

/**
 * Resolve a stored accent value (a preset key OR a raw #hex) to a #rrggbb hex.
 * Returns null for unrecognised input so callers can fall back cleanly.
 * Case-insensitive; tolerates a leading/trailing whitespace.
 */
export function resolveAccent(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  const preset = ACCENT_PRESETS.find((p) => p.key === v);
  return preset ? preset.hex : null;
}

export type FestiveTheme = {
  /** Banner background gradient (Tailwind classes). */
  gradient: string;
  /** Headline text color when on the banner. */
  textColor: string;
  /** Emoji to anchor the banner. */
  emoji: string;
  /** Subtle decorative pattern (background image, optional). */
  pattern?: string;
  /** Hex accent — replaces --accent-primary across the UI during this
   *  festival's window. Use a strong, brand-readable colour (think CTA
   *  buttons, chips, highlights). */
  accentHex: string;
};

/**
 * Which set of floating "delight" elements SeasonalDelight renders over the
 * page during this festival. Keep this list in sync with the switch in
 * src/components/SeasonalDelight.tsx — an unknown / missing kind falls back to
 * a tasteful neutral sparkle so a new festival is never broken, just plain.
 *
 *   diwali   → drifting diya/oil-lamps 🪔 + sparkles ✨ (tappable easter-egg)
 *   holi     → rising colour splashes / gulal dots 🎨
 *   teachers → floating graduation cap 🎓 + apple 🍎
 *   newyear  → fireworks / confetti 🎆🎉
 *   christmas→ falling snow ❄️ + tree 🎄
 *   eid      → crescent moons 🌙 + stars ✨ + lantern 🏮
 *   national → flag confetti (India 🇮🇳 / UAE 🇦🇪)
 *   sparkle  → neutral fallback
 */
export type DelightKind =
  | "diwali"
  | "holi"
  | "teachers"
  | "newyear"
  | "christmas"
  | "eid"
  | "national"
  | "sparkle";

export interface Festival {
  /** Slug used in localStorage / analytics. */
  id: string;
  /** Display name shown on the banner. */
  name: string;
  /** YYYY-MM-DD in IST. */
  date: string;
  /** How many days BEFORE the date to start showing the banner. 0 = only on the day. */
  daysBefore: number;
  /** Greeting line shown in the banner body. */
  greeting: string;
  /** Optional secondary line. */
  subline?: string;
  /** Which floating-element pack SeasonalDelight renders for this festival. */
  delight: DelightKind;
  theme: FestiveTheme;
}

export const FESTIVALS: Festival[] = [
  // ── 2026 (chronological) ──
  // Earlier-in-year entries kept so the admin override / ?festive= preview can
  // still demo them even though their auto-window has passed for 2026.
  {
    id: "new-year-2026",
    name: "New Year's Day",
    date: "2026-01-01",
    daysBefore: 1,
    greeting: "Happy New Year 2026 ✨",
    subline: "Here's to a year of closings, growth, and new clients",
    delight: "newyear",
    theme: {
      gradient: "from-indigo-800 via-purple-700 to-pink-600",
      textColor: "text-white",
      emoji: "🎆",
      accentHex: "#7c3aed",   // violet-600
    },
  },
  {
    id: "holi-2026",
    name: "Holi",
    date: "2026-03-04",             // lunar — adjust each year (Phalguna Purnima)
    daysBefore: 1,
    greeting: "Happy Holi 🎨",
    subline: "May your year be as colourful as the festival of colours",
    delight: "holi",
    theme: {
      gradient: "from-pink-500 via-yellow-400 to-emerald-500",
      textColor: "text-[#0b1a33]",
      emoji: "🎨",
      accentHex: "#ec4899",   // pink-500 — gulal pink
    },
  },
  {
    id: "eid-ul-fitr-2026",
    name: "Eid al-Fitr",
    date: "2026-03-20",            // approximate — adjust on Crescent sighting
    daysBefore: 1,
    greeting: "Eid Mubarak from White Collar Realty",
    subline: "Wishing you and your loved ones a joyous Eid al-Fitr 🌙",
    delight: "eid",
    theme: {
      gradient: "from-emerald-700 via-teal-600 to-emerald-500",
      textColor: "text-white",
      emoji: "🌙",
      accentHex: "#10b981",   // emerald-500 — Eid green
    },
  },
  {
    id: "eid-ul-adha-2026",
    name: "Eid al-Adha",
    date: "2026-05-28",            // approximate — adjust on Crescent sighting
    daysBefore: 1,                  // greet on May 27 too (today, per Lalit's ask)
    greeting: "Eid Mubarak from White Collar Realty",
    subline: "Wishing you and your family a blessed Eid al-Adha 🌙",
    delight: "eid",
    theme: {
      gradient: "from-emerald-700 via-emerald-600 to-amber-500",
      textColor: "text-white",
      emoji: "🌙",
      accentHex: "#10b981",   // emerald-500 — Eid green
    },
  },
  {
    id: "independence-day-2026",
    name: "Independence Day",
    date: "2026-08-15",
    daysBefore: 0,
    greeting: "Happy Independence Day 🇮🇳",
    subline: "Celebrating 79 years of freedom",
    delight: "national",
    theme: {
      gradient: "from-orange-500 via-white to-emerald-600",
      textColor: "text-[#0b1a33]",
      emoji: "🇮🇳",
      accentHex: "#f97316",   // orange-500
    },
  },
  {
    id: "teachers-day-2026",
    name: "Teacher's Day",
    date: "2026-09-05",
    daysBefore: 0,
    greeting: "Happy Teacher's Day 🎓",
    subline: "Gratitude to every mentor who shaped our journey 🍎",
    delight: "teachers",
    theme: {
      gradient: "from-sky-600 via-indigo-600 to-violet-600",
      textColor: "text-white",
      emoji: "🎓",
      accentHex: "#6366f1",   // indigo-500
    },
  },
  {
    id: "diwali-2026",
    name: "Diwali",
    date: "2026-11-08",
    daysBefore: 1,
    greeting: "Wishing you a sparkling Diwali ✨",
    subline: "May the festival of lights bring prosperity to your home",
    delight: "diwali",
    theme: {
      gradient: "from-amber-600 via-orange-500 to-pink-600",
      textColor: "text-white",
      emoji: "🪔",
      accentHex: "#ec4899",   // pink-500 — Diwali festive
    },
  },
  {
    id: "uae-national-day-2026",
    name: "UAE National Day",
    date: "2026-12-02",
    daysBefore: 0,
    greeting: "Happy 55th UAE National Day 🇦🇪",
    subline: "Celebrating the spirit of the Union",
    delight: "national",
    theme: {
      gradient: "from-red-600 via-green-700 to-black",
      textColor: "text-white",
      emoji: "🇦🇪",
      accentHex: "#dc2626",   // red-600
    },
  },
  {
    id: "christmas-2026",
    name: "Christmas",
    date: "2026-12-25",
    daysBefore: 1,
    greeting: "Merry Christmas 🎄",
    subline: "Warm wishes from your White Collar Realty team",
    delight: "christmas",
    theme: {
      gradient: "from-red-700 via-red-600 to-green-700",
      textColor: "text-white",
      emoji: "🎄",
      accentHex: "#16a34a",   // green-600 — tree green
    },
  },
  {
    id: "new-year-2027",
    name: "New Year's Day",
    date: "2027-01-01",
    daysBefore: 1,
    greeting: "Happy New Year 2027 ✨",
    subline: "Here's to a year of closings, growth, and new clients",
    delight: "newyear",
    theme: {
      gradient: "from-indigo-800 via-purple-700 to-pink-600",
      textColor: "text-white",
      emoji: "🎆",
      accentHex: "#7c3aed",   // violet-600
    },
  },
];

/**
 * Map a free-text `?festive=` query value to a festival so Lalit can preview
 * any pack on demand (e.g. `?festive=diwali`, `?festive=teachers`,
 * `?festive=eid`). Matches on delight kind first (stable across years), then a
 * loose name/id contains-match. Returns null if nothing matches.
 */
export function findFestivalByKeyword(keyword: string): Festival | null {
  const k = keyword.trim().toLowerCase();
  if (!k) return null;
  if (k === "none" || k === "off") return null;

  // Friendly aliases → canonical delight kind.
  const aliases: Record<string, DelightKind> = {
    diwali: "diwali",
    deepavali: "diwali",
    holi: "holi",
    teacher: "teachers",
    teachers: "teachers",
    "teachers-day": "teachers",
    newyear: "newyear",
    "new-year": "newyear",
    nye: "newyear",
    christmas: "christmas",
    xmas: "christmas",
    eid: "eid",
    "eid-ul-fitr": "eid",
    "eid-ul-adha": "eid",
    national: "national",
    uae: "national",
    india: "national",
    independence: "national",
  };

  const wantKind = aliases[k];
  if (wantKind) {
    // Prefer an upcoming/closest occurrence; simplest = first match in list.
    const byKind = FESTIVALS.find((f) => f.delight === wantKind);
    if (byKind) return byKind;
  }

  // Fall back to id / name contains-match.
  return (
    FESTIVALS.find((f) => f.id.toLowerCase().includes(k)) ||
    FESTIVALS.find((f) => f.name.toLowerCase().includes(k)) ||
    null
  );
}

/**
 * Read a `?festive=` (or legacy `?festival=`) force value from the current URL.
 * SSR-safe. Used purely for previewing/demoing a festival theme outside its
 * calendar window — does NOT persist. Returns the raw keyword or null.
 */
export function getFestiveQueryParam(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const sp = new URLSearchParams(window.location.search);
    return sp.get("festive") ?? sp.get("festival");
  } catch {
    return null;
  }
}

/**
 * localStorage key for the admin manual override.
 * Values: festival id (e.g. "diwali-2026") → force-show that festival
 *         "none"                            → suppress all festival theming
 *         (key absent / null)               → auto / follow calendar
 */
export const OVERRIDE_KEY = "wcr-festival-override";

/** Read the current admin override, if any. SSR-safe (returns null on server). */
export function getFestivalOverride(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(OVERRIDE_KEY);
  } catch {
    return null;
  }
}

/** Write/clear the admin override. Pass `null` to clear and fall back to calendar. */
export function setFestivalOverride(id: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (id === null) {
      window.localStorage.removeItem(OVERRIDE_KEY);
    } else {
      window.localStorage.setItem(OVERRIDE_KEY, id);
    }
  } catch {
    /* ignore quota / disabled-storage errors */
  }
}

/** Get the festival that should be displayed today (IST), if any.
 *  Precedence:
 *    0) `?festive=` URL param  → preview/demo any pack on demand (highest).
 *    1) Admin override (localStorage) → force / suppress, survives reloads.
 *    2) Date-based calendar window (default).
 *  Lalit can preview / force a festival theme outside its date window via
 *  either the query param (one-off, e.g. `?festive=diwali`) or the Settings
 *  admin panel (persisted). */
export function getActiveFestival(now: Date = new Date()): Festival | null {
  // 0) URL query-param preview wins (non-persistent — for testing/demos).
  const q = getFestiveQueryParam();
  if (q !== null) {
    if (q.trim().toLowerCase() === "none" || q.trim().toLowerCase() === "off") return null;
    const forced = findFestivalByKeyword(q);
    if (forced) return forced;
    // Unknown keyword — ignore and fall through to override / calendar.
  }

  // 1) Admin override wins.
  const override = getFestivalOverride();
  if (override === "none") return null;
  if (override) {
    const forced = FESTIVALS.find((f) => f.id === override);
    if (forced) return forced;
    // Unknown id (e.g. removed from calendar) — fall through to date logic.
  }

  // 2) Date-based: convert to IST date-only string to compare cleanly.
  const istOffsetMs = 330 * 60 * 1000;
  const istToday = new Date(now.getTime() + istOffsetMs).toISOString().slice(0, 10);
  for (const f of FESTIVALS) {
    const start = new Date(f.date + "T00:00:00+05:30");
    const startWindow = new Date(start.getTime() - f.daysBefore * 86_400_000);
    const endWindow = new Date(start.getTime() + 86_400_000);    // end of festival day IST
    const nowMs = now.getTime();
    if (nowMs >= startWindow.getTime() && nowMs < endWindow.getTime()) {
      // Also include a date check so we never accidentally fire on a wrong year.
      const startStr = new Date(startWindow.getTime() + istOffsetMs).toISOString().slice(0, 10);
      if (istToday >= startStr) return f;
    }
  }
  return null;
}
