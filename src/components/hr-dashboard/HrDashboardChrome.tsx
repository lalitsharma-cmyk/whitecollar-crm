// HrDashboardChrome — the PRESENTATIONAL page shell for the redesigned HR
// dashboard (docs/HR-DASHBOARD-REDESIGN-SPEC.md). It owns ONLY layout:
//
//   • a greeting band ("Good Morning, Lalit") built from props (greetingFor +
//     firstName — computed by the caller, never here),
//   • the primary "Add Candidate" CTA, and
//   • the responsive 3-column grid frame: a wide left ACTION column
//     (lg:col-span-2 — "what should I do right now?": Action Center, Call-Now
//     queue, interviews, no-shows, joinings…) and a narrow right STICKY sidebar
//     (lg:col-span-1 — reminders, AI assistant, leaderboard, recent activity).
//
// It is a SERVER component and PURELY PRESENTATIONAL: it fetches nothing, queries
// nothing, and computes no business state. All data (and the already-composed
// section nodes) arrive via props; page.tsx decides what goes in each slot and in
// what order. The `left` / `right` slots are rendered verbatim into the grid so
// the page controls section order while the chrome guarantees a consistent shell,
// spacing, dark-mode treatment and Lucide-only iconography across the module.
//
// Styling deliberately mirrors the existing HR surfaces (rounded-2xl cards, the
// #1a2e4a brand navy CTA, tight gaps, matching dark: variants) so the redesign
// drops in without a visual seam. No emoji — Lucide icons only.

import type { ReactNode } from "react";
import Link from "next/link";
import { UserPlus } from "lucide-react";

export interface HrDashboardChromeProps {
  firstName: string;
  greeting: string;
  left: ReactNode;
  right: ReactNode;
}

export function HrDashboardChrome({ firstName, greeting, left, right }: HrDashboardChromeProps) {
  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      {/* Greeting band + primary CTA */}
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">
          {greeting}, {firstName}
        </h1>
        <Link
          href="/hr/candidates/new"
          className="inline-flex items-center gap-2 bg-[#1a2e4a] text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-[#243d60] transition"
        >
          <UserPlus className="w-4 h-4" /> Add Candidate
        </Link>
      </div>

      {/* 3-col frame: wide left action column + narrow right sticky sidebar */}
      <div className="grid lg:grid-cols-3 gap-4">
        {/* LEFT — action content (Action Center, Call-Now queue, interviews, …) */}
        <div className="lg:col-span-2 space-y-4">{left}</div>

        {/* RIGHT — sticky sidebar (reminders, AI assistant, leaderboard, activity) */}
        <div className="lg:col-span-1 lg:sticky lg:top-4 lg:self-start space-y-4">{right}</div>
      </div>
    </div>
  );
}

export default HrDashboardChrome;
