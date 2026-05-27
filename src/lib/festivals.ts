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
  theme: FestiveTheme;
}

export const FESTIVALS: Festival[] = [
  // ── 2026 ──
  {
    id: "eid-ul-adha-2026",
    name: "Eid al-Adha",
    date: "2026-05-28",            // approximate — adjust on Crescent sighting
    daysBefore: 1,                  // greet on May 27 too (today, per Lalit's ask)
    greeting: "Eid Mubarak from White Collar Realty",
    subline: "Wishing you and your family a blessed Eid al-Adha 🌙",
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
    theme: {
      gradient: "from-orange-500 via-white to-emerald-600",
      textColor: "text-[#0b1a33]",
      emoji: "🇮🇳",
      accentHex: "#f97316",   // orange-500
    },
  },
  {
    id: "diwali-2026",
    name: "Diwali",
    date: "2026-11-08",
    daysBefore: 1,
    greeting: "Wishing you a sparkling Diwali ✨",
    subline: "May the festival of lights bring prosperity to your home",
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
    theme: {
      gradient: "from-indigo-800 via-purple-700 to-pink-600",
      textColor: "text-white",
      emoji: "🎆",
      accentHex: "#7c3aed",   // violet-600
    },
  },
];

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
 *  Admin override (localStorage) takes precedence over the calendar so Lalit
 *  can preview / force a festival theme outside its date window. */
export function getActiveFestival(now: Date = new Date()): Festival | null {
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
