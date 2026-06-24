"use client";
// ────────────────────────────────────────────────────────────────────────────
// DashboardGreeting — timezone-aware, self-updating time-of-day greeting.
//
// WHY A CLIENT ISLAND: the greeting used to be computed server-side, where the
// clock is UTC on Vercel. At 4:11 PM IST (10:41 UTC) that produced "Good
// morning" — wrong. This component computes the band from the BROWSER'S local
// clock instead, so it is correct for whoever is looking, wherever they sit.
//
// • Bands (spec): 05–11:59 Morning · 12–16:59 Afternoon · 17–20:59 Evening ·
//   21–04:59 Night — evaluated in the user's timezone.
// • Timezone: the user's team tz (India→IST, Dubai→GST) is passed in as the
//   authoritative zone so the greeting matches the rest of the dashboard's
//   IST/GST timestamps even if the device clock/zone is off. (If you'd rather
//   trust the device, the browser tz is available too — but team tz is the
//   business rule here.)
// • AUTO-UPDATE: re-evaluates every minute, so a dashboard left open across a
//   boundary (e.g. 16:59→17:00) flips Afternoon→Evening with no refresh/logout.
//   No stale cached greeting.
//
// Renders ONLY the heading line (emoji + "Good X, <First>"); the surrounding
// card / quote / work-chips stay server-rendered in the page.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { greetingBandFor, greetingEmojiFor, type GreetingBand } from "@/lib/datetime";

export default function DashboardGreeting({
  firstName,
  tz,
}: {
  firstName: string;
  /** The user's wall-clock timezone (Asia/Kolkata | Asia/Dubai), from their team. */
  tz: string;
}) {
  // Seed from the current instant immediately so first paint is already correct
  // (no flash of a wrong band). useState initializer runs once on mount.
  const [band, setBand] = useState<GreetingBand>(() => greetingBandFor(new Date(), tz));

  useEffect(() => {
    // Re-evaluate now (covers tz/firstName prop changes) and then every minute
    // so an open dashboard crosses Morning→Afternoon→… on its own.
    const tick = () => setBand(greetingBandFor(new Date(), tz));
    tick();
    const id = setInterval(tick, 60_000); // 1-minute cadence — cheap, boundary-safe
    return () => clearInterval(id);
  }, [tz]);

  return (
    <h2 className="font-display text-lg sm:text-xl font-bold text-[#0b1a33]">
      <span aria-hidden="true">{greetingEmojiFor(band)}</span> Good {band}, {firstName}
    </h2>
  );
}
